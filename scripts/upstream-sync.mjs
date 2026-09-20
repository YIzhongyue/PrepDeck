import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], windowsHide: true }).trim();

// Fetch and prepare only. This helper never pushes, publishes, or deploys.
try {
  const branch = process.argv[2];
  if (!branch || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes("..")) throw new Error("Usage: npm run upstream:sync -- main (use the public default branch).");
  if (git("status", "--porcelain")) throw new Error("Commit or stash local changes before synchronizing upstream.");
  const origin = git("remote", "get-url", "origin");
  const upstream = git("remote", "get-url", "upstream");
  if (origin === upstream) throw new Error("origin must be private and upstream must be the separate public repository.");
  const pushUrl = git("remote", "get-url", "--push", "upstream");
  if (pushUrl !== "DISABLED") throw new Error("First disable upstream pushes: git remote set-url --push upstream DISABLED");
  git("fetch", "--no-tags", "upstream", branch);
  const target = git("rev-parse", "FETCH_HEAD");
  const localBranch = `sync/upstream-${target.slice(0, 12)}`;
  git("switch", "-c", localBranch);
  // The first synchronization joins the new history-free public root to the
  // private history. Later runs have a shared ancestor and use normal merges.
  try { git("merge-base", "HEAD", target); }
  catch { throw new Error("Initial upstream histories are unrelated. Follow the reviewed initial import in docs/guides/public-private-sync.md; this helper will not resolve it automatically."); }
  git("merge", "--no-ff", "--no-commit", target);
  console.log(`Prepared ${localBranch}. Resolve/review changes, run tests, commit, and open a PR against private origin. Nothing was pushed.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
