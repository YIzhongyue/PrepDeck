// Issue #102 — interoperability with a real, independently implemented MCP
// client: the official MCP TypeScript SDK client (@modelcontextprotocol/client
// 2.x), not a hand-written imitation of one. It runs in-process against the
// real Worker entry through its `fetch` option, so it exercises exactly what a
// deployed client would: the 401 challenge, protected-resource and
// authorization-server discovery, dynamic client registration, the
// authorization-code + PKCE flow (with RFC 9207 `iss`), refresh, and scope
// step-up. A second client uses the same SDK with a manually configured PAT.
//
// The only stand-in is the browser: "redirectToAuthorization" follows the
// authorization URL with an already signed-in session and clicks Allow,
// through the same endpoints the consent screen calls.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { auth, Client, StreamableHTTPClientTransport, UnauthorizedError } from "@modelcontextprotocol/client";

const [{ text }] = (await build({
  stdin: {
    contents: `export { default as worker } from './src/index.ts';
      export { issueSessionToken } from './src/lib/session.ts';
      export { issueMcpCredential } from './src/mcp/credentials.ts';`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, format: "esm", platform: "node", conditions: ["workerd"], write: false,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
})).outputFiles;
const buildDir = await mkdtemp(join(tmpdir(), "prepdeck-mcp-interop-test-"));
after(() => rm(buildDir, { recursive: true, force: true }));
await writeFile(join(buildDir, "worker.mjs"), text);
const { worker, issueSessionToken, issueMcpCredential } = await import(pathToFileURL(join(buildDir, "worker.mjs")).href);

const BASE = "https://prepdeck.test";
const CALLBACK = "http://127.0.0.1:33418/callback";

function setup(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  db.exec("INSERT INTO users (id, email, role, status, created_at) VALUES ('alice', 'alice@example.test', 'user', 'active', '2026-09-09')");
  const methods = (sql, values) => ({
    async first() { return db.prepare(sql).get(...values) ?? null; },
    async all() { return { results: db.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }; },
  });
  const DB = {
    prepare: (sql) => ({ bind: (...values) => methods(sql, values), ...methods(sql, []) }),
    async batch(statements) { const results = []; for (const s of statements) results.push(await s.run()); return results; },
  };
  const kv = new Map();
  const env = {
    DB, ENVIRONMENT: "production", AUTH_MODE: "cookie", APP_BASE_URL: BASE, SESSION_SECRET: "synthetic-test-session-key", MCP_OAUTH_ENABLED: "true",
    KV: { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
    RATE_LIMITER: { idFromName: (key) => key, get: () => ({ fetch: async () => Response.json({ allowed: true, retryAfter: 60 }) }) },
  };
  const requests = [];
  const workerFetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    return worker.fetch(request, env);
  };
  return { db, env, requests, workerFetch };
}

/** An in-memory OAuthClientProvider whose "browser" is signed in to PrepDeck and approves. */
async function signedInProvider(f) {
  const session = `pd_session=${encodeURIComponent(await issueSessionToken(f.env, "alice"))}`;
  const store = { approvals: 0 };
  const provider = {
    get redirectUrl() { return CALLBACK; },
    get clientMetadata() {
      return { client_name: "SDK interop client", redirect_uris: [CALLBACK], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
    },
    clientInformation: () => store.client,
    saveClientInformation: (client) => { store.client = client; },
    tokens: () => store.tokens,
    saveTokens: (tokens) => { store.tokens = tokens; },
    saveCodeVerifier: (verifier) => { store.verifier = verifier; },
    codeVerifier: () => store.verifier,
    saveDiscoveryState: (state) => { store.discovery = state; },
    discoveryState: () => store.discovery,
    async redirectToAuthorization(url) {
      const authorize = await f.workerFetch(url, { redirect: "manual" });
      assert.equal(authorize.status, 302);
      const consent = new URL(authorize.headers.get("Location"), BASE);
      assert.equal(consent.pathname, "/connect", `authorization was refused: ${consent}`);
      const binding = authorize.headers.get("Set-Cookie").split(";")[0];
      const approve = await f.workerFetch(`${BASE}/api/oauth/requests/${consent.searchParams.get("request")}/approve`, {
        method: "POST", headers: { Cookie: `${session}; ${binding}`, "Content-Type": "application/json", Origin: BASE },
      });
      const { redirectTo } = await approve.json();
      assert.ok(redirectTo.startsWith(`${CALLBACK}?`));
      store.callback = new URL(redirectTo).searchParams;
      store.approvals++;
    },
  };
  return { provider, store };
}

/** What a host does: connect, and on UnauthorizedError finish the browser round trip and connect again. */
async function connect(f, provider, store) {
  const transport = () => new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { authProvider: provider, fetch: f.workerFetch });
  const first = transport();
  const client = new Client({ name: "prepdeck-interop", version: "1.0.0" });
  try {
    await client.connect(first);
    return client;
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    await first.finishAuth(store.callback);
  }
  const again = new Client({ name: "prepdeck-interop", version: "1.0.0" });
  await again.connect(transport());
  return again;
}

test("the official MCP SDK client discovers, registers, authorizes with PKCE and calls User MCP tools", async (t) => {
  const f = setup(t);
  const { provider, store } = await signedInProvider(f);
  const client = await connect(f, provider, store);

  // Discovery started from the 401 challenge, not from configuration.
  for (const step of ["POST /mcp", "GET /.well-known/oauth-protected-resource/mcp", "GET /.well-known/oauth-authorization-server",
    "POST /api/oauth/register", "GET /api/oauth/authorize", "POST /api/oauth/token"]) {
    assert.ok(f.requests.includes(step), `${step} in ${f.requests.join(", ")}`);
  }
  assert.ok(f.requests.indexOf("POST /mcp") < f.requests.indexOf("GET /.well-known/oauth-protected-resource/mcp"));
  assert.match(store.client.client_id, /^pdc_/);
  assert.match(store.tokens.access_token, /^pd_oat_user_/);
  assert.equal(store.approvals, 1);

  const { tools } = await client.listTools();
  assert.ok(tools.some((tool) => tool.name === "user_get_identity"));
  const identity = await client.callTool({ name: "user_get_identity", arguments: {} });
  assert.deepEqual(identity.structuredContent, { ok: true, data: { userId: "alice", server: "user" } });
  await client.close();
});

test("the SDK client refreshes an expired access token without another interactive authorization", async (t) => {
  const f = setup(t);
  const { provider, store } = await signedInProvider(f);
  const client = await connect(f, provider, store);
  const { refresh_token: before } = store.tokens;
  f.db.exec("UPDATE mcp_oauth_tokens SET expires_at = 1 WHERE kind = 'access'");

  const identity = await client.callTool({ name: "user_get_identity", arguments: {} });
  assert.equal(identity.structuredContent.ok, true);
  assert.notEqual(store.tokens.refresh_token, before, "the refresh token was rotated");
  assert.equal(store.approvals, 1, "no second consent");
  await client.close();
});

test("the SDK client steps up from a read-only grant when a write tool answers 403 insufficient_scope", async (t) => {
  const f = setup(t);
  const { provider, store } = await signedInProvider(f);
  // A host that asks for read access only, through the SDK's own auth().
  const serverUrl = new URL(`${BASE}/mcp`);
  assert.equal(await auth(provider, { serverUrl, scope: "mcp:user:read", fetchFn: f.workerFetch }), "REDIRECT");
  assert.equal(await auth(provider, { serverUrl, authorizationCode: store.callback.get("code"), iss: store.callback.get("iss"), fetchFn: f.workerFetch }), "AUTHORIZED");
  assert.equal(store.tokens.scope, "mcp:user:read");

  const client = new Client({ name: "prepdeck-interop", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(serverUrl, { authProvider: provider, fetch: f.workerFetch });
  await client.connect(transport);
  const listed = (await client.listTools()).tools;
  assert.ok(listed.length > 0 && !listed.some((tool) => tool.name === "user_create_knowledge_point_group"), "write tools are not listed for a read-only grant");

  // The 403 challenge makes the SDK start a new authorization for the union of
  // the granted and challenged scopes; as for the first connection, the host
  // finishes the browser round trip and retries.
  const call = () => client.callTool({ name: "user_create_knowledge_point_group", arguments: { name: "interop" } });
  await assert.rejects(call(), UnauthorizedError);
  await transport.finishAuth(store.callback);
  const created = await call();
  assert.equal(created.structuredContent?.ok, true, JSON.stringify(created));
  assert.ok(f.requests.includes("POST /mcp"));
  assert.equal(store.approvals, 2, "one step-up consent");
  const grants = f.db.prepare("SELECT scopes FROM mcp_oauth_grants ORDER BY created_at").all().map((row) => row.scopes);
  assert.deepEqual(grants, ["mcp:user:read", "mcp:user:read mcp:user:write"]);
  await client.close();
});

test("the same SDK connects with a manually configured personal access token and no OAuth", async (t) => {
  const f = setup(t);
  const pat = await issueMcpCredential(f.env.DB, { userId: "alice", audience: "user", name: "manual" });
  const client = new Client({ name: "prepdeck-pat", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    fetch: f.workerFetch, requestInit: { headers: { Authorization: `Bearer ${pat.token}` } },
  }));
  const identity = await client.callTool({ name: "user_get_identity", arguments: {} });
  assert.deepEqual(identity.structuredContent, { ok: true, data: { userId: "alice", server: "user" } });
  assert.ok(!f.requests.some((r) => r.includes("oauth")), "a PAT client never touches OAuth");
  await client.close();
});
