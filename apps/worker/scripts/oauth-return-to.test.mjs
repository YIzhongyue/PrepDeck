// Issues #41 and #52: after Google sign-in the learner used to land on "/"
// whatever they had opened, so a daily review email link, or the page a
// session expired on, was lost across the round trip. The OAuth start now takes
// a same-origin `returnTo`, carries it in the state cookie, and the callback
// lands there. It must never become an open redirect.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function bundle(path) {
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"] });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const [{ authRouter }, { safeReturnTo }] = await Promise.all([bundle("../src/routes/auth.ts"), bundle("../src/lib/returnTo.ts")]);

test("returnTo accepts same-origin paths only", () => {
  for (const [input, expected] of [
    ["/learning/exam?exam=sg&question_id=q1", "/learning/exam?exam=sg&question_id=q1"],
    ["/?screen=mock", "/?screen=mock"],
    ["/?screen=mock&auth=error", "/?screen=mock"],
    ["/settings#frag", "/settings"],
  ]) assert.equal(safeReturnTo(input), expected, input);
  for (const input of ["//evil.example/x", "/\\evil.example", "https://evil.example/", "javascript:alert(1)", "evil", "", "/api/auth/me",
    "/mcp", "/admin-mcp/x", "/cdn-cgi/x", "/a\nb", `/${"x".repeat(2100)}`, 42, null]) {
    assert.equal(safeReturnTo(input), null, JSON.stringify(input));
  }
});

async function signingKey() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const sign = async claims => {
    const part = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${part({ alg: "RS256", kid: "test-key", typ: "JWT" })}.${part(claims)}`;
    const signature = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(input))).toString("base64url");
    return `${input}.${signature}`;
  };
  return { jwk, sign };
}

function environment(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  db.exec("INSERT INTO users (id,email,role,status,created_at) VALUES ('alice','alice@example.test','user','invited','2026-09-09')");
  const kv = new Map();
  const DB = { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { const r = db.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; } };
  }, async batch(statements) { const out = []; for (const s of statements) out.push(await s.run()); return out; } };
  const KV = {
    async get(key, type) { const v = kv.get(key); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(key, value) { kv.set(key, value); },
    async delete(key) { kv.delete(key); },
  };
  return { AUTH_MODE: "cookie", DB, KV, SESSION_SECRET: "synthetic-test-session-key", GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret" };
}

async function signInThroughGoogle(t, returnTo) {
  const env = environment(t);
  const { jwk, sign } = await signingKey();
  const idToken = await sign({ iss: "https://accounts.google.com", aud: "client-id", sub: "google-alice", email: "alice@example.test", email_verified: true, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000) });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async url => String(url).includes("token") ? Response.json({ id_token: idToken }) : Response.json({ keys: [jwk] });

  const start = await authRouter.request(`https://prepdeck.test/google/start${returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`}`, {}, env);
  assert.equal(start.status, 302);
  const oauthCookie = start.headers.get("Set-Cookie").split(";")[0];
  const state = new URL(start.headers.get("Location")).searchParams.get("state");
  const callback = await authRouter.request(`https://prepdeck.test/google/callback?code=c&state=${state}`, { headers: { Cookie: oauthCookie } }, env);
  return { callback, oauthCookie };
}

test("signing in lands on the page that asked for it", async t => {
  const { callback } = await signInThroughGoogle(t, "/learning/exam?exam=sg&question_id=q1");
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("Location"), "/learning/exam?exam=sg&question_id=q1");
  assert.match(callback.headers.get("Set-Cookie"), /pd_session=/, "and is signed in");
});

test("without returnTo, or with a foreign one, signing in lands on /", async t => {
  assert.equal((await signInThroughGoogle(t)).callback.headers.get("Location"), "/");
  const foreign = await signInThroughGoogle(t, "//evil.example/steal");
  assert.equal(foreign.callback.headers.get("Location"), "/");
  assert.doesNotMatch(decodeURIComponent(foreign.oauthCookie), /evil/, "a refused returnTo is not even stored");
});

test("a returnTo planted in the unsigned state cookie is validated again", async t => {
  const env = environment(t);
  const { jwk, sign } = await signingKey();
  const idToken = await sign({ iss: "https://accounts.google.com", aud: "client-id", sub: "google-alice", email: "alice@example.test", email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async url => String(url).includes("token") ? Response.json({ id_token: idToken }) : Response.json({ keys: [jwk] });
  const start = await authRouter.request("https://prepdeck.test/google/start", {}, env);
  const state = new URL(start.headers.get("Location")).searchParams.get("state");
  const planted = `pd_oauth=${encodeURIComponent(JSON.stringify({ state, codeVerifier: "v", returnTo: "https://evil.example/" }))}`;
  const callback = await authRouter.request(`https://prepdeck.test/google/callback?code=c&state=${state}`, { headers: { Cookie: planted } }, env);
  assert.match(callback.headers.get("Set-Cookie"), /pd_session=/, "the sign-in itself succeeds");
  assert.equal(callback.headers.get("Location"), "/");
});
