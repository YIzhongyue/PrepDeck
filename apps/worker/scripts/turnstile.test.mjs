// Issue #82: Cloudflare Turnstile human verification on Google sign-in and MCP
// token issuance. Siteverify is replaced by a local stub; no request leaves
// the process. Every test also checks that neither the secret nor a token
// reaches the logs.
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
const [{ verifyTurnstileToken }, { authRouter }, { createMcpTokensRouter }] = await Promise.all([
  bundle("../src/lib/turnstile.ts"), bundle("../src/routes/auth.ts"), bundle("../src/routes/mcpTokens.ts"),
]);

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SECRET = "0x4AAAAAAA-synthetic-secret-for-tests";
const TOKEN = "synthetic.turnstile.token.value";
const ENABLED = { ENVIRONMENT: "production", APP_BASE_URL: "https://prepdeck.test", TURNSTILE_SITE_KEY: "0x4AAAAAAA-site-key", TURNSTILE_SECRET_KEY: SECRET };

// Replaces fetch with a Siteverify stub answering `reply` (an object, a
// Response, or a function of the parsed form), and captures console output.
function stub(t, reply = { success: true, action: "sign_in", hostname: "prepdeck.test" }) {
  const calls = [];
  const logs = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), SITEVERIFY, "only Siteverify is called");
    const form = new URLSearchParams(String(init.body));
    calls.push(Object.fromEntries(form));
    const value = typeof reply === "function" ? await reply(form) : reply;
    return value instanceof Response ? value : Response.json(value);
  };
  const originals = {};
  for (const level of ["log", "info", "warn", "error"]) {
    originals[level] = console[level];
    console[level] = (...args) => logs.push(JSON.stringify(args));
  }
  t.after(() => {
    globalThis.fetch = originalFetch;
    Object.assign(console, originals);
    const text = logs.join("\n");
    assert.ok(!text.includes(SECRET), "the secret is never logged");
    assert.ok(!text.includes(TOKEN), "a token is never logged");
  });
  return { calls, logs };
}

test("a token Siteverify accepts for this action and hostname passes, with the secret and client address sent server-side", async t => {
  const { calls } = stub(t);
  assert.deepEqual(await verifyTurnstileToken(ENABLED, TOKEN, "sign_in", "203.0.113.7"), { ok: true });
  assert.deepEqual(calls, [{ secret: SECRET, response: TOKEN, remoteip: "203.0.113.7" }]);
});

test("missing, empty or oversized tokens are refused without calling Siteverify", async t => {
  const { calls } = stub(t);
  for (const token of [undefined, null, "", 42, "x".repeat(2049)]) {
    assert.deepEqual(await verifyTurnstileToken(ENABLED, token, "sign_in", null), { ok: false, reason: "missing" });
  }
  assert.equal(calls.length, 0);
});

test("a token solved for another action or on another hostname is refused", async t => {
  stub(t, { success: true, action: "mcp_token", hostname: "prepdeck.test" });
  assert.deepEqual(await verifyTurnstileToken(ENABLED, TOKEN, "sign_in", null), { ok: false, reason: "rejected" });
  assert.deepEqual(await verifyTurnstileToken(ENABLED, TOKEN, "mcp_token", null), { ok: true });
  assert.deepEqual(await verifyTurnstileToken({ ...ENABLED, APP_BASE_URL: "https://other.test" }, TOKEN, "mcp_token", null), { ok: false, reason: "rejected" });
});

test("TURNSTILE_HOSTNAMES replaces APP_BASE_URL's hostname as the accepted list", async t => {
  stub(t, { success: true, action: "sign_in", hostname: "Preview.PrepDeck.test" });
  const env = { ...ENABLED, TURNSTILE_HOSTNAMES: " prepdeck.test , preview.prepdeck.test " };
  assert.deepEqual(await verifyTurnstileToken(env, TOKEN, "sign_in", null), { ok: true });
  assert.deepEqual(await verifyTurnstileToken(ENABLED, TOKEN, "sign_in", null), { ok: false, reason: "rejected" });
});

test("a refused, spent or expired token is rejected", async t => {
  stub(t, { success: false, "error-codes": ["timeout-or-duplicate"] });
  assert.deepEqual(await verifyTurnstileToken(ENABLED, TOKEN, "sign_in", null), { ok: false, reason: "rejected" });
});

test("fails closed as misconfigured without a secret or with one Siteverify rejects", async t => {
  const { calls } = stub(t, { success: false, "error-codes": ["invalid-input-secret"] });
  assert.deepEqual(await verifyTurnstileToken({ ...ENABLED, TURNSTILE_SECRET_KEY: " " }, TOKEN, "sign_in", null), { ok: false, reason: "misconfigured" });
  assert.equal(calls.length, 0, "no secret, no Siteverify call");
  assert.deepEqual(await verifyTurnstileToken(ENABLED, TOKEN, "sign_in", null), { ok: false, reason: "misconfigured" });
});

test("fails closed as unavailable when Siteverify cannot answer", async t => {
  let reply = { success: false, "error-codes": ["internal-error"] };
  stub(t, () => reply);
  assert.deepEqual(await verifyTurnstileToken(ENABLED, TOKEN, "sign_in", null), { ok: false, reason: "unavailable" });
  reply = new Response("upstream down", { status: 502 });
  assert.deepEqual(await verifyTurnstileToken(ENABLED, TOKEN, "sign_in", null), { ok: false, reason: "unavailable" });
  reply = new Response("not json", { status: 200 });
  assert.deepEqual(await verifyTurnstileToken(ENABLED, TOKEN, "sign_in", null), { ok: false, reason: "unavailable" });
  globalThis.fetch = async () => { throw new TypeError("network down"); };
  assert.deepEqual(await verifyTurnstileToken(ENABLED, TOKEN, "sign_in", null), { ok: false, reason: "unavailable" });
});

test("Cloudflare's test keys are accepted in development only", async t => {
  // What Siteverify really answers for a test secret: example.com, no action.
  stub(t, { success: true, "error-codes": [], hostname: "example.com", metadata: { result_with_testing_key: true } });
  assert.deepEqual(await verifyTurnstileToken({ ...ENABLED, ENVIRONMENT: "development" }, TOKEN, "sign_in", null), { ok: true });
  assert.deepEqual(await verifyTurnstileToken(ENABLED, TOKEN, "sign_in", null), { ok: false, reason: "misconfigured" });
});

// --- Google sign-in -------------------------------------------------------

const AUTH_ENV = { AUTH_MODE: "cookie", GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret", SESSION_SECRET: "synthetic-test-session-key" };
const startForm = fields => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
const startsGoogle = response => response.headers.get("Location")?.startsWith("https://accounts.google.com/") && /pd_oauth=/.test(response.headers.get("Set-Cookie") ?? "");

test("the login screen learns the site key, and nothing when Turnstile is off", async () => {
  const off = await authRouter.request("https://prepdeck.test/turnstile", {}, AUTH_ENV);
  assert.deepEqual(await off.json(), { siteKey: null });
  const on = await authRouter.request("https://prepdeck.test/turnstile", {}, { ...AUTH_ENV, ...ENABLED });
  assert.deepEqual(await on.json(), { siteKey: ENABLED.TURNSTILE_SITE_KEY });
  assert.equal(on.headers.get("Cache-Control"), "no-store");
});

test("without Turnstile, sign-in starts from the form POST as it did from GET", async t => {
  const { calls } = stub(t);
  const response = await authRouter.request("https://prepdeck.test/google/start", startForm({ returnTo: "/settings" }), AUTH_ENV);
  assert.equal(response.status, 303);
  assert.ok(startsGoogle(response));
  const payload = response.headers.get("Set-Cookie").split(";")[0].slice("pd_oauth=".length).split(".")[0];
  assert.equal(JSON.parse(Buffer.from(payload, "base64url").toString()).returnTo, "/settings");
  assert.equal((await authRouter.request("https://prepdeck.test/google/start", {}, AUTH_ENV)).status, 302);
  assert.equal(calls.length, 0);
});

test("with Turnstile, a verified token starts sign-in and Siteverify sees the sign-in action", async t => {
  const { calls } = stub(t);
  const response = await authRouter.request("https://prepdeck.test/google/start",
    { ...startForm({ returnTo: "/learning/exam?exam=sg", "cf-turnstile-response": TOKEN }), headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "198.51.100.4" } },
    { ...AUTH_ENV, ...ENABLED });
  assert.equal(response.status, 303);
  assert.ok(startsGoogle(response));
  assert.deepEqual(calls, [{ secret: SECRET, response: TOKEN, remoteip: "198.51.100.4" }]);
});

test("with Turnstile, a missing or refused token returns to the page with ?auth=verification and no OAuth state", async t => {
  stub(t, { success: false, "error-codes": ["invalid-input-response"] });
  const env = { ...AUTH_ENV, ...ENABLED };
  for (const fields of [{ returnTo: "/learning/exam?exam=sg" }, { returnTo: "/learning/exam?exam=sg", "cf-turnstile-response": TOKEN }]) {
    const response = await authRouter.request("https://prepdeck.test/google/start", startForm(fields), env);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("Location"), "/learning/exam?exam=sg&auth=verification");
    assert.equal(response.headers.get("Set-Cookie"), null, "no OAuth state, so the callback cannot complete");
  }
  const foreign = await authRouter.request("https://prepdeck.test/google/start", startForm({ returnTo: "//evil.example/" }), env);
  assert.equal(foreign.headers.get("Location"), "/?auth=verification");
});

test("a refused sign-in says whether to verify again, try later or contact an admin", async t => {
  let reply;
  stub(t, () => reply);
  const env = { ...AUTH_ENV, ...ENABLED };
  const start = async () => (await authRouter.request("https://prepdeck.test/google/start", startForm({ returnTo: "/settings", "cf-turnstile-response": TOKEN }), env)).headers.get("Location");
  reply = { success: false, "error-codes": ["timeout-or-duplicate"] };
  assert.equal(await start(), "/settings?auth=verification");
  reply = new Response("down", { status: 503 });
  assert.equal(await start(), "/settings?auth=verification-unavailable");
  reply = { success: false, "error-codes": ["invalid-input-secret"] };
  assert.equal(await start(), "/settings?auth=verification-misconfigured");
});

// The review of the first version: the OAuth state cookie was unsigned JSON,
// so a client could skip /google/start, and with it Turnstile, by writing a
// matching cookie and calling the callback directly.
test("the callback refuses OAuth state /google/start did not issue: forged, tampered or expired", async t => {
  const env = { ...AUTH_ENV, ...ENABLED };
  const requests = [];
  const originalFetch = globalThis.fetch;
  const realNow = Date.now;
  t.after(() => { globalThis.fetch = originalFetch; Date.now = realNow; });
  globalThis.fetch = async url => {
    requests.push(String(url));
    if (String(url) === SITEVERIFY) return Response.json({ success: true, action: "sign_in", hostname: "prepdeck.test" });
    return Response.json({ error: "invalid_grant" }, { status: 400 });
  };
  const callback = cookie => authRouter.request("https://prepdeck.test/google/callback?code=c&state=s", { headers: { Cookie: cookie } }, env);
  const refused = async (cookie, label) => {
    const before = requests.length;
    const response = await callback(cookie);
    assert.equal(response.headers.get("Location"), "/?auth=error", label);
    assert.doesNotMatch(response.headers.get("Set-Cookie") ?? "", /pd_session=/, label);
    assert.equal(requests.length, before, `${label}: no Google token exchange, no Siteverify`);
  };

  await refused(`pd_oauth=${encodeURIComponent(JSON.stringify({ state: "s", codeVerifier: "v" }))}`, "the first version's unsigned cookie");

  // A genuine cookie, issued after a verified token, for comparison.
  const start = await authRouter.request("https://prepdeck.test/google/start", startForm({ "cf-turnstile-response": TOKEN }), env);
  const issued = start.headers.get("Set-Cookie").split(";")[0];
  const state = new URL(start.headers.get("Location")).searchParams.get("state");
  const [payload, signature] = issued.slice("pd_oauth=".length).split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.state, state);

  const forgedPayload = Buffer.from(JSON.stringify({ ...claims, state: "s" })).toString("base64url");
  await refused(`pd_oauth=${forgedPayload}.${signature}`, "a payload changed under the old signature");
  await refused(`pd_oauth=${payload}.${"A".repeat(43)}`, "a made-up signature");
  await refused(`pd_oauth=${payload}`, "no signature");

  const genuine = await authRouter.request(`https://prepdeck.test/google/callback?code=c&state=${state}`, { headers: { Cookie: issued } }, env);
  assert.equal(genuine.headers.get("Location"), "/?auth=error", "Google refuses the made-up code");
  assert.ok(requests.at(-1).startsWith("https://oauth2.googleapis.com/token"), "a genuine cookie does reach the token exchange");

  Date.now = () => realNow() + 11 * 60 * 1000;
  const before = requests.length;
  const expired = await authRouter.request(`https://prepdeck.test/google/callback?code=c&state=${state}`, { headers: { Cookie: issued } }, env);
  assert.equal(expired.headers.get("Location"), "/?auth=error");
  assert.equal(requests.length, before, "an expired cookie never reaches the token exchange");
});

test("with Turnstile, a GET cannot start sign-in: it goes back to the page, where the login screen asks for the check", async t => {
  const { calls } = stub(t);
  const response = await authRouter.request("https://prepdeck.test/google/start?returnTo=%2Fsettings", {}, { ...AUTH_ENV, ...ENABLED });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/settings");
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(calls.length, 0);
});

test("an oversized sign-in form is refused before it is parsed", async t => {
  const { calls } = stub(t);
  const response = await authRouter.request("https://prepdeck.test/google/start", startForm({ returnTo: "/", filler: "x".repeat(9000) }), { ...AUTH_ENV, ...ENABLED });
  assert.equal(response.status, 413);
  assert.equal(calls.length, 0);
});

// --- MCP token issuance -----------------------------------------------------

function mcpApp(env) {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, dir), "utf8"));
  db.prepare("INSERT INTO users(id, email, role, status, created_at) VALUES ('alice', 'alice@test', 'admin', 'active', '2026-09-09')").run();
  const DB = { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }; } };
  } };
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: "alice", role: "admin" }); await next(); });
  app.route("/mcp-tokens", createMcpTokensRouter("user"));
  app.route("/admin/mcp-tokens", createMcpTokensRouter("admin"));
  const request = async (path, { token, body } = {}) => {
    const response = await app.request(`https://prepdeck.test${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "X-Turnstile-Token": token } : {}) },
      body: JSON.stringify(body ?? {}),
    }, { DB, ...env });
    return { status: response.status, body: await response.json() };
  };
  const active = () => db.prepare("SELECT COUNT(*) AS n FROM mcp_credentials WHERE revoked_at IS NULL").get().n;
  return { request, active };
}

test("without Turnstile, MCP tokens are issued as before", async t => {
  const { calls } = stub(t);
  const { request } = mcpApp({});
  assert.equal((await request("/mcp-tokens", { body: { name: "cli" } })).status, 201);
  assert.equal(calls.length, 0);
});

test("with Turnstile, creating or rotating a User or Admin MCP token needs a verified token", async t => {
  const { calls } = stub(t, { success: true, action: "mcp_token", hostname: "prepdeck.test" });
  const { request, active } = mcpApp(ENABLED);
  for (const base of ["/mcp-tokens", "/admin/mcp-tokens"]) {
    const refused = await request(base, { body: { name: "cli" } });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, "human_verification_failed");
    assert.equal(active(), base === "/mcp-tokens" ? 0 : 1, "nothing is issued without verification");

    const created = await request(base, { token: TOKEN, body: { name: "cli" } });
    assert.equal(created.status, 201);
    const id = created.body.credential.id;

    const rotateRefused = await request(`${base}/${id}/rotate`);
    assert.equal(rotateRefused.status, 403);
    const rotated = await request(`${base}/${id}/rotate`, { token: TOKEN });
    assert.equal(rotated.status, 201);
  }
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.secret === SECRET && call.response === TOKEN));
});

test("with Turnstile, a token for the sign-in action cannot issue an MCP token, and an outage refuses with 503", async t => {
  let reply = { success: true, action: "sign_in", hostname: "prepdeck.test" };
  stub(t, () => reply);
  const { request, active } = mcpApp(ENABLED);
  assert.equal((await request("/mcp-tokens", { token: TOKEN, body: { name: "cli" } })).status, 403);
  reply = new Response("down", { status: 503 });
  const outage = await request("/mcp-tokens", { token: TOKEN, body: { name: "cli" } });
  assert.equal(outage.status, 503);
  assert.equal(outage.body.code, "human_verification_failed");
  assert.match(outage.body.error, /Try again in a few minutes/);
  reply = { success: false, "error-codes": ["invalid-input-secret"] };
  const misconfigured = await request("/mcp-tokens", { token: TOKEN, body: { name: "cli" } });
  assert.equal(misconfigured.status, 503);
  assert.match(misconfigured.body.error, /Contact your admin/);
  assert.equal(active(), 0);
});
