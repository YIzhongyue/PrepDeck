import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { localEnvironment, wranglerArgs, ROOT, loginServer } from "./local.mjs";
import { exportSnapshot, sanitizeText, scanText, shouldOmit, scanSnapshot, checkSourceSecrets, deploymentReplacements, sourcePolicy } from "./public-export.mjs";

test("local Wrangler environment supplies all non-inherited bindings and fails closed for deployed password login", async () => {
  const { unstable_readConfig } = await import("wrangler");
  const path = resolve(ROOT, "apps/worker/wrangler.toml");
  const development = unstable_readConfig({ config: path, env: "development" });
  const production = unstable_readConfig({ config: path });
  assert.equal(production.vars.ENVIRONMENT, "production");
  assert.equal(production.vars.ENABLE_DEV_PASSWORD_LOGIN, "false");
  assert.equal(production.send_email[0].remote, true);
  assert.equal(development.vars.ENVIRONMENT, "development");
  assert.equal(development.vars.ENABLE_DEV_PASSWORD_LOGIN, "true");
  assert.equal(development.vars.GOOGLE_CLIENT_ID, "");
  assert.ok(development.d1_databases.some(b => b.binding === "DB"));
  assert.ok(development.kv_namespaces.some(b => b.binding === "KV"));
  assert.ok(development.r2_buckets.some(b => b.binding === "BUCKET"));
  assert.ok(development.durable_objects.bindings.some(b => b.name === "RATE_LIMITER"));
  assert.deepEqual(development.ratelimits.map(b => b.name).sort(), ["IMPORT_EXECUTE_RATE_LIMITER", "IMPORT_VALIDATE_RATE_LIMITER"]);
  assert.equal(development.send_email[0].remote, false);
  assert.equal(development.send_email[0].name, "EMAIL");
  assert.ok(wranglerArgs("dev").includes("--local"));
  assert.ok(!Object.keys(localEnvironment()).some(key => /^(CLOUDFLARE_|CF_API_|WORKERS_CI)/.test(key)));
});

test("local login helper rejects other origins and hosts before authenticating", async () => {
  const server = loginServer(18988);
  try {
    const page = await fetch("http://127.0.0.1:18988/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Sign in as local admin/);
    const denied = await fetch("http://127.0.0.1:18988/login", { method: "POST", headers: { Origin: "https://example.net" }, body: "role=admin" });
    assert.equal(denied.status, 403);
    const hostStatus = await new Promise((resolvePromise, reject) => {
      const req = request("http://127.0.0.1:18988/", { headers: { Host: "attacker.example" } }, response => { response.resume(); resolvePromise(response.statusCode); });
      req.on("error", reject); req.end();
    });
    assert.equal(hostStatus, 403);
  } finally { await new Promise(resolvePromise => server.close(resolvePromise)); }
});

test("IPC shutdown closes the sign-in server and exits naturally without killing the launcher", async () => {
  const module = pathToFileURL(resolve(ROOT, "scripts/local.mjs")).href;
  const script = `import { installShutdownHandlers, loginServer } from ${JSON.stringify(module)};
    const server = loginServer(0);
    installShutdownHandlers([], server);
    server.on('listening', () => process.send({ port: server.address().port }));`;
  for (const action of ["shutdown", "disconnect"]) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
    child.stdout.resume(); child.stderr.resume();
    let timedOut = false;
    // This kill is only a failed-test escape hatch. Successful shutdown must
    // close naturally, on Windows too, so taskkill cannot conceal an IPC leak.
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 3000);
    try {
      const exited = once(child, "exit");
      const [{ port }] = await once(child, "message");
      // The ephemeral port intentionally does not match the helper's fixed
      // Host allowlist; its rejection still proves the server is listening.
      assert.equal((await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })).status, 403);
      if (action === "shutdown") child.send("shutdown"); else child.disconnect();
      const [code, signal] = await exited;
      assert.equal(timedOut, false, `${action} must not require forced termination`);
      assert.equal(code, 0); assert.equal(signal, null);
      await assert.rejects(new Promise((resolvePromise, reject) => {
        const req = request(`http://127.0.0.1:${port}/`, { agent: false }, response => { response.resume(); resolvePromise(); });
        req.on("error", reject); req.setTimeout(1000, () => req.destroy(new Error("Socket stayed open"))); req.end();
      }), { code: "ECONNREFUSED" });
    } finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
  }
});

test("public export filters secrets, deployment data, screenshots and private discussion references", () => {
  for (const path of [".dev.vars", ".dev.vars.integration", "private/data.json", "docs/screenshots/user.png", ".github/workflows/cloudflare-emergency.yml"]) assert.equal(shouldOmit(path), true);
  assert.equal(shouldOmit("apps/worker/.dev.vars.example"), false);
  const privateRepository = ["private-owner", "private-project"].join("/");
  const input = `See [implementation](https://github.com/${privateRepository}/issues/123) and Issue ${"#"}123; https://study.private.test`;
  const sanitized = sanitizeText(input, { privateRepository, publicRepository: "public-owner/project", privateDomains: ["private.test"] });
  assert.ok(!sanitized.includes(privateRepository));
  assert.ok(!sanitized.includes("/issues/"));
  assert.ok(!sanitized.includes("private.test"));
  assert.deepEqual(scanText(sanitized, { privateRepository, privateDomains: ["private.test"] }), []);
  assert.ok(scanText("ghp_" + "X".repeat(36)).length > 0);
  const code = `// Uses ${"#"}58's existing rules\nconst colour = '#256';\nconst label = 'Saved question #12';`;
  const exportedCode = sanitizeText(code, { path: "source.ts", publicRepository: "public-owner/project" });
  assert.ok(!exportedCode.includes("#58"));
  assert.ok(exportedCode.includes("'#256'"));
  assert.ok(exportedCode.includes("'Saved question #12'"));
});

test("public configuration sanitization leaves the private deployment and local profile intact", async () => {
  const path = resolve(ROOT, "apps/worker/wrangler.toml");
  const original = await readFile(path, "utf8");
  const replacements = deploymentReplacements(original);
  assert.equal(replacements.length, 7);
  const exported = sanitizeText(original, { replacements, path: "apps/worker/wrangler.toml" });
  for (const [value, placeholder] of replacements) {
    if (value !== placeholder) assert.ok(!exported.includes(value));
    assert.ok(exported.includes(placeholder));
  }
  assert.ok(exported.includes('APP_BASE_URL = "http://localhost:5173"'));
  assert.match(exported, /\[\[env\.development\.send_email\]\]\s+name = "EMAIL"\s+remote = false/);
  assert.equal(await readFile(path, "utf8"), original);
  // Resource identifiers match no credential pattern, so only the private
  // configuration's own values can catch an unsanitized copy of them.
  assert.deepEqual(scanText(exported, { replacements }), []);
  for (const [value, placeholder] of replacements) {
    if (value === placeholder) continue;
    assert.deepEqual(scanText(`const id = "${value}";`, { replacements }), ["private deployment identifier"]);
  }
});

test("scanning a prepared snapshot re-derives the private policy instead of trusting the snapshot", async () => {
  const base = resolve(ROOT, ".local-state", `policy-test-${randomUUID()}`);
  const source = resolve(base, "source"), destination = resolve(base, "public");
  const git = (...args) => execFileSync("git", args, { cwd: source, encoding: "utf8", windowsHide: true });
  try {
    await mkdir(resolve(source, "apps/worker"), { recursive: true });
    await mkdir(resolve(source, "migrations"), { recursive: true });
    git("init", "-q"); git("config", "user.email", "test@example.test"); git("config", "user.name", "Policy test");
    git("remote", "add", "origin", "https://github.com/private-owner/private-project.git");
    await writeFile(resolve(source, "apps/worker/wrangler.toml"), '[[d1_databases]]\ndatabase_id = "private-database-id"\n');
    await writeFile(resolve(source, "migrations/0002_seed_sap_c02_questions.sql"), "-- restricted\n");
    await writeFile(resolve(source, "README.md"), "Generic application\n");
    git("add", "-A"); git("commit", "-qm", "source");
    const policy = sourcePolicy({ source });
    assert.equal(policy.privateRepository, "private-owner/private-project");
    assert.deepEqual(policy.replacements, [["private-database-id", "00000000-0000-0000-0000-000000000000"]]);
    // The snapshot itself must never carry the private identifiers, so the
    // manifest is not a usable source for this policy.
    await exportSnapshot({ source, destination, publicRepository: "public-owner/project" });
    const manifest = await readFile(resolve(destination, "public-export-manifest.json"), "utf8");
    assert.ok(!manifest.includes("private-owner"));
    assert.ok(!manifest.includes("private-database-id"));
    // A snapshot that reintroduces private content passes an empty policy and
    // must fail the policy the export actually applied.
    await writeFile(resolve(destination, "README.md"), "See https://github.com/private-owner/private-project\n");
    await assert.rejects(scanSnapshot(destination, policy), /private repository reference/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("initialized snapshot scanning validates committed bytes and rejects staged or unstaged substitutions", async () => {
  const base = resolve(ROOT, ".local-state", `snapshot-test-${randomUUID()}`);
  const source = resolve(base, "source"), destination = resolve(base, "public");
  await mkdir(resolve(source, "migrations"), { recursive: true });
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  const initialize = cwd => {
    git(cwd, "init", "-q");
    git(cwd, "config", "user.email", "test@example.test");
    git(cwd, "config", "user.name", "Snapshot test");
    git(cwd, "config", "core.autocrlf", "true");
  };
  try {
    initialize(source);
    git(source, "remote", "add", "origin", "https://github.com/private-owner/private-project.git");
    await writeFile(resolve(source, "README.md"), "Reviewed content\n");
    await writeFile(resolve(source, ".gitignore"), ".local-state/\n");
    await writeFile(resolve(source, ".gitattributes"), "*.md text eol=crlf\n");
    await writeFile(resolve(source, "migrations/0002_seed_sap_c02_questions.sql"), "-- Synthetic restricted seed\n");
    git(source, "add", "."); git(source, "commit", "-qm", "Source");
    await exportSnapshot({ source, destination, publicRepository: "public-owner/project" });
    initialize(destination);
    git(destination, "add", "."); git(destination, "commit", "-qm", "Initial snapshot");
    // A normal CRLF checkout and ignored validation files must still pass.
    const reviewedReadme = await readFile(resolve(destination, "README.md"), "utf8");
    await writeFile(resolve(destination, "README.md"), reviewedReadme.replace(/\r?\n/g, "\r\n"));
    await mkdir(resolve(destination, ".local-state"));
    await writeFile(resolve(destination, ".local-state", "ignored.txt"), "Local validation only");
    assert.equal((await scanSnapshot(destination)).history, "one initial commit");

    await writeFile(resolve(destination, "README.md"), "Unreviewed committed content\n");
    git(destination, "add", "README.md");
    git(destination, "commit", "--amend", "--no-edit", "-q");
    await assert.rejects(scanSnapshot(destination), /README.md: changed or unreviewed/);
    // Original P1: restore reviewed bytes in the worktree, leaving unsafe HEAD.
    await writeFile(resolve(destination, "README.md"), reviewedReadme);
    await assert.rejects(scanSnapshot(destination), /index\/worktree/);
    git(destination, "add", "README.md");
    await assert.rejects(scanSnapshot(destination), /index\/worktree/);
    git(destination, "commit", "--amend", "--no-edit", "-q");
    assert.equal((await scanSnapshot(destination)).history, "one initial commit");

    // A working-tree manifest must not replace the committed manifest either.
    const manifestPath = resolve(destination, "public-export-manifest.json");
    const manifest = await readFile(manifestPath);
    await writeFile(manifestPath, '{"files":{}}\n');
    git(destination, "add", "public-export-manifest.json");
    git(destination, "commit", "--amend", "--no-edit", "-q");
    await writeFile(manifestPath, manifest);
    await assert.rejects(scanSnapshot(destination), /index\/worktree/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("export uses only the reviewed current tree and never copies private Git history", async () => {
  const base = resolve(ROOT, ".local-state", `export-test-${randomUUID()}`);
  const source = resolve(base, "source");
  const destination = resolve(base, "public");
  await mkdir(resolve(source, "migrations"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: source, encoding: "utf8", windowsHide: true });
  try {
    git("init", "-q"); git("config", "user.email", "test@example.test"); git("config", "user.name", "Export test");
    git("remote", "add", "origin", "https://github.com/private-owner/private-project.git");
    await writeFile(resolve(source, "old-secret.txt"), "old restricted question material");
    git("add", "."); git("commit", "-qm", "private historical content");
    await rm(resolve(source, "old-secret.txt"));
    await writeFile(resolve(source, "README.md"), "Generic application\n");
    await writeFile(resolve(source, "migrations/0002_seed_sap_c02_questions.sql"), "INSERT INTO private_data VALUES ('restricted question');\n");
    await writeFile(resolve(source, ".dev.vars"), "SESSION_SECRET=not-public\n");
    await mkdir(resolve(source, "apps/worker"), { recursive: true });
    const config = '[[d1_databases]]\ndatabase_id = "private-database-id"\n[vars]\nGOOGLE_CLIENT_ID = "private-client-id"\nAPP_BASE_URL = "https://study.private.test"\n';
    await writeFile(resolve(source, "apps/worker/wrangler.toml"), config);
    await writeFile(resolve(source, "apps/worker/worker-configuration.d.ts"), 'interface Env { GOOGLE_CLIENT_ID: "private-client-id"; }\n');
    git("add", "-A"); git("commit", "-qm", "current working snapshot");
    const result = await exportSnapshot({ source, destination, publicRepository: "public-owner/project" });
    assert.equal(result.history, "none");
    assert.ok(!(await readdir(destination)).includes(".git"));
    assert.ok(!(await readdir(destination)).includes("old-secret.txt"));
    assert.ok(!(await readFile(resolve(destination, "migrations/0002_seed_sap_c02_questions.sql"), "utf8")).includes("restricted question"));
    assert.ok(!(await readFile(resolve(destination, "apps/worker/wrangler.toml"), "utf8")).includes("private-database-id"));
    assert.ok(!(await readFile(resolve(destination, "apps/worker/worker-configuration.d.ts"), "utf8")).includes("private-client-id"));
    assert.equal(await readFile(resolve(source, "apps/worker/wrangler.toml"), "utf8"), config);
    await assert.rejects(exportSnapshot({ source, destination, publicRepository: "public-owner/project" }), /directory exists/);
    const publicGit = (...args) => execFileSync("git", args, { cwd: destination, encoding: "utf8", windowsHide: true });
    publicGit("init", "-q"); publicGit("config", "user.email", "test@example.test"); publicGit("config", "user.name", "Export test");
    publicGit("add", "."); publicGit("commit", "-qm", "Initial public snapshot");
    assert.equal((await scanSnapshot(destination)).history, "one initial commit");
    assert.equal(publicGit("rev-list", "--all", "--count").trim(), "1");
    assert.equal(publicGit("remote").trim(), "");
    await writeFile(resolve(destination, "README.md"), "modified after review");
    await assert.rejects(scanSnapshot(destination), /changed or unreviewed/);
    await writeFile(resolve(source, "private-token.txt"), "ghp_" + "X".repeat(36));
    git("add", "."); git("commit", "-qm", "credential fixture");
    await assert.rejects(checkSourceSecrets(source), /possible credential/);
    await assert.rejects(exportSnapshot({ source, destination: resolve(base, "rejected"), publicRepository: "public-owner/project" }), /possible credential/);
    await rm(resolve(source, "private-token.txt"));
    await writeFile(resolve(source, "unreviewed.png"), Buffer.from([0, 1, 2, 3]));
    git("add", "-A"); git("commit", "-qm", "binary asset fixture");
    await assert.rejects(exportSnapshot({ source, destination: resolve(base, "rejected-asset"), publicRepository: "public-owner/project" }), /Binary asset needs a reviewed/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
