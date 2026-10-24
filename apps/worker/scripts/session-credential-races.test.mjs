import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { importTs } from "../../../tests/support/bundle.mjs";
import { openDatabase } from "../../../tests/support/migrations.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { createKv } from "../../../tests/support/kv.mjs";
import { createRateLimiter } from "../../../tests/support/rate-limit.mjs";
const { requireAccessUser, adminUsersRouter, createMcpTokensRouter, issueSessionToken, buildSessionCookie,
  issueMcpCredential, createAuthorizationRequest, decideAuthorizationRequest, registerDynamicClient, oauthRouter } = await importTs([
  new URL("../src/middleware/access.ts", import.meta.url),
  new URL("../src/routes/adminUsers.ts", import.meta.url),
  new URL("../src/routes/mcpTokens.ts", import.meta.url),
  new URL("../src/lib/session.ts", import.meta.url),
  new URL("../src/mcp/credentials.ts", import.meta.url),
  new URL("../src/mcp/oauth/grants.ts", import.meta.url),
  new URL("../src/mcp/oauth/clients.ts", import.meta.url),
  new URL("../src/mcp/oauth/routes.ts", import.meta.url),
]);
const BASE = "https://app.example.test";
async function setup(t) {
  const db = openDatabase(t);
  db.exec("INSERT INTO users(id,email,role,status,created_at,google_sub) VALUES('alice','alice@example.test','user','active','2026-01-01','old-sub'),('root','root@example.test','admin','active','2026-01-01','root-sub')");
  let beforeInsert;
  const env = {
    DB: createD1(db, { onQuery: async ({ sql }) => {
      if (beforeInsert && /INSERT INTO mcp_(credentials|oauth_grants)/.test(sql)) {
        const callback = beforeInsert; beforeInsert = null; await callback();
      }
    } }), KV: createKv(), RATE_LIMITER: createRateLimiter(), AUTH_MODE: "cookie", ENVIRONMENT: "production",
    SESSION_SECRET: "synthetic-race-secret", APP_BASE_URL: BASE, MCP_OAUTH_ENABLED: "true",
  };
  const app = new Hono();
  app.use("*", requireAccessUser);
  app.route("/admin/users", adminUsersRouter);
  app.route("/mcp-tokens", createMcpTokensRouter("user"));
  app.route("/oauth", oauthRouter);
  const alice = await issueSessionToken(env, "alice"), root = await issueSessionToken(env, "root");
  const call = (path, token, body, method = "POST", extraCookie = "", headers = {}) => app.request(`${BASE}${path}`, {
    method, headers: { "Content-Type": "application/json", Origin: BASE,
      Cookie: `${buildSessionCookie(token, true).split(";")[0]}; ${extraCookie}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
  const resetBeforeInsert = () => { beforeInsert = async () => {
    assert.equal((await call("/admin/users/alice", root, { googleSub: null }, "PATCH")).status, 200);
    assert.equal(db.prepare("SELECT session_version FROM users WHERE id = 'alice'").get().session_version, 1);
  }; };
  return { app, db, env, alice, call, resetBeforeInsert };
}
async function authorization(f) {
  const registered = await registerDynamicClient(f.env.DB, { redirect_uris: ["https://client.example/callback"] });
  return createAuthorizationRequest(f.env.DB, {
    client: { id: registered.body.client_id }, redirectUri: "https://client.example/callback", audience: "user",
    scopes: ["mcp:user:read"], state: null, codeChallenge: "a".repeat(43),
  });
}

test("browser PAT creation admitted before reset cannot mint durable access afterward", async (t) => {
  const f = await setup(t);
  f.resetBeforeInsert();
  assert.equal((await f.call("/mcp-tokens", f.alice, { name: "racing token" })).status, 400);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mcp_credentials").get().n, 0);
});

test("PAT rotation admitted before reset cannot mint its successor afterward", async (t) => {
  const f = await setup(t);
  const issued = await issueMcpCredential(f.env.DB, { sessionVersion: 0, userId: "alice", audience: "user", name: "predecessor" });
  f.resetBeforeInsert();
  assert.equal((await f.call(`/mcp-tokens/${issued.id}/rotate`, f.alice)).status, 500);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mcp_credentials WHERE revoked_at IS NULL").get().n, 0);
});

test("OAuth consent admitted before reset cannot create a grant or authorization code afterward", async (t) => {
  const f = await setup(t);
  const request = await authorization(f);
  f.resetBeforeInsert();
  const response = await f.call(`/oauth/requests/${request.id}/approve`, f.alice, undefined, "POST", `pd_mcp_authz=${request.binding}`);
  assert.equal(response.status, 200);
  assert.equal(new URL((await response.json()).redirectTo).searchParams.get("error"), "access_denied");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mcp_oauth_grants").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mcp_oauth_codes").get().n, 0);
});

test("credential helpers fail closed on missing or invalid captured session versions", async (t) => {
  const f = await setup(t);
  const request = await authorization(f);
  for (const sessionVersion of [undefined, null, -1, 0.5, "0", Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(issueMcpCredential(f.env.DB, { sessionVersion, userId: "alice", audience: "user", name: "invalid" }));
    assert.equal((await decideAuthorizationRequest(f.env.DB, { sessionVersion, id: request.id, binding: request.binding, userId: "alice", approve: true })).ok, false);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mcp_credentials").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mcp_oauth_grants").get().n, 0);
});

test("OAuth consent rejects opaque, foreign and absent origins without consuming request", async (t) => {
  const f = await setup(t);
  const request = await authorization(f);
  for (const origin of ["null", "https://sibling.example.test", ""]) {
    const response = await f.call(`/oauth/requests/${request.id}/approve`, f.alice, undefined, "POST", `pd_mcp_authz=${request.binding}`, { Origin: origin });
    assert.equal(response.status, 403);
  }
  const absent = await f.app.request(`${BASE}/oauth/requests/${request.id}/approve`, {
    method: "POST", headers: { Cookie: `${buildSessionCookie(f.alice, true).split(";")[0]}; pd_mcp_authz=${request.binding}` },
  }, f.env);
  assert.equal(absent.status, 403);
  assert.equal(f.db.prepare("SELECT decided_at FROM mcp_oauth_requests WHERE id = ?").get(request.id).decided_at, null);
});
