// Issue #102 — MCP OAuth authorization alongside personal access tokens.
// Drives the real Worker entry (discovery, /api/oauth/*, the consent
// endpoints behind the real session middleware, and both MCP endpoints) on
// node:sqlite with every migration applied, an in-memory KV and a counting
// rate-limiter stub. Google sign-in itself is covered by oauth-return-to and
// google-identity tests; here a browser "is signed in" by holding a session
// cookie minted with the Worker's own session module.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const [{ text }] = (await build({
  stdin: {
    contents: `export { default as worker } from './src/index.ts';
      export { issueSessionToken } from './src/lib/session.ts';
      export { issueMcpCredential } from './src/mcp/credentials.ts';
      export { runMcpOAuthPrune } from './src/scheduled/pruneMcpOAuth.ts';
      export { validRedirectUri, redirectUriAllowed, isMetadataDocumentClientId } from './src/mcp/oauth/clients.ts';`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, format: "esm", platform: "node", conditions: ["workerd"], write: false,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
})).outputFiles;
const buildDir = await mkdtemp(join(tmpdir(), "prepdeck-mcp-oauth-test-"));
after(() => rm(buildDir, { recursive: true, force: true }));
const bundlePath = join(buildDir, "worker.mjs");
await writeFile(bundlePath, text);
const { worker, issueSessionToken, issueMcpCredential, runMcpOAuthPrune, validRedirectUri, redirectUriAllowed, isMetadataDocumentClientId } =
  await import(pathToFileURL(bundlePath).href);

const BASE = "https://prepdeck.test";
const REDIRECT = "https://client.example/callback";

function setup(t, overrides = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  for (const [id, role] of [["alice", "user"], ["bob", "user"], ["root", "admin"]]) {
    db.prepare("INSERT INTO users (id, email, role, status, created_at) VALUES (?, ?, ?, 'active', '2026-09-09')").run(id, `${id}@example.test`, role);
  }
  const queries = [];
  const DB = {
    prepare(sql) {
      const methods = (values) => ({
        async first() { queries.push(sql); return db.prepare(sql).get(...values) ?? null; },
        async all() { queries.push(sql); return { results: db.prepare(sql).all(...values) }; },
        async run() { queries.push(sql); return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }; },
      });
      return { bind: (...values) => methods(values), ...methods([]) };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  const kv = new Map();
  const KV = {
    async get(key, type) { const v = kv.get(key); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(key, value) { kv.set(key, value); },
    async delete(key) { kv.delete(key); },
  };
  const limits = [];
  const metrics = [];
  const env = {
    MCP_METRICS_ENABLED: "true", MCP_METRICS: { writeDataPoint: (point) => metrics.push(structuredClone(point)) },
    DB, KV, ENVIRONMENT: "production", AUTH_MODE: "cookie", APP_BASE_URL: BASE, SESSION_SECRET: "synthetic-test-session-key",
    MCP_OAUTH_ENABLED: "true",
    RATE_LIMITER: { idFromName: (key) => key, get: (key) => ({ fetch: async () => {
      limits.push(key);
      return Response.json({ allowed: true, retryAfter: 60 });
    } }) },
    ...overrides,
  };
  const fetchWorker = (path, init = {}) => worker.fetch(new Request(path.startsWith("http") ? path : `${BASE}${path}`, {
    ...init, headers: { "CF-Connecting-IP": "192.0.2.1", ...(init.headers ?? {}) },
  }), env);
  return { db, env, queries, limits, metrics, kv, fetchWorker };
}

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

async function register(f, metadata = {}) {
  const response = await f.fetchWorker("/api/oauth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Test Client", redirect_uris: [REDIRECT], ...metadata }),
  });
  return { response, body: await response.json() };
}

async function session(f, userId) {
  return `pd_session=${encodeURIComponent(await issueSessionToken(f.env, userId))}`;
}

function authorizeUrl(params) {
  const url = new URL("/api/oauth/authorize", BASE);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}

/** Runs /authorize and returns the consent request id plus the browser's binding cookie. */
async function startAuthorization(f, { clientId, audience = "user", scope, state = "client-state", challenge, redirectUri = REDIRECT, resource } = {}) {
  const response = await f.fetchWorker(authorizeUrl({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", state,
    code_challenge: challenge, code_challenge_method: "S256",
    resource: resource ?? `${BASE}${audience === "admin" ? "/admin-mcp" : "/mcp"}`, scope,
  }));
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("Location"), BASE);
  assert.equal(location.pathname, "/connect", `expected consent hand-off, got ${location}`);
  const requestId = location.searchParams.get("request");
  const setCookie = response.headers.get("Set-Cookie");
  assert.match(setCookie, new RegExp(`Path=/api/oauth/requests/${requestId};`));
  assert.match(setCookie, /HttpOnly/);
  return { requestId, binding: setCookie.split(";")[0] };
}

async function consent(f, { requestId, binding }, cookie, action = "approve") {
  const response = await f.fetchWorker(`/api/oauth/requests/${requestId}/${action}`, {
    method: "POST", headers: { Cookie: [cookie, binding].filter(Boolean).join("; "), "Content-Type": "application/json", Origin: BASE },
  });
  return { response, body: await response.json() };
}

async function token(f, form) {
  const response = await f.fetchWorker("/api/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString(),
  });
  return { response, body: await response.json() };
}

/** Registration → authorization → consent → code exchange, as an OAuth-capable client does it. */
async function connect(f, { userId = "alice", audience = "user", scope } = {}) {
  const { body: client } = await register(f);
  const { verifier, challenge } = await pkce();
  const request = await startAuthorization(f, { clientId: client.client_id, audience, scope, challenge });
  const decision = await consent(f, request, await session(f, userId));
  assert.equal(decision.response.status, 200, JSON.stringify(decision.body));
  const redirect = new URL(decision.body.redirectTo);
  assert.equal(`${redirect.origin}${redirect.pathname}`, REDIRECT);
  assert.equal(redirect.searchParams.get("state"), "client-state");
  assert.equal(redirect.searchParams.get("iss"), BASE);
  const code = redirect.searchParams.get("code");
  assert.match(code, /^pd_oac_[a-f0-9]{64}$/);
  const exchanged = await token(f, { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier, resource: `${BASE}${audience === "admin" ? "/admin-mcp" : "/mcp"}` });
  assert.equal(exchanged.response.status, 200, JSON.stringify(exchanged.body));
  return { client, code, verifier, tokens: exchanged.body };
}

function rpc(f, audience, bearer, method = "tools/list", params, headers = {}) {
  return f.fetchWorker(audience === "admin" ? "/admin-mcp" : "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function payload(response) {
  const body = await response.text();
  if (response.headers.get("Content-Type")?.includes("text/event-stream")) return JSON.parse(body.match(/^data: (.+)$/m)[1]);
  return JSON.parse(body);
}

test("discovery documents name both MCP resources and PrepDeck as their authorization server", async (t) => {
  const f = setup(t);
  for (const [path, audience, scopes] of [["/mcp", "user", ["mcp:user:read", "mcp:user:write"]], ["/admin-mcp", "admin", ["mcp:admin:read", "mcp:admin:write"]]]) {
    const response = await f.fetchWorker(`/.well-known/oauth-protected-resource${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    const metadata = await response.json();
    assert.equal(metadata.resource, `${BASE}${path}`, audience);
    assert.deepEqual(metadata.authorization_servers, [BASE]);
    assert.deepEqual(metadata.scopes_supported, scopes);
    assert.deepEqual(metadata.bearer_methods_supported, ["header"]);
  }
  const as = await (await f.fetchWorker("/.well-known/oauth-authorization-server")).json();
  assert.equal(as.issuer, BASE);
  assert.equal(as.authorization_endpoint, `${BASE}/api/oauth/authorize`);
  assert.equal(as.token_endpoint, `${BASE}/api/oauth/token`);
  assert.equal(as.registration_endpoint, `${BASE}/api/oauth/register`);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal(as.client_id_metadata_document_supported, true);
  const preflight = await f.fetchWorker("/api/oauth/token", { method: "OPTIONS", headers: { Origin: "https://inspector.example", "Access-Control-Request-Method": "POST" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal((await f.fetchWorker("/.well-known/oauth-protected-resource/elsewhere")).status, 404);
});

test("discovery and every worker-first route stay out of the SPA fallback", async () => {
  const config = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  const workerFirst = JSON.parse(config.match(/^run_worker_first = (\[.+\])$/m)[1]);
  for (const path of ["/.well-known/oauth-protected-resource/*", "/.well-known/oauth-authorization-server", "/api/*"]) {
    assert.ok(workerFirst.includes(path), path);
  }
  assert.ok(!workerFirst.some((pattern) => pattern.startsWith("/connect")), "/connect is the SPA's consent screen");
});

test("a 401 names the resource metadata so a client can discover OAuth; an invalid token says so", async (t) => {
  const f = setup(t);
  for (const [path, audience] of [["/mcp", "mcp"], ["/admin-mcp", "admin-mcp"]]) {
    const missing = await rpc(f, path === "/mcp" ? "user" : "admin", null);
    assert.equal(missing.status, 401);
    const challenge = missing.headers.get("WWW-Authenticate");
    assert.match(challenge, /^Bearer realm="PrepDeck MCP"/);
    assert.match(challenge, new RegExp(`resource_metadata="${BASE}/\\.well-known/oauth-protected-resource/${audience}"`));
    assert.match(challenge, /scope="mcp:(user|admin):read mcp:(user|admin):write"/);
    assert.doesNotMatch(challenge, /error=/);
    assert.equal(missing.headers.get("Content-Type")?.includes("text/html"), false, "never a login page");
    assert.equal(missing.headers.get("Location"), null, "never a login redirect");
  }
  const invalid = await rpc(f, "user", `pd_oat_user_${"0".repeat(64)}`);
  assert.equal(invalid.status, 401);
  assert.match(invalid.headers.get("WWW-Authenticate"), /error="invalid_token"/);
});

test("with OAuth switched off, PATs work, OAuth endpoints are absent and the challenge is the PAT-era one", async (t) => {
  const f = setup(t);
  const { tokens } = await connect(f);
  f.env.MCP_OAUTH_ENABLED = "false";
  for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource/mcp"]) {
    assert.equal((await f.fetchWorker(path)).status, 404, path);
  }
  assert.equal((await register(f)).response.status, 404);
  assert.equal((await token(f, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: "x" })).response.status, 404);
  const authorize = await f.fetchWorker(authorizeUrl({ client_id: "x" }));
  assert.equal(authorize.headers.get("Location"), "/connect?error=unavailable");
  const refused = await rpc(f, "user", tokens.access_token);
  assert.equal(refused.status, 401, "outstanding OAuth tokens are refused while OAuth is off");
  assert.equal(refused.headers.get("WWW-Authenticate"), 'Bearer realm="PrepDeck MCP", error="invalid_token"');
  const pat = await issueMcpCredential(f.env.DB, { userId: "alice", audience: "user", name: "cli" });
  assert.equal((await rpc(f, "user", pat.token)).status, 200);
  f.env.MCP_OAUTH_ENABLED = "true";
  assert.equal((await rpc(f, "user", tokens.access_token)).status, 200, "and resume, unexpired, when it is switched back on");
});

test("an OAuth client completes registration, consent, PKCE code exchange and an authenticated User MCP tool call", async (t) => {
  const f = setup(t);
  const { tokens } = await connect(f);
  assert.match(tokens.access_token, /^pd_oat_user_[a-f0-9]{64}$/);
  assert.match(tokens.refresh_token, /^pd_ort_user_[a-f0-9]{64}$/);
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.expires_in, 3600);
  assert.equal(tokens.scope, "mcp:user:read mcp:user:write");

  const call = await payload(await rpc(f, "user", tokens.access_token, "tools/call", { name: "user_get_identity", arguments: {} }));
  assert.deepEqual(call.result.structuredContent, { ok: true, data: { userId: "alice", server: "user" } });

  // Only digests are stored.
  const stored = JSON.stringify(f.db.prepare("SELECT * FROM mcp_oauth_tokens").all()) + JSON.stringify(f.db.prepare("SELECT * FROM mcp_oauth_codes").all());
  assert.ok(!stored.includes(tokens.access_token) && !stored.includes(tokens.refresh_token));
  const grant = f.db.prepare("SELECT user_id, audience, scopes, last_used_at FROM mcp_oauth_grants").get();
  assert.equal(grant.user_id, "alice");
  assert.equal(grant.audience, "user");
  assert.ok(grant.last_used_at > 0, "last use is tracked on the grant");
});

test("authorization requests are validated before anything is shown or redirected", async (t) => {
  const f = setup(t);
  const { body: client } = await register(f);
  const { challenge } = await pkce();
  const base = { client_id: client.client_id, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s", resource: `${BASE}/mcp` };
  const go = async (params) => {
    const response = await f.fetchWorker(authorizeUrl({ ...base, ...params }));
    assert.equal(response.status, 302);
    return new URL(response.headers.get("Location"), BASE);
  };
  // Not safe to redirect: explained on PrepDeck's own page.
  assert.equal((await go({ client_id: "pdc_unknown" })).search, "?error=invalid_client");
  assert.equal((await go({ redirect_uri: "https://attacker.example/callback" })).search, "?error=invalid_redirect_uri");
  assert.equal((await go({ redirect_uri: `${REDIRECT}/extra` })).search, "?error=invalid_redirect_uri");
  const duplicate = await f.fetchWorker(`${authorizeUrl(base)}&client_id=${client.client_id}`);
  assert.equal(duplicate.headers.get("Location"), "/connect?error=invalid_request");
  // Safe to redirect: the client gets an OAuth error with its state and our issuer.
  for (const [params, error] of [
    [{ response_type: "token" }, "unsupported_response_type"],
    [{ code_challenge: undefined }, "invalid_request"],
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ resource: "https://elsewhere.example/mcp" }, "invalid_target"],
    [{ scope: "mcp:admin:read" }, "invalid_scope"],
    [{ resource: undefined, scope: "mcp:user:read mcp:admin:read" }, "invalid_scope"],
    [{ resource: "" }, "invalid_target"],
  ]) {
    const location = await go(params);
    assert.equal(`${location.origin}${location.pathname}`, REDIRECT, JSON.stringify(params));
    assert.equal(location.searchParams.get("error"), error, JSON.stringify(params));
    assert.equal(location.searchParams.get("state"), "s");
    assert.equal(location.searchParams.get("iss"), BASE);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_requests").get().n, 0, "no transaction for a refused request");
  // Without `resource`, the scopes pick the audience; without either, User MCP.
  for (const [scope, audience] of [["mcp:admin:read", "admin"], [undefined, "user"]]) {
    const location = await go({ resource: undefined, scope });
    assert.equal(location.pathname, "/connect");
    assert.equal(f.db.prepare("SELECT audience FROM mcp_oauth_requests WHERE id = ?").get(location.searchParams.get("request")).audience, audience);
  }
});

test("redirect URIs: https, loopback http on any port, private-use schemes; never script, fragments or remote http", () => {
  for (const uri of [REDIRECT, "http://127.0.0.1:33418/callback", "http://localhost/cb", "cursor://anysphere.cursor-retrieval/oauth/callback", "com.example.app:/oauth"]) {
    assert.equal(validRedirectUri(uri), uri, uri);
  }
  for (const uri of ["javascript:alert(1)", "data:text/html,x", "http://client.example/cb", "https://client.example/cb#frag", "https://user:pw@client.example/cb", "file:///etc/passwd", "relative/path", "", 42]) {
    assert.equal(validRedirectUri(uri), null, String(uri));
  }
  assert.ok(redirectUriAllowed(["http://127.0.0.1/callback"], "http://127.0.0.1:51234/callback"));
  assert.ok(!redirectUriAllowed(["http://127.0.0.1/callback"], "http://127.0.0.1:51234/other"));
  assert.ok(!redirectUriAllowed(["https://client.example/cb"], "https://client.example:8443/cb"));
  assert.ok(isMetadataDocumentClientId("https://client.example/oauth/metadata.json"));
  for (const id of ["https://client.example/", "http://client.example/m.json", "https://127.0.0.1/m.json", "https://localhost/m.json", "https://client.example/m.json?x=1", "pdc_abc",
    "https://localhost./m.json", "https://client.example./m.json", "https://2130706433/m.json", "https://0x7f.1/m.json", "https://[::1]/m.json",
    "https://10.0.0.1/m.json", "https://metadata.internal/m.json", "https://printer.local/m.json", "https://intranet/m.json", "https://client.example:8443/m.json"]) {
    assert.ok(!isMetadataDocumentClientId(id), id);
  }
});

test("dynamic registration issues a public client and refuses unusable metadata", async (t) => {
  const f = setup(t);
  const { response, body } = await register(f, { token_endpoint_auth_method: "client_secret_basic" });
  assert.equal(response.status, 201);
  assert.match(body.client_id, /^pdc_[a-f0-9]{32}$/);
  assert.equal(body.token_endpoint_auth_method, "none", "every client is public");
  assert.ok(!("client_secret" in body));
  assert.deepEqual(body.grant_types, ["authorization_code", "refresh_token"]);
  for (const metadata of [{ redirect_uris: [] }, { redirect_uris: ["http://client.example/cb"] }, { redirect_uris: ["javascript:x"] },
    { grant_types: ["client_credentials"] }, { response_types: ["token"] }, { client_name: "x".repeat(101) }]) {
    const refused = await register(f, metadata);
    assert.equal(refused.response.status, 400, JSON.stringify(metadata));
    assert.match(refused.body.error, /^invalid_(redirect_uri|client_metadata)$/);
  }
});

test("a Client ID Metadata Document client is fetched, must name itself, and is cached", async (t) => {
  const f = setup(t);
  const clientId = "https://client.example/oauth/client.json";
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let fetches = 0;
  let document = { client_id: clientId, client_name: "Metadata Client", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), clientId);
    assert.equal(init.redirect, "manual", "disable redirects using a mode supported by Workers");
    fetches++;
    return Response.json(document);
  };
  const { challenge } = await pkce();
  const { requestId, binding } = await startAuthorization(f, { clientId, challenge });
  const view = await (await f.fetchWorker(`/api/oauth/requests/${requestId}`, { headers: { Cookie: `${await session(f, "alice")}; ${binding}` } })).json();
  assert.deepEqual(view.client, { id: clientId, name: "Metadata Client", kind: "metadata_document", redirectTarget: "client.example" });
  await startAuthorization(f, { clientId, challenge });
  assert.equal(fetches, 1, "cached within the refresh window");

  const impostor = "https://client.example/oauth/impostor.json";
  document = { ...document, client_id: clientId };
  globalThis.fetch = async () => Response.json(document);
  const refused = await f.fetchWorker(authorizeUrl({ client_id: impostor, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" }));
  assert.equal(refused.headers.get("Location"), "/connect?error=invalid_client", "a document naming another client_id is refused");
});

test("a metadata document client is accepted when the methods it supports include none (issue #109)", async (t) => {
  const f = setup(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const base = { client_name: "Codex", redirect_uris: [REDIRECT] };
  const cases = [
    // Codex/ChatGPT: supports none, prefers private_key_jwt.
    [{ token_endpoint_auth_methods_supported: ["none", "private_key_jwt"], token_endpoint_auth_method: "private_key_jwt" }, true],
    [{ token_endpoint_auth_methods_supported: ["none"] }, true],
    [{ token_endpoint_auth_method: "none" }, true],
    [{}, true],
    [{ token_endpoint_auth_methods_supported: ["private_key_jwt"] }, false],
    [{ token_endpoint_auth_methods_supported: ["private_key_jwt"], token_endpoint_auth_method: "none" }, false],
    [{ token_endpoint_auth_method: "private_key_jwt" }, false],
    [{ token_endpoint_auth_methods_supported: "none" }, false],
    [{ token_endpoint_auth_methods_supported: [] }, false],
    [{ token_endpoint_auth_methods_supported: ["none", 42] }, false],
  ];
  const { verifier, challenge } = await pkce();
  for (const [index, [methods, accepted]] of cases.entries()) {
    const clientId = `https://client.example/oauth/client-${index}.json`;
    globalThis.fetch = async (_url, init) => {
      // Node accepts redirect: "error", but the deployed Workers runtime
      // throws before making the request. Model that runtime boundary here.
      if (init.redirect === "error") throw new TypeError('Invalid redirect value: "error"');
      return Response.json({ client_id: clientId, ...base, ...methods });
    };
    const response = await f.fetchWorker(authorizeUrl({
      client_id: clientId, redirect_uri: REDIRECT, response_type: "code", state: "client-state",
      code_challenge: challenge, code_challenge_method: "S256", resource: `${BASE}/mcp`,
    }));
    const location = new URL(response.headers.get("Location"), BASE);
    assert.equal(location.searchParams.get("error"), accepted ? null : "invalid_client", JSON.stringify(methods));
    assert.equal(location.searchParams.has("request"), accepted, JSON.stringify(methods));
  }

  // The Codex-shaped client completes the flow as a public client.
  const clientId = "https://client.example/oauth/client-0.json";
  const request = await startAuthorization(f, { clientId, challenge });
  const decision = await consent(f, request, await session(f, "alice"));
  assert.equal(decision.response.status, 200, JSON.stringify(decision.body));
  const code = new URL(decision.body.redirectTo).searchParams.get("code");
  const exchanged = await token(f, { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier, resource: `${BASE}/mcp` });
  assert.equal(exchanged.response.status, 200, JSON.stringify(exchanged.body));
  assert.match(exchanged.body.access_token, /^pd_oat_user_/);
});

test("CIMD redirects are rejected without following Location or storing the response document", async (t) => {
  const f = setup(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const { challenge } = await pkce();
  for (const status of [301, 302, 303, 307, 308]) {
    const clientId = `https://client.example/oauth/redirect-${status}.json`;
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), redirect: init.redirect });
      // Even a valid-looking document in a 3xx body is not authoritative.
      return Response.json({ client_id: clientId, redirect_uris: [REDIRECT] }, {
        status, headers: { Location: "http://127.0.0.1/private-client.json" },
      });
    };
    const response = await f.fetchWorker(authorizeUrl({
      client_id: clientId, redirect_uri: REDIRECT, response_type: "code",
      code_challenge: challenge, code_challenge_method: "S256",
    }));
    assert.equal(response.headers.get("Location"), "/connect?error=invalid_client");
    assert.deepEqual(calls, [{ url: clientId, redirect: "manual" }]);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_clients WHERE id = ?").get(clientId).n, 0);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_requests").get().n, 0);
});

test("the consent screen needs the signed-in browser that started the request", async (t) => {
  const f = setup(t);
  const { body: client } = await register(f);
  const { challenge } = await pkce();
  const request = await startAuthorization(f, { clientId: client.client_id, challenge, scope: "mcp:user:read" });
  const view = (cookie) => f.fetchWorker(`/api/oauth/requests/${request.requestId}`, { headers: cookie ? { Cookie: cookie } : {} });

  assert.equal((await view(request.binding)).status, 401, "no browser session: the SPA shows Google sign-in");
  const alice = await session(f, "alice");
  assert.equal((await view(alice)).status, 404, "another browser (no binding cookie) cannot see or decide it");
  const shown = await view(`${alice}; ${request.binding}`);
  assert.equal(shown.status, 200);
  const body = await shown.json();
  assert.equal(body.client.name, "Test Client");
  assert.equal(body.client.kind, "dynamic");
  assert.equal(body.client.redirectTarget, "client.example");
  assert.equal(body.audience, "user");
  assert.equal(body.resource, `${BASE}/mcp`);
  assert.deepEqual(body.scopes, ["mcp:user:read"]);
  assert.equal(body.account.email, "alice@example.test");
  assert.equal(body.eligible, true);

  // A bearer token can never stand in for the browser session.
  const pat = await issueMcpCredential(f.env.DB, { userId: "alice", audience: "user", name: "cli" });
  assert.equal((await f.fetchWorker(`/api/oauth/requests/${request.requestId}`, { headers: { Cookie: request.binding, Authorization: `Bearer ${pat.token}` } })).status, 401);
  // A cross-site form post is refused even with the cookies.
  const crossSite = await f.fetchWorker(`/api/oauth/requests/${request.requestId}/approve`, { method: "POST", headers: { Cookie: `${alice}; ${request.binding}`, Origin: "https://attacker.example" } });
  assert.equal(crossSite.status, 403);
  assert.equal((await consent(f, request, alice, "approve")).response.status, 200);
  assert.equal((await consent(f, request, alice, "approve")).response.status, 404, "decided exactly once");
});

test("denial, expiry and an unknown request return the user to the client or explain recovery", async (t) => {
  const f = setup(t);
  const { body: client } = await register(f);
  const { challenge } = await pkce();
  const alice = await session(f, "alice");
  const denied = await consent(f, await startAuthorization(f, { clientId: client.client_id, challenge }), alice, "deny");
  const location = new URL(denied.body.redirectTo);
  assert.equal(location.searchParams.get("error"), "access_denied");
  assert.equal(location.searchParams.get("state"), "client-state");
  assert.equal(location.searchParams.get("code"), null);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_grants").get().n, 0);

  const stale = await startAuthorization(f, { clientId: client.client_id, challenge });
  f.db.prepare("UPDATE mcp_oauth_requests SET expires_at = ? WHERE id = ?").run(Date.now() - 1, stale.requestId);
  const expired = await f.fetchWorker(`/api/oauth/requests/${stale.requestId}`, { headers: { Cookie: `${alice}; ${stale.binding}` } });
  assert.equal(expired.status, 404);
  assert.match((await expired.json()).error, /expired.*connect again/);
  assert.equal((await consent(f, stale, alice)).response.status, 404);
});

test("code exchange enforces PKCE, client, redirect URI, expiry and single use", async (t) => {
  const f = setup(t);
  const { body: client } = await register(f);
  const alice = await session(f, "alice");
  const issueCode = async () => {
    const { verifier, challenge } = await pkce();
    const { body } = await consent(f, await startAuthorization(f, { clientId: client.client_id, challenge }), alice);
    return { code: new URL(body.redirectTo).searchParams.get("code"), verifier };
  };
  const exchange = (code, verifier, overrides = {}) => token(f, { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier, ...overrides });

  for (const [overrides, label] of [
    [{ code_verifier: "x".repeat(43) }, "wrong verifier"],
    [{ code_verifier: undefined }, "missing verifier"],
    [{ client_id: "pdc_other" }, "wrong client"],
    [{ redirect_uri: "https://client.example/other" }, "wrong redirect"],
    [{ resource: `${BASE}/admin-mcp` }, "wrong resource"],
  ]) {
    const { code, verifier } = await issueCode();
    const form = { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier, ...overrides };
    for (const [key, value] of Object.entries(form)) if (value === undefined) delete form[key];
    const { response, body } = await token(f, form);
    assert.equal(response.status, 400, label);
    assert.match(body.error, /^invalid_(grant|request|target)$/, label);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }

  const expired = await issueCode();
  f.db.prepare("UPDATE mcp_oauth_codes SET expires_at = ?").run(Date.now() - 1);
  assert.equal((await exchange(expired.code, expired.verifier)).body.error, "invalid_grant");

  // Concurrent redemption: the code is claimed atomically, so at most one
  // request can get tokens, and the second presentation revokes the grant —
  // with any tokens the first was issued — since one presenter is not the client.
  const contested = await issueCode();
  const codeHash = (code) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)).then((d) => Buffer.from(d).toString("hex"));
  const grantId = f.db.prepare("SELECT grant_id FROM mcp_oauth_codes WHERE code_hash = ?").get(await codeHash(contested.code)).grant_id;
  const results = await Promise.all([exchange(contested.code, contested.verifier), exchange(contested.code, contested.verifier)]);
  assert.ok(results.filter((r) => r.response.status === 200).length <= 1);
  for (const { body } of results) {
    if (body.access_token) assert.equal((await rpc(f, "user", body.access_token)).status, 401, "replay revoked the grant");
  }
  assert.equal(f.db.prepare("SELECT revoke_reason FROM mcp_oauth_grants WHERE id = ?").get(grantId).revoke_reason, "code_replay");
  // A sequential replay after a successful exchange does the same.
  const replayed = await issueCode();
  const ok = await exchange(replayed.code, replayed.verifier);
  assert.equal(ok.response.status, 200);
  assert.equal((await exchange(replayed.code, replayed.verifier)).body.error, "invalid_grant");
  assert.equal((await rpc(f, "user", ok.body.access_token)).status, 401);
});

test("a refresh token is single-use: duplicates within seconds get the same pair, later replay revokes the family", async (t) => {
  const f = setup(t);
  const { client, tokens } = await connect(f);
  const refresh = (refreshToken, extra = {}, clientId = client.client_id) => token(f, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, ...extra });
  const tokenHash = async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex");
  const spentAgo = async (value, ms) => f.db.prepare("UPDATE mcp_oauth_tokens SET used_at = ? WHERE token_hash = ?").run(Date.now() - ms, await tokenHash(value));
  const refreshRows = () => f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_tokens WHERE kind = 'refresh'").get().n;

  // A malformed request keeps the refresh token usable.
  assert.equal((await refresh(tokens.refresh_token, { resource: `${BASE}/admin-mcp` })).body.error, "invalid_target");
  assert.equal((await refresh(tokens.refresh_token, { scope: "mcp:admin:write" })).body.error, "invalid_scope");
  assert.equal((await refresh(tokens.refresh_token, {}, "pdc_other")).body.error, "invalid_grant");
  assert.equal((await rpc(f, "user", tokens.access_token)).status, 200, "none of those cost the connection");

  const first = await refresh(tokens.refresh_token, { resource: `${BASE}/mcp` });
  assert.equal(first.response.status, 200);
  assert.notEqual(first.body.refresh_token, tokens.refresh_token);
  assert.ok(first.body.expires_in > 3590 && first.body.expires_in <= 3600);
  assert.equal((await rpc(f, "user", first.body.access_token)).status, 200);
  const rows = refreshRows();

  // Presenting the spent token again right away (a client's own concurrent
  // refresh, or a thief racing it) never creates another branch: it gets the
  // very same successor pair, and no token row is added.
  const again = await refresh(tokens.refresh_token);
  assert.equal(again.response.status, 200);
  assert.equal(again.body.refresh_token, first.body.refresh_token);
  assert.equal(again.body.access_token, first.body.access_token);
  assert.equal(refreshRows(), rows);
  // ... and only for the client it was issued to.
  assert.equal((await refresh(tokens.refresh_token, {}, "pdc_other")).body.error, "invalid_grant");

  // Truly concurrent redemption of one unspent token: exactly one rotation,
  // every request answered with its result.
  const race = await Promise.all([refresh(first.body.refresh_token), refresh(first.body.refresh_token), refresh(first.body.refresh_token)]);
  assert.deepEqual(race.map((r) => r.response.status), [200, 200, 200]);
  assert.equal(new Set(race.map((r) => r.body.refresh_token)).size, 1, "one successor, not one per request");
  assert.equal(new Set(race.map((r) => r.body.access_token)).size, 1);
  assert.equal(refreshRows(), rows + 1);
  const [{ body: current }] = race;
  assert.equal((await rpc(f, "user", current.access_token)).status, 200);
  assert.equal(f.db.prepare("SELECT revoked_at FROM mcp_oauth_grants").get().revoked_at, null);

  // The stored copy is sealed: the database alone does not reveal the pair.
  const stored = JSON.stringify(f.db.prepare("SELECT rotation_result FROM mcp_oauth_tokens").all());
  assert.ok(!stored.includes(current.refresh_token) && !stored.includes(current.access_token));

  // Presenting a spent token after the window is a replay: the whole grant is
  // revoked, every token issued under it included, by whoever presents it.
  await spentAgo(first.body.refresh_token, 11_000);
  const replay = await refresh(first.body.refresh_token, {}, "pdc_attacker");
  assert.equal(replay.body.error, "invalid_grant");
  assert.match(replay.body.error_description, /authorization again/);
  const grant = f.db.prepare("SELECT revoked_at, revoke_reason FROM mcp_oauth_grants").get();
  assert.equal(grant.revoke_reason, "refresh_replay");
  assert.equal((await rpc(f, "user", current.access_token)).status, 401);
  assert.equal((await refresh(current.refresh_token)).body.error, "invalid_grant");

  // An expired refresh token is refused without touching the grant.
  const other = await connect(f);
  f.db.prepare("UPDATE mcp_oauth_tokens SET expires_at = ? WHERE token_hash = ?").run(Date.now() - 1, await tokenHash(other.tokens.refresh_token));
  assert.equal((await token(f, { grant_type: "refresh_token", refresh_token: other.tokens.refresh_token, client_id: other.client.client_id })).body.error, "invalid_grant");
  assert.equal(f.db.prepare("SELECT revoked_at FROM mcp_oauth_grants WHERE client_id = ?").get(other.client.client_id).revoked_at, null);
});

test("dynamic registration has a deployment-wide budget on top of the per-IP one", async (t) => {
  const f = setup(t);
  const limited = new Set(["oauth:register:global"]);
  const original = f.env.RATE_LIMITER;
  f.env.RATE_LIMITER = { idFromName: (key) => key, get: (key) => ({ fetch: async () => Response.json({ allowed: !limited.has(key), retryAfter: 42 }) }) };
  const refused = await register(f);
  assert.equal(refused.response.status, 429);
  assert.equal(refused.response.headers.get("Retry-After"), "42");
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_clients").get().n, 0);
  f.env.RATE_LIMITER = { idFromName: (key) => key, get: () => ({ fetch: async () => { throw new Error("down"); } }) };
  assert.equal((await register(f)).response.status, 503, "fails closed when the limiter is unavailable");
  f.env.RATE_LIMITER = original;
  assert.equal((await register(f)).response.status, 201);
});

test("refresh and MCP calls follow the account's current status and role", async (t) => {
  const f = setup(t);
  const user = await connect(f, { userId: "alice" });
  const admin = await connect(f, { userId: "root", audience: "admin" });
  assert.equal((await rpc(f, "admin", admin.tokens.access_token)).status, 200);

  f.db.prepare("UPDATE users SET status = 'revoked' WHERE id = 'alice'").run();
  const revoked = await rpc(f, "user", user.tokens.access_token);
  assert.equal(revoked.status, 403, "account revocation applies before the access token expires");
  assert.equal((await token(f, { grant_type: "refresh_token", refresh_token: user.tokens.refresh_token, client_id: user.client.client_id })).body.error, "invalid_grant");

  f.db.prepare("UPDATE users SET role = 'user' WHERE id = 'root'").run();
  assert.equal((await rpc(f, "admin", admin.tokens.access_token)).status, 403, "a demoted admin loses Admin MCP at once");
  assert.equal((await token(f, { grant_type: "refresh_token", refresh_token: admin.tokens.refresh_token, client_id: admin.client.client_id })).body.error, "invalid_grant");
});

test("Admin MCP authorization is for active administrators only, and the audiences never cross", async (t) => {
  const f = setup(t);
  const { body: client } = await register(f);
  const { challenge } = await pkce();
  const alice = await session(f, "alice");
  const request = await startAuthorization(f, { clientId: client.client_id, audience: "admin", challenge });
  const view = await (await f.fetchWorker(`/api/oauth/requests/${request.requestId}`, { headers: { Cookie: `${alice}; ${request.binding}` } })).json();
  assert.equal(view.audience, "admin");
  assert.deepEqual(view.scopes, ["mcp:admin:read", "mcp:admin:write"]);
  assert.equal(view.eligible, false, "the consent screen offers a non-admin no approval");
  const approved = await consent(f, request, alice);
  assert.equal(new URL(approved.body.redirectTo).searchParams.get("error"), "access_denied");
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_grants").get().n, 0, "no administrative grant for a non-admin");

  const admin = await connect(f, { userId: "root", audience: "admin" });
  assert.match(admin.tokens.access_token, /^pd_oat_admin_/);
  const identity = await payload(await rpc(f, "admin", admin.tokens.access_token, "tools/call", { name: "admin_get_identity", arguments: {} }));
  assert.deepEqual(identity.result.structuredContent.data, { userId: "root", server: "admin" });
  const userOfAdmin = await connect(f, { userId: "root", audience: "user" });

  const before = f.queries.length;
  assert.equal((await rpc(f, "user", admin.tokens.access_token)).status, 401, "an Admin MCP token is not a User MCP credential");
  assert.equal((await rpc(f, "admin", userOfAdmin.tokens.access_token)).status, 401, "a User MCP token never authorizes Admin MCP");
  assert.equal(f.queries.length, before, "refused by namespace before any lookup");
  const forged = userOfAdmin.tokens.access_token.replace("_user_", "_admin_");
  assert.equal((await rpc(f, "admin", forged)).status, 401, "the stored grant audience decides, not the prefix");
});

test("scopes map to tools: a read-only grant lists no write tools and a write call gets 403 insufficient_scope", async (t) => {
  const f = setup(t);
  const { tokens } = await connect(f, { scope: "mcp:user:read" });
  assert.equal(tokens.scope, "mcp:user:read");
  const listed = (await payload(await rpc(f, "user", tokens.access_token))).result.tools;
  assert.ok(listed.length > 10);
  assert.ok(listed.every((tool) => tool.annotations.readOnlyHint === true), "only read-only tools are listed");
  assert.ok(listed.some((tool) => tool.name === "user_get_identity"));

  const write = await rpc(f, "user", tokens.access_token, "tools/call", { name: "user_create_knowledge_point_tag", arguments: { name: "x" } });
  assert.equal(write.status, 403);
  const challenge = write.headers.get("WWW-Authenticate");
  assert.match(challenge, /error="insufficient_scope"/);
  assert.match(challenge, /scope="mcp:user:read mcp:user:write"/);
  assert.match(challenge, /resource_metadata="/);
  assert.equal((await write.json()).error.code, "insufficient_scope");
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM knowledge_point_tags").get().n, 0, "nothing was written");

  const point = f.metrics.at(-1);
  assert.deepEqual([point.blobs[6], point.blobs[7], point.blobs[12]], ["insufficient_scope", "success", "oauth"], "metrics name the exact refusal and credential type");

  const read = await payload(await rpc(f, "user", tokens.access_token, "tools/call", { name: "user_list_exams", arguments: {} }));
  assert.equal(read.result.structuredContent.ok, true);

  const full = await connect(f, { scope: "mcp:user:write" });
  const allTools = (await payload(await rpc(f, "user", full.tokens.access_token))).result.tools;
  assert.ok(allTools.some((tool) => tool.annotations.readOnlyHint === false), "write includes read and write tools");
  assert.ok(allTools.some((tool) => tool.name === "user_get_identity"));
});

test("PATs keep working beside OAuth, and both credential types share one account quota", async (t) => {
  const f = setup(t);
  const pat = await issueMcpCredential(f.env.DB, { userId: "alice", audience: "user", name: "cli" });
  const { tokens } = await connect(f);
  f.limits.length = 0;
  assert.equal((await rpc(f, "user", pat.token)).status, 200);
  assert.equal((await rpc(f, "user", tokens.access_token)).status, 200);
  const accountKeys = f.limits.filter((key) => key.startsWith("mcp:"));
  assert.deepEqual(accountKeys, ["mcp:user:user:alice", "mcp:user:user:alice"]);
  // A PAT row is untouched by OAuth activity.
  const row = f.db.prepare("SELECT name, revoked_at FROM mcp_credentials WHERE id = ?").get(pat.id);
  assert.deepEqual({ ...row }, { name: "cli", revoked_at: null });
});

test("browser sessions, Google tokens and query parameters cannot authenticate MCP", async (t) => {
  const f = setup(t);
  const alice = await session(f, "alice");
  const before = f.queries.length;
  assert.equal((await rpc(f, "user", null, "tools/list", undefined, { Cookie: alice })).status, 401);
  for (const bearer of ["ya29.a0AfH6SMBgoogleaccesstoken", "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJnb29nbGUifQ.c2ln", "pd_oat_user_short"]) {
    const response = await rpc(f, "user", bearer);
    assert.equal(response.status, 401, bearer);
  }
  assert.equal(f.queries.length, before, "none of them reached a credential lookup");
  const { tokens } = await connect(f);
  const query = await f.fetchWorker(`/mcp?access_token=${tokens.access_token}`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(query.status, 400, "a URL with a query string is refused before authentication, as for PATs");
});

test("users list and revoke their own connected applications, separately from PATs", async (t) => {
  const f = setup(t);
  const { tokens, client } = await connect(f);
  const alice = await session(f, "alice");
  const list = await (await f.fetchWorker("/api/mcp-connections", { headers: { Cookie: alice } })).json();
  assert.equal(list.enabled, true);
  assert.equal(list.grants.length, 1);
  const [grant] = list.grants;
  assert.equal(grant.clientName, "Test Client");
  assert.equal(grant.clientId, client.client_id);
  assert.equal(grant.audience, "user");
  assert.deepEqual(grant.scopes, ["mcp:user:read", "mcp:user:write"]);
  assert.equal(grant.status, "active");
  assert.ok(!JSON.stringify(list).includes(tokens.access_token) && !JSON.stringify(list).includes(tokens.refresh_token));
  assert.deepEqual((await (await f.fetchWorker("/api/mcp-tokens", { headers: { Cookie: alice } })).json()).credentials, [], "not a PAT");

  const bob = await session(f, "bob");
  assert.equal((await f.fetchWorker(`/api/mcp-connections/${grant.id}/revoke`, { method: "POST", headers: { Cookie: bob, "Content-Type": "application/json" } })).status, 404);
  assert.equal((await f.fetchWorker(`/api/admin/mcp-connections`, { headers: { Cookie: alice } })).status, 403);
  assert.equal((await rpc(f, "user", tokens.access_token)).status, 200);

  const revoke = await f.fetchWorker(`/api/mcp-connections/${grant.id}/revoke`, { method: "POST", headers: { Cookie: alice, "Content-Type": "application/json" } });
  assert.equal(revoke.status, 200);
  assert.equal((await rpc(f, "user", tokens.access_token)).status, 401, "revocation ends access tokens at once");
  assert.equal((await token(f, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id })).body.error, "invalid_grant");
  assert.deepEqual((await (await f.fetchWorker("/api/mcp-connections", { headers: { Cookie: alice } })).json()).grants, []);
});

test("signing out of the browser leaves OAuth grants and PATs working", async (t) => {
  const f = setup(t);
  const { tokens } = await connect(f);
  const pat = await issueMcpCredential(f.env.DB, { userId: "alice", audience: "user", name: "cli" });
  const out = await f.fetchWorker("/api/auth/logout", { method: "POST", headers: { Cookie: await session(f, "alice") } });
  assert.equal(out.status, 200);
  assert.equal((await rpc(f, "user", tokens.access_token)).status, 200);
  assert.equal((await rpc(f, "user", pat.token)).status, 200);
});

test("RFC 7009 revocation by the client disconnects the grant; a foreign client cannot", async (t) => {
  const f = setup(t);
  const { tokens, client } = await connect(f);
  const revoke = (form) => f.fetchWorker("/api/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  assert.equal((await revoke({ token: tokens.refresh_token, client_id: "pdc_other" })).status, 200);
  assert.equal((await rpc(f, "user", tokens.access_token)).status, 200, "a foreign client's revocation is ignored");
  assert.equal((await revoke({ token: tokens.refresh_token, client_id: client.client_id })).status, 200);
  assert.equal((await rpc(f, "user", tokens.access_token)).status, 401);
  assert.equal(f.db.prepare("SELECT revoke_reason FROM mcp_oauth_grants").get().revoke_reason, "client");
});

test("Admin MCP mutations through OAuth are audited against the grant", async (t) => {
  const f = setup(t);
  const { tokens } = await connect(f, { userId: "root", audience: "admin" });
  const created = await payload(await rpc(f, "admin", tokens.access_token, "tools/call", { name: "admin_create_tag", arguments: { name: "oauth-tag" } }));
  assert.equal(created.result.structuredContent.ok, true, JSON.stringify(created));
  const audit = f.db.prepare("SELECT credential_id, oauth_grant_id, admin_user_id, tool FROM admin_mcp_audit_log").get();
  const grant = f.db.prepare("SELECT id FROM mcp_oauth_grants").get();
  assert.deepEqual({ ...audit }, { credential_id: null, oauth_grant_id: grant.id, admin_user_id: "root", tool: "admin_create_tag" });
  const view = f.db.prepare("SELECT credential_id, oauth_grant_id FROM content_mutation_audit WHERE entry_point = 'admin_mcp'").get();
  assert.equal(view.oauth_grant_id, grant.id);

  const pat = await issueMcpCredential(f.env.DB, { userId: "root", audience: "admin", name: "cli" });
  await payload(await rpc(f, "admin", pat.token, "tools/call", { name: "admin_create_tag", arguments: { name: "pat-tag" } }));
  const patAudit = f.db.prepare("SELECT credential_id, oauth_grant_id FROM admin_mcp_audit_log WHERE credential_id IS NOT NULL").get();
  assert.deepEqual({ ...patAudit }, { credential_id: pat.id, oauth_grant_id: null });
});

test("no OAuth secret is written to logs", async (t) => {
  const f = setup(t);
  const lines = [];
  const original = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  for (const level of Object.keys(original)) console[level] = (...args) => lines.push(JSON.stringify(args));
  t.after(() => Object.assign(console, original));
  const { tokens, code, verifier } = await connect(f);
  await token(f, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: "pdc_other" });
  await rpc(f, "user", `pd_oat_user_${"f".repeat(64)}`);
  const logged = lines.join("\n");
  for (const secret of [tokens.access_token, tokens.refresh_token, code, verifier]) assert.ok(!logged.includes(secret));
});

test("the daily prune drops expired tokens, codes and requests but keeps grants", async (t) => {
  const f = setup(t);
  await connect(f);
  const { body: unused } = await register(f);
  const later = Date.now() + 31 * 24 * 60 * 60 * 1000;
  const { deleted } = await runMcpOAuthPrune(f.env, () => later);
  assert.ok(deleted > 0);
  for (const table of ["mcp_oauth_tokens", "mcp_oauth_codes", "mcp_oauth_requests"]) {
    assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_grants").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_clients WHERE id = ?").get(unused.client_id).n, 0, "an unused registration goes");
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_clients").get().n, 1, "a client with a grant stays");
});

test("the daily prune clears sealed rotation results once their window has passed", async (t) => {
  const f = setup(t);
  const { client, tokens } = await connect(f);
  await token(f, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
  const sealed = () => f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_tokens WHERE rotation_result IS NOT NULL").get().n;
  assert.equal(sealed(), 1);
  await runMcpOAuthPrune(f.env, () => Date.now() + 2 * 60 * 1000);
  assert.equal(sealed(), 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM mcp_oauth_tokens").get().n, 4, "unexpired tokens stay");
});
