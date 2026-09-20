import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../apps/worker/src/lib/password.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const STATE = resolve(ROOT, ".local-state");
export const ACCOUNT = { email: "admin@prepdeck.test", password: "prepdeck-local-only" };
export const USER_ACCOUNT = { email: "user@prepdeck.test", password: "prepdeck-local-only" };
const WORKER = resolve(ROOT, "apps/worker");
const WRANGLER = resolve(ROOT, "node_modules/wrangler/bin/wrangler.js");
const CONFIG = resolve(WORKER, "wrangler.toml");

// Every command uses the local simulator even if the shell has cloud credentials.
export function localEnvironment() {
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" };
  for (const key of Object.keys(env)) {
    if (/^(CLOUDFLARE_|CF_API_|WORKERS_CI|WRANGLER_ENV)/.test(key)) delete env[key];
  }
  return env;
}

export function runNode(script, args = [], options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT, env: localEnvironment(), stdio: "inherit", windowsHide: true, ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`Command failed (${code ?? signal}): ${script}`)));
  });
}

export const wranglerArgs = (...args) => [...args, "--config", CONFIG, "--env", "development", "--local", "--persist-to", STATE];

export function stopProcess(child, group = false) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try { execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); } catch { /* Already exited. */ }
  } else {
    const signal = name => {
      try { if (group) process.kill(-child.pid, name); else child.kill(name); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    };
    signal("SIGTERM");
    // Kill the whole detached service group if a wrapper or descendant keeps
    // inherited output pipes open after graceful shutdown.
    const deadline = setTimeout(() => signal("SIGKILL"), 2000);
    if (!group) {
      deadline.unref();
      child.once("close", () => clearTimeout(deadline));
    }
    // A group leader may exit before its descendants. Keep the group deadline
    // referenced until all of them receive the fallback signal.
  }
}

export function installShutdownHandlers(children, login) {
  let stopping = false;
  const stop = code => {
    if (stopping) return; stopping = true;
    login?.close();
    login?.closeAllConnections();
    for (const child of children) stopProcess(child, true);
    // A message listener references Node's IPC channel. exitCode alone cannot
    // terminate the launcher while the smoke-test parent remains connected.
    if (process.connected) process.disconnect();
    process.exitCode = code;
  };
  process.on("SIGINT", () => stop(0)); process.on("SIGTERM", () => stop(0));
  process.on("message", message => { if (message === "shutdown") stop(0); });
  process.on("disconnect", () => stop(0));
  return stop;
}

export async function sql(statement) {
  await mkdir(STATE, { recursive: true });
  const path = resolve(STATE, `query-${randomBytes(8).toString("hex")}.sql`);
  await writeFile(path, statement);
  try { await runNode(WRANGLER, wranglerArgs("d1", "execute", "prepdeck", "--file", path, "--yes")); }
  finally { await rm(path, { force: true }); }
}

const quote = value => `'${value.replaceAll("'", "''")}'`;

export async function seed() {
  const passwordHash = await hashPassword(ACCOUNT.password);
  const now = "2026-01-01T00:00:00.000Z";
  const statements = [];
  for (const [id, account, role] of [["local-admin", ACCOUNT, "admin"], ["local-user", USER_ACCOUNT, "user"]]) {
    statements.push(`INSERT INTO users (id,email,display_name,role,status,password_hash,created_at)
      VALUES (${quote(id)},${quote(account.email)},${quote(`Local ${role}`)},${quote(role)},'active',${quote(passwordHash)},${quote(now)}) ON CONFLICT(id) DO NOTHING;`);
  }
  statements.push(`INSERT OR IGNORE INTO providers (id,name,short_name,created_at) VALUES ('local-provider','Local examples','Demo',${quote(now)});`,
    `INSERT OR IGNORE INTO exams (id,slug,name,subject,language,created_at) VALUES ('local-exam','local-examples','Local practice examples','General knowledge','en',${quote(now)});`,
    "INSERT OR IGNORE INTO provider_exams (provider_id,exam_id) VALUES ('local-provider','local-exam');");
  const questions = [
    { id: "local-single", type: "single_choice", stem: "What is two plus two?", options: [{ id: "A", text: "Four" }, { id: "B", text: "Five" }], answers: ["A"], explanation: "Adding two and two gives four." },
    { id: "local-multiple", type: "multiple_choice", stem: "Select the even numbers.", options: [{ id: "A", text: "Two" }, { id: "B", text: "Three" }, { id: "C", text: "Four" }], answers: ["A", "C"], explanation: "Two and four are divisible by two." },
    { id: "local-fill", type: "fill_blank", stem: "What color results from mixing blue and yellow paint?", answers: ["green"], explanation: "Blue and yellow paint combine to make green." },
  ];
  questions.forEach((q, index) => statements.push(`INSERT INTO questions (id,exam_id,external_id,sequence_number,type,stem,options_json,correct_answers_json,explanation,difficulty,points,created_at,updated_at)
    SELECT ${quote(q.id)},'local-exam',${quote(q.id)},${index + 1},${quote(q.type)},${quote(q.stem)},${q.options ? quote(JSON.stringify(q.options)) : "NULL"},${quote(JSON.stringify(q.answers))},${quote(q.explanation)},'easy',1,${quote(now)},${quote(now)}
    WHERE NOT EXISTS (SELECT 1 FROM questions WHERE id=${quote(q.id)});`));
  await sql(statements.join("\n"));
  console.log(`Local admin: ${ACCOUNT.email} / ${ACCOUNT.password}\nLocal user: ${USER_ACCOUNT.email} / ${USER_ACCOUNT.password}`);
}

export async function setup() {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Use Node.js 24 or newer for the local tools and tests.");
  await mkdir(STATE, { recursive: true });
  const varsPath = resolve(WORKER, ".dev.vars.development");
  if (!existsSync(varsPath)) await writeFile(varsPath, `# Generated for local development only.\nSESSION_SECRET=${randomBytes(32).toString("hex")}\n`);
  await runNode(resolve(WORKER, "scripts/precompile-prompts.mjs"), [], { cwd: WORKER });
  await runNode(resolve(ROOT, "node_modules/vite/bin/vite.js"), ["build"], { cwd: resolve(ROOT, "apps/web") });
  await runNode(WRANGLER, wranglerArgs("d1", "migrations", "apply", "prepdeck"));
  await seed();
  await writeFile(resolve(STATE, "ready.json"), JSON.stringify({ version: 1 }));
  console.log("Setup complete. Run npm run dev, then open http://localhost:8788 to sign in.");
}

export async function reset() {
  // Never derive a deletion target from a CLI argument or environment variable.
  const inside = relative(ROOT, STATE);
  if (!inside || inside.startsWith(`..${sep}`) || inside !== ".local-state") throw new Error("Invalid local state directory.");
  await rm(STATE, { recursive: true, force: true });
  await setup();
}

export function loginServer(port = 8788) {
  const token = randomBytes(24).toString("hex");
  const origin = `http://localhost:${port}`;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' http://localhost:5173; frame-ancestors 'none'");
    if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(req.headers.host)) { res.writeHead(403); res.end(); return; }
    if (req.method === "GET" && req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PrepDeck local sign-in</title><style>body{font:18px system-ui;max-width:36rem;margin:5rem auto;padding:1rem}button{font:inherit;padding:.7rem;margin:.5rem}</style><h1>PrepDeck local development</h1><p>Sign in to the local database. These accounts are created by dev:setup.</p><form method="post" action="/login"><input type="hidden" name="token" value="${token}"><button name="role" value="admin">Sign in as local admin</button><button name="role" value="user">Sign in as local user</button></form></html>`);
      return;
    }
    if (req.method !== "POST" || req.url !== "/login" || req.headers.origin !== origin) { res.writeHead(403); res.end(); return; }
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 1024) { res.writeHead(413); res.end(); return; } }
    const form = new URLSearchParams(raw);
    if (form.get("token") !== token) { res.writeHead(403); res.end(); return; }
    try {
      const account = form.get("role") === "user" ? USER_ACCOUNT : ACCOUNT;
      const response = await fetch("http://127.0.0.1:8787/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(account),
      });
      if (!response.ok) throw new Error(`Local sign-in failed (${response.status}). Run npm run dev:setup and check the Worker terminal.`);
      res.setHeader("Set-Cookie", response.headers.getSetCookie());
      res.writeHead(303, { Location: "http://localhost:5173" }); res.end();
    } catch (error) { res.writeHead(503, { "Content-Type": "text/plain" }); res.end(error.message); }
  });
  server.listen(port, "127.0.0.1");
  return server;
}

export async function start(workerOnly = false) {
  if (!existsSync(resolve(STATE, "ready.json"))) throw new Error("Local setup is missing. Run npm run dev:setup first.");
  const vars = await readFile(resolve(WORKER, ".dev.vars.development"), "utf8");
  if (!/^SESSION_SECRET=.+/m.test(vars)) throw new Error("Missing local SESSION_SECRET. Run npm run dev:setup after fixing .dev.vars.development.");
  const children = [];
  const stop = installShutdownHandlers(children, workerOnly ? undefined : loginServer());
  const launch = (script, args, cwd = ROOT) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: localEnvironment(), stdio: "inherit", windowsHide: true, detached: process.platform !== "win32" });
    children.push(child);
    child.on("error", error => { console.error(error.message); stop(1); });
    child.on("exit", code => stop(code ?? 1));
  };
  launch(WRANGLER, wranglerArgs("dev", "--ip", "127.0.0.1", "--port", "8787", "--test-scheduled", "--show-interactive-dev-session=false", "--types=false"));
  if (!workerOnly) {
    launch(resolve(ROOT, "node_modules/vite/bin/vite.js"), ["--host", "127.0.0.1", "--strictPort"], resolve(ROOT, "apps/web"));
    console.log("Web: http://localhost:5173\nLocal sign-in: http://localhost:8788");
  }
}

export async function scheduled(job) {
  const cron = { cleanup: "17 3 * * *", email: "*/15 * * * *" }[job];
  if (!cron) throw new Error("Use npm run dev:scheduled -- cleanup or email.");
  const response = await fetch(`http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=${encodeURIComponent(cron)}`);
  if (!response.ok) throw new Error(`Scheduled request failed: ${response.status}`);
  console.log(await response.text());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  const commands = { setup, seed, reset, start, worker: () => start(true), login: () => loginServer(), scheduled: () => scheduled(process.argv[3]) };
  try { if (!commands[action]) throw new Error("Expected setup, seed, reset, start, worker, login or scheduled."); await commands[action](); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
