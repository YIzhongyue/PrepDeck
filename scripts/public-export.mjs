import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (args, cwd = ROOT) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const TEXT = /\.(?:[cm]?[jt]sx?|json|jsonc|md|sql|toml|yml|yaml|css|html|svg|py|sh|txt|example|njk)$/i;
const OMIT = /(?:^|\/)(?:\.git|node_modules|\.wrangler|\.local-state|private|coverage|dist|screenshots|\.claude|\.playwright-mcp)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|.*\.(?:local|pem|key|sqlite|sqlite3|db|pdf|zip))$/i;
const SEED = "migrations/0002_seed_sap_c02_questions.sql";
const EMPTY_SEED = "-- Reserved migration number. Deployment-specific question data is not distributed.\n-- For original generic examples, run npm run dev:seed.\n";
const SECRET = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{40,})\b/g;
const PRIVATE_REFERENCE = /\b(?:issues?|PRs?|pull requests?)\s*#\d+(?:\/#\d+)*/gi;

export function shouldOmit(path) {
  if (/\.(?:env|dev\.vars)\.example$/.test(path)) return false;
  return OMIT.test(path) || path === ".github/workflows/cloudflare-emergency.yml";
}

export function deploymentReplacements(config) {
  const placeholders = {
    database_id: "00000000-0000-0000-0000-000000000000",
    id: "00000000000000000000000000000000",
    CF_ACCESS_TEAM_DOMAIN: "your-team.cloudflareaccess.com",
    CF_ACCESS_AUD: "YOUR_CLOUDFLARE_ACCESS_AUD",
    GOOGLE_CLIENT_ID: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
    APP_BASE_URL: "https://prepdeck.example.com",
    EMAIL_FROM_ADDRESS: "noreply@example.com",
  };
  const production = config.split("[env.development]")[0];
  return [...production.matchAll(/^([A-Za-z_]+)\s*=\s*"([^"]+)"/gm)]
    .filter(([, key]) => Object.hasOwn(placeholders, key))
    .map(([, key, value]) => [value, placeholders[key]]);
}

export function sanitizeText(text, { privateRepository, publicRepository, privateDomains = [], replacements = [], path = "" }) {
  let result = text;
  // Private runtime configuration remains untouched. Replace its identifiers
  // throughout the exported tree, including generated environment declarations.
  for (const [value, placeholder] of replacements) result = result.replaceAll(value, placeholder);
  if (privateRepository) {
    const escaped = privateRepository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\[([^\\]]*)\\]\\(https://github\\.com/${escaped}/(?:issues|pull)/\\d+(?:[^)]*)\\)`, "gi"), (_match, label) => label.replace(/#\d+/g, "implementation"));
    result = result.replaceAll(`https://github.com/${privateRepository}`, `https://github.com/${publicRepository}`);
    result = result.replaceAll(privateRepository, publicRepository);
  }
  for (const domain of privateDomains) result = result.replaceAll(domain, "example.com");
  result = result.replace(PRIVATE_REFERENCE, "implementation");
  // Bare historical references also occur in prose, standalone comments and
  // test names. Limit this pass to those contexts: question labels, runtime
  // string values and CSS colour literals remain application data.
  let fence = false;
  return result.split("\n").map(line => {
    if (/\.md$/i.test(path) && /^\s*```/.test(line)) { fence = !fence; return line; }
    const prose = /\.md$/i.test(path) && !fence;
    const comment = /^\s*(?:\/\/|\/\*|\*(?!\/))/.test(line);
    const testName = /^\s*(?:test|it|describe)\(/.test(line);
    if (!prose && !comment && !testName) return line;
    return line.replace(/(?<!question\s)#\d{2,}(?:\/#\d+)*(?![\w])/gi, "implementation");
  }).join("\n");
}

export function scanText(text, { privateRepository, privateDomains = [], replacements = [] } = {}) {
  const findings = [];
  if (SECRET.test(text)) findings.push("possible credential or private key");
  SECRET.lastIndex = 0;
  if (privateRepository && text.includes(privateRepository)) findings.push("private repository reference");
  if (privateDomains.some(domain => text.includes(domain))) findings.push("private deployment domain");
  // Resource identifiers are neither credentials nor recognizable patterns, so
  // only the private configuration's own values can detect a copy that
  // sanitization missed — for example a value repeated outside the Wrangler
  // file the replacements were derived from.
  if (replacements.some(([value, placeholder]) => value !== placeholder && text.includes(value))) findings.push("private deployment identifier");
  if (PRIVATE_REFERENCE.test(text)) findings.push("private issue/PR reference");
  PRIVATE_REFERENCE.lastIndex = 0;
  return findings;
}

// The private checkout is the only place the private identifiers exist: the
// snapshot and its manifest must not record them, or publishing the snapshot
// would publish exactly what the scan is meant to keep unpublished.
export function sourcePolicy({ source = ROOT, privateDomains = [] } = {}) {
  const origin = git(["remote", "get-url", "origin"], source).trim();
  const privateRepository = origin.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  if (!privateRepository) throw new Error("Expected an origin remote pointing at the private GitHub repository.");
  const configPath = "apps/worker/wrangler.toml";
  const replacements = existsSync(resolve(source, configPath))
    ? deploymentReplacements(git(["show", `HEAD:${configPath}`], source)) : [];
  return { privateRepository, privateDomains, replacements };
}

export async function checkSourceSecrets(source = ROOT) {
  const failures = [];
  const paths = git(["ls-files", "-z"], source).split("\0").filter(Boolean);
  for (const path of paths) {
    const bytes = await readFile(resolve(source, path));
    if (bytes.includes(0)) continue;
    if (SECRET.test(bytes.toString("utf8"))) failures.push(`${path}: possible credential or private key`);
    SECRET.lastIndex = 0;
  }
  if (failures.length) throw new Error(failures.join("\n"));
  return { checkedFiles: paths.length };
}

async function filesUnder(directory, prefix = "") {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${path}`);
    if (entry.isDirectory()) paths.push(...await filesUnder(resolve(directory, entry.name), `${path}/`));
    else paths.push(path);
  }
  return paths;
}

export async function scanSnapshot(directory, policy = {}) {
  const failures = [];
  const initialized = existsSync(resolve(directory, ".git"));
  const commit = initialized ? git(["rev-parse", "HEAD"], directory).trim() : null;
  if (initialized && (git(["diff", "--no-ext-diff", "--name-only", "-z"], directory) ||
    git(["diff", "--cached", "--no-ext-diff", "--name-only", "-z", commit], directory))) {
    throw new Error("Snapshot has changed or unreviewed index/worktree content; commit the reviewed snapshot before scanning.");
  }
  // Pin all reads to the same committed tree, including the manifest and seed.
  // Reading checkout bytes can hide unsafe committed content and varies with
  // Git checkout filters (for example Windows CRLF conversion).
  const readSnapshotFile = path => commit
    ? execFileSync("git", ["show", `${commit}:${path}`], { cwd: directory, windowsHide: true, maxBuffer: 30 * 1024 * 1024 })
    : readFile(resolve(directory, path));
  const manifest = JSON.parse((await readSnapshotFile("public-export-manifest.json")).toString("utf8"));
  // Once initialized, inspect exactly what that new repository will publish;
  // ignored dependencies/local state created during validation are not artifacts.
  const paths = initialized
    ? git(["ls-tree", "-r", "--name-only", "-z", commit], directory).split("\0").filter(Boolean)
    : await filesUnder(directory);
  for (const path of paths) {
    if (path === "public-export-manifest.json") continue;
    const bytes = await readSnapshotFile(path);
    if (shouldOmit(path)) failures.push(`${path}: private/generated path`);
    if (manifest.files[path] !== sha256(bytes)) failures.push(`${path}: changed or unreviewed export content`);
    if (!bytes.includes(0)) failures.push(...scanText(bytes.toString("utf8"), policy).map(reason => `${path}: ${reason}`));
  }
  for (const path of Object.keys(manifest.files)) if (!paths.includes(path)) failures.push(`${path}: missing exported file`);
  if ((await readSnapshotFile(SEED)).toString("utf8") !== EMPTY_SEED) failures.push("Restricted seed migration was not replaced.");
  if (initialized) {
    const count = Number(git(["rev-list", "--all", "--count"], directory).trim());
    if (count !== 1) failures.push("Initial release must contain exactly one new commit.");
    if (git(["remote"], directory).trim()) failures.push("Export must have no publishing remotes during review.");
  }
  if (failures.length) throw new Error(failures.join("\n"));
  return { files: paths.length - 1, history: initialized ? "one initial commit" : "none" };
}

export async function exportSnapshot({ source = ROOT, destination, publicRepository, privateDomains = [], reviewedAssets = {} }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(publicRepository ?? "")) throw new Error("Supply --repository OWNER/REPO for the intended public repository (or OWNER/PrepDeck for a preview).");
  destination = resolve(destination);
  const nested = relative(source, destination);
  if (!nested || (!nested.startsWith(`..${sep}`) && !nested.startsWith(`.local-state${sep}`))) throw new Error("Export to a new sibling directory or .local-state subdirectory.");
  if (existsSync(destination)) throw new Error("Export directory exists; choose a new directory so earlier reviewed output is preserved.");
  if (git(["status", "--porcelain", "--untracked-files=no"], source).trim()) throw new Error("Commit or stash tracked changes before exporting a reproducible snapshot.");
  const { privateRepository, replacements } = sourcePolicy({ source, privateDomains });
  if (privateRepository.toLowerCase() === publicRepository.toLowerCase()) throw new Error("The public repository must differ from the private origin.");
  const policy = { privateRepository, publicRepository, privateDomains, replacements };
  const manifest = { version: 1, repository: publicRepository, files: {}, excluded: [] };
  const paths = git(["ls-files", "-z"], source).split("\0").filter(Boolean).sort();
  await mkdir(destination, { recursive: true });
  for (const path of paths) {
    if (shouldOmit(path)) { manifest.excluded.push(path); continue; }
    const sourcePath = resolve(source, path);
    const metadata = await lstat(sourcePath);
    if (metadata.isSymbolicLink()) throw new Error(`Review symlink before exporting: ${path}`);
    // Read committed bytes so checkout-specific CRLF conversion cannot change
    // the exported content or manifest across contributor operating systems.
    let bytes = execFileSync("git", ["show", `HEAD:${path}`], { cwd: source, windowsHide: true, maxBuffer: 30 * 1024 * 1024 });
    const text = TEXT.test(path) || !bytes.includes(0) && !/\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf)$/i.test(path);
    if (path === SEED) bytes = Buffer.from(EMPTY_SEED);
    else if (text) bytes = Buffer.from(sanitizeText(bytes.toString("utf8"), { ...policy, path }));
    else if (reviewedAssets[path] !== sha256(bytes)) throw new Error(`Binary asset needs a reviewed SHA-256 in --assets: ${path}`);
    if (text) {
      const findings = scanText(bytes.toString("utf8"), policy);
      if (findings.length) throw new Error(`${path}: ${findings.join(", ")}`);
    }
    const target = resolve(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { mode: metadata.mode & 0o777 });
    manifest.files[path] = sha256(bytes);
  }
  await writeFile(resolve(destination, "public-export-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return scanSnapshot(destination, policy);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => args[args.indexOf(name) + 1];
  const privateDomains = args.flatMap((arg, i) => arg === "--private-domain" ? [args[i + 1]] : []);
  try {
    if (args.includes("--check-source")) {
      console.log(JSON.stringify(await checkSourceSecrets()));
      process.exit(0);
    }
    if (!args.includes("--out")) throw new Error("Supply --out /absolute/new/export-directory; no files are published by this command.");
    const destination = resolve(value("--out"));
    // Re-derive the export's policy rather than scanning with an empty one:
    // this run is the last gate before a snapshot is initialized and published,
    // and it must reject the same private content the export rejected.
    const result = args.includes("--scan") ? await scanSnapshot(destination, sourcePolicy({ privateDomains })) : await exportSnapshot({
      destination, publicRepository: value("--repository"), privateDomains,
      reviewedAssets: args.includes("--assets") ? JSON.parse(await readFile(value("--assets"), "utf8")) : {},
    });
    console.log(JSON.stringify(result));
    console.log("Review the snapshot, assets, fixtures, licenses and scanner results before initializing or publishing a new public repository.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
