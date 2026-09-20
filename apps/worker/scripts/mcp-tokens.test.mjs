import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Hono } from "hono";

// implementation — self-service MCP token lifecycle (create/list/revoke/rotate)
// for both /api/mcp-tokens (User MCP) and /api/admin/mcp-tokens (Admin MCP).
// Exercises the real route module against an in-memory D1-shaped SQLite DB,
// same lightweight harness as exam-scope.test.mjs — the MCP protocol/auth
// boundary itself is covered separately in mcp-foundation.test.mjs.

async function bundle(path) {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}

const { createMcpTokensRouter } = await bundle("../src/routes/mcpTokens.ts");

function setup() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, dir), "utf8"));
  for (const [id, role, status] of [["alice", "user", "active"], ["bob", "user", "active"], ["admin", "admin", "active"]]) {
    db.prepare("INSERT INTO users(id, email, role, status, created_at) VALUES (?, ?, ?, ?, ?)").run(id, `${id}@test`, role, status, "2026-09-09");
  }

  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return db.prepare(sql).get(...values) ?? null; },
        async all() { return { results: db.prepare(sql).all(...values) }; },
        async run() { return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }; },
      };
    },
  };
  const env = { DB };

  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", { id: c.req.header("x-user") ?? "alice", role: c.req.header("x-role") ?? "user" });
    await next();
  });
  app.route("/mcp-tokens", createMcpTokensRouter("user"));
  app.route("/admin/mcp-tokens", createMcpTokensRouter("admin"));

  const request = async (path, { user = "alice", role = "user", method = "GET", body } = {}) => {
    const response = await app.request(`https://test${path}`, {
      method, headers: { "x-user": user, "x-role": role, "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, env);
    return { status: response.status, body: await response.json() };
  };
  return { db, env, request };
}

test("a user can create, list, and revoke their own User MCP token", async () => {
  const { request } = setup();
  const create = await request("/mcp-tokens", { method: "POST", body: { name: "local-cli" } });
  assert.equal(create.status, 201);
  assert.equal(create.body.credential.name, "local-cli");
  assert.equal(create.body.credential.status, "active");
  assert.equal(create.body.credential.expiresAt, null);
  assert.match(create.body.token, /^pd_mcp_user_[a-f0-9]{64}$/);

  const list = await request("/mcp-tokens");
  assert.equal(list.status, 200);
  assert.equal(list.body.credentials.length, 1);
  assert.equal(list.body.credentials[0].id, create.body.credential.id);
  assert.ok(!("token" in list.body.credentials[0]));
  assert.ok(!("tokenHash" in list.body.credentials[0]));
  assert.ok(!JSON.stringify(list.body).includes(create.body.token));

  const revoke = await request(`/mcp-tokens/${create.body.credential.id}/revoke`, { method: "POST" });
  assert.equal(revoke.status, 200);
  const after = await request("/mcp-tokens");
  assert.equal(after.body.credentials[0].status, "revoked");
  assert.ok(typeof after.body.credentials[0].revokedAt === "number");
});

test("a user cannot see, revoke, or rotate another user's token", async () => {
  const { request } = setup();
  const { body: { credential } } = await request("/mcp-tokens", { method: "POST", body: { name: "alice-token" } });

  const bobList = await request("/mcp-tokens", { user: "bob" });
  assert.deepEqual(bobList.body.credentials, []);

  const bobRevoke = await request(`/mcp-tokens/${credential.id}/revoke`, { user: "bob", method: "POST" });
  assert.equal(bobRevoke.status, 404);

  const bobRotate = await request(`/mcp-tokens/${credential.id}/rotate`, { user: "bob", method: "POST" });
  assert.equal(bobRotate.status, 404);

  // Untouched by another user's failed attempts.
  const aliceList = await request("/mcp-tokens");
  assert.equal(aliceList.body.credentials[0].status, "active");
});

test("name is required and bounded; expiresInDays is optional and validated", async () => {
  const { request } = setup();
  for (const body of [{}, { name: "" }, { name: "   " }, { name: "x".repeat(101) }, { name: 42 }]) {
    const res = await request("/mcp-tokens", { method: "POST", body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  for (const expiresInDays of [0, -1, 1.5, "30", 3651]) {
    const res = await request("/mcp-tokens", { method: "POST", body: { name: "x", expiresInDays } });
    assert.equal(res.status, 400, JSON.stringify(expiresInDays));
  }
  const noExpiry = await request("/mcp-tokens", { method: "POST", body: { name: "no expiry" } });
  assert.equal(noExpiry.body.credential.expiresAt, null);

  const before = Date.now();
  const withExpiry = await request("/mcp-tokens", { method: "POST", body: { name: "30 days", expiresInDays: 30 } });
  assert.equal(withExpiry.status, 201);
  const expectedMs = 30 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(withExpiry.body.credential.expiresAt - (before + expectedMs)) < 5000);
});

test("revoking or rotating an unknown token id returns 404", async () => {
  const { request } = setup();
  assert.equal((await request("/mcp-tokens/does-not-exist/revoke", { method: "POST" })).status, 404);
  assert.equal((await request("/mcp-tokens/does-not-exist/rotate", { method: "POST" })).status, 404);
});

test("rotating a token issues a replacement with the same name and relative lifetime, and revokes the original", async () => {
  const { request } = setup();
  const before = Date.now();
  const created = await request("/mcp-tokens", { method: "POST", body: { name: "ci-runner", expiresInDays: 10 } });
  const id = created.body.credential.id;

  const rotated = await request(`/mcp-tokens/${id}/rotate`, { method: "POST" });
  assert.equal(rotated.status, 201);
  assert.notEqual(rotated.body.token, created.body.token);
  assert.notEqual(rotated.body.credential.id, id);
  assert.equal(rotated.body.credential.name, "ci-runner");
  const expectedMs = 10 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(rotated.body.credential.expiresAt - (before + expectedMs)) < 5000);

  const list = await request("/mcp-tokens");
  assert.equal(list.body.credentials.length, 2);
  const old = list.body.credentials.find((c) => c.id === id);
  const fresh = list.body.credentials.find((c) => c.id === rotated.body.credential.id);
  assert.equal(old.status, "revoked");
  assert.equal(fresh.status, "active");
});

test("rotating an already-revoked token is rejected", async () => {
  const { request } = setup();
  const created = await request("/mcp-tokens", { method: "POST", body: { name: "x" } });
  const id = created.body.credential.id;
  await request(`/mcp-tokens/${id}/revoke`, { method: "POST" });
  const rotate = await request(`/mcp-tokens/${id}/rotate`, { method: "POST" });
  assert.equal(rotate.status, 409);
});

// Regression coverage for a review finding: rotation used to issue the
// replacement first and revoke the predecessor after, without checking the
// revoke's result. That let two concurrent rotations of the same token both
// succeed (two active replacements), and a failure between issuance and
// revocation left both records active. The fix revokes the predecessor
// first via the same compare-and-swap UPDATE a plain revoke uses, so
// claiming it is a mutex: only one caller can ever proceed to issue a
// replacement for a given id.
test("concurrent rotate calls on the same token yield exactly one replacement, never two active credentials", async () => {
  const { request } = setup();
  const created = await request("/mcp-tokens", { method: "POST", body: { name: "concurrent" } });
  const id = created.body.credential.id;

  const [a, b] = await Promise.all([
    request(`/mcp-tokens/${id}/rotate`, { method: "POST" }),
    request(`/mcp-tokens/${id}/rotate`, { method: "POST" }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const winner = a.status === 201 ? a : b;

  const list = await request("/mcp-tokens");
  const active = list.body.credentials.filter((t) => t.status === "active");
  const revoked = list.body.credentials.filter((t) => t.status === "revoked");
  assert.equal(active.length, 1, "exactly one active credential must survive a rotation race");
  assert.equal(active[0].id, winner.body.credential.id);
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].id, id);
});

test("a rotate racing a plain revoke on the same token has exactly one winner, never two active credentials", async () => {
  const { request } = setup();
  const created = await request("/mcp-tokens", { method: "POST", body: { name: "race" } });
  const id = created.body.credential.id;

  const [rotate, revoke] = await Promise.all([
    request(`/mcp-tokens/${id}/rotate`, { method: "POST" }),
    request(`/mcp-tokens/${id}/revoke`, { method: "POST" }),
  ]);
  // Whichever request's UPDATE flips revoked_at first wins the mutex; the
  // other must lose (409/404 for rotate/revoke respectively), regardless of
  // interleaving order.
  const outcome = [rotate.status, revoke.status];
  assert.ok(
    (outcome[0] === 201 && outcome[1] === 404) || (outcome[0] === 409 && outcome[1] === 200),
    `unexpected outcome: rotate=${rotate.status} revoke=${revoke.status}`
  );

  const list = await request("/mcp-tokens");
  const active = list.body.credentials.filter((t) => t.status === "active");
  assert.ok(active.length <= 1, `expected at most one active credential, got ${active.length}`);
});

test("a failure between claiming (revoking) the predecessor and issuing the replacement leaves it revoked, never leaves two active credentials", async () => {
  const { request, env } = setup();
  const created = await request("/mcp-tokens", { method: "POST", body: { name: "flaky" } });
  const id = created.body.credential.id;

  // From here on, only the replacement's INSERT fails; the revoke's UPDATE
  // (and every other query) still goes through to the real DB unchanged.
  const realDB = env.DB;
  env.DB = { prepare(sql) {
    if (sql.includes("INSERT INTO mcp_credentials")) {
      return { bind: () => ({ run: async () => { throw new Error("simulated DB failure"); } }) };
    }
    return realDB.prepare(sql);
  } };

  const rotate = await request(`/mcp-tokens/${id}/rotate`, { method: "POST" });
  assert.equal(rotate.status, 500);

  env.DB = realDB;
  const list = await request("/mcp-tokens");
  assert.equal(list.body.credentials.length, 1, "the failed replacement must never be committed");
  assert.equal(list.body.credentials[0].id, id);
  assert.equal(list.body.credentials[0].status, "revoked", "the predecessor must still be claimed/revoked, not left active");
});

test("Admin MCP token routes require admin authorization and use a separate namespace from User MCP", async () => {
  const { request } = setup();
  for (const method of ["GET", "POST"]) {
    const res = await request("/admin/mcp-tokens", { user: "alice", role: "user", method, body: method === "POST" ? { name: "x" } : undefined });
    assert.equal(res.status, 403, method);
  }

  const created = await request("/admin/mcp-tokens", { user: "admin", role: "admin", method: "POST", body: { name: "local-codex" } });
  assert.equal(created.status, 201);
  assert.match(created.body.token, /^pd_mcp_admin_[a-f0-9]{64}$/);

  // The admin's own User MCP token list must not include their Admin MCP token, and vice versa.
  const adminUserTokens = await request("/mcp-tokens", { user: "admin", role: "admin" });
  assert.deepEqual(adminUserTokens.body.credentials, []);
  const adminAdminTokens = await request("/admin/mcp-tokens", { user: "admin", role: "admin" });
  assert.equal(adminAdminTokens.body.credentials.length, 1);
  assert.equal(adminAdminTokens.body.credentials[0].name, "local-codex");
});
