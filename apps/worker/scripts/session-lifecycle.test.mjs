// Issue #46: signing out used to clear only the browser's cookie; the signed
// token itself stayed valid for its whole 7-day life. These drive the real
// auth routes and middleware on node:sqlite with an in-memory KV.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Hono } from "hono";

async function bundle(path) {
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"] });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const [{ authRouter }, { adminUsersRouter }, { requireAccessUser }, session] = await Promise.all([
  bundle("../src/routes/auth.ts"), bundle("../src/routes/adminUsers.ts"), bundle("../src/middleware/access.ts"), bundle("../src/lib/session.ts"),
]);
const SECRET = "synthetic-test-session-key";

function setup(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  db.exec(`INSERT INTO users (id,email,role,status,created_at) VALUES ('alice','alice@test','user','active','2026-09-09'), ('root','root@test','admin','active','2026-09-09')`);
  const kv = new Map();
  const DB = { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { const r = db.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; } };
  } };
  const KV = {
    async get(key, type) { const v = kv.get(key); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(key, value) { kv.set(key, value); },
    async delete(key) { kv.delete(key); },
  };
  const env = { DB, KV, AUTH_MODE: "cookie", SESSION_SECRET: SECRET };
  const app = new Hono();
  app.route("/auth", authRouter);
  const api = new Hono();
  api.use("*", requireAccessUser);
  api.get("/whoami", c => c.json({ id: c.get("user").id }));
  api.route("/admin/users", adminUsersRouter);
  app.route("/api", api);
  const call = (path, token, init = {}) => app.request(`https://test${path}`, { ...init, headers: { ...(token ? { Cookie: `pd_session=${encodeURIComponent(token)}` } : {}), ...(init.headers ?? {}) } }, env);
  const version = id => db.prepare("SELECT session_version AS v FROM users WHERE id = ?").get(id).v;
  return { db, env, kv, call, version };
}

test("signing out ends the token, and every other session of the account", async t => {
  const { env, call, version } = setup(t);
  const laptop = await session.issueSessionToken(env, "alice");
  const phone = await session.issueSessionToken(env, "alice");
  assert.equal((await call("/api/whoami", laptop)).status, 200);
  assert.equal((await call("/api/whoami", phone)).status, 200);

  const out = await call("/auth/logout", laptop, { method: "POST" });
  assert.equal(out.status, 200);
  assert.match(out.headers.get("Set-Cookie"), /pd_session=;.*Max-Age=0/);
  assert.equal(version("alice"), 1);
  assert.equal((await call("/api/whoami", laptop)).status, 401, "the signed-out token is refused");
  assert.equal((await call("/api/whoami", phone)).status, 401, "so is every other session of the account");

  const again = await session.issueSessionToken(env, "alice");
  assert.equal((await call("/api/whoami", again)).status, 200, "signing in again works");
});

test("an old token cannot sign the account out again", async t => {
  const { env, call, version } = setup(t);
  const old = await session.issueSessionToken(env, "alice");
  await call("/auth/logout", old, { method: "POST" });
  const current = await session.issueSessionToken(env, "alice");
  assert.equal((await call("/auth/logout", old, { method: "POST" })).status, 200, "still clears the cookie");
  assert.equal(version("alice"), 1, "but a stale token does not move the version");
  assert.equal((await call("/api/whoami", current)).status, 200);
});

test("the cached user row is dropped on sign-out, so the next request reads the new version", async t => {
  const { env, kv, call } = setup(t);
  const token = await session.issueSessionToken(env, "alice");
  await call("/api/whoami", token);
  assert.ok([...kv.keys()].some(k => k.includes("alice")), "the row was cached");
  await call("/auth/logout", token, { method: "POST" });
  assert.equal([...kv.keys()].some(k => k.includes("alice")), false);
  // A cached row older than the version column is not trusted either.
  kv.set("user-cache:id:alice", JSON.stringify({ id: "alice", email: "alice@test", role: "user", status: "active", display_name: null, avatar_url: null }));
  assert.equal((await call("/api/whoami", token)).status, 401);
});

test("revoking an account ends its sessions", async t => {
  const { env, call, version } = setup(t);
  const alice = await session.issueSessionToken(env, "alice");
  const root = await session.issueSessionToken(env, "root");
  const revoked = await call("/api/admin/users/alice", root, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "revoked" }) });
  assert.equal(revoked.status, 200, await revoked.text());
  assert.equal(version("alice"), 1);
  assert.notEqual((await call("/api/whoami", alice)).status, 200);
});

test("tokens from before session versions, and malformed versions, are refused", async t => {
  const { env, call } = setup(t);
  const sign = async payload => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url");
    return `${payload}.${signature}`;
  };
  const expires = Date.now() + 60_000;
  for (const payload of [`alice.${expires}`, `v2.alice.x.${expires}`, `v2.alice.-1.${expires}`, `v1.alice.0.${expires}`, `v2.alice.0.${Date.now() - 1}`]) {
    assert.equal(await session.verifySessionToken(await sign(payload), env), null, payload);
    assert.equal((await call("/api/whoami", await sign(payload))).status, 401, payload);
  }
  assert.deepEqual(await session.verifySessionToken(await sign(`v2.a.b.c.0.${expires}`), env), { userId: "a.b.c", sessionVersion: 0 }, "fields are read from both ends");
});
