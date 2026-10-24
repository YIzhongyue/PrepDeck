import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { importTs } from "../../../tests/support/bundle.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { openDatabase } from "../../../tests/support/migrations.mjs";
import { createKv } from "../../../tests/support/kv.mjs";

const { buildSessionCookie, clearSessionCookie, readSessionCookie, issueSessionToken, buildOAuthStateCookie, clearOAuthStateCookie, readOAuthStateCookie, requireAccessUser } = await importTs([
  new URL("../src/lib/session.ts", import.meta.url), new URL("../src/lib/google-oauth.ts", import.meta.url), new URL("../src/middleware/access.ts", import.meta.url),
]);
const signingEnv = { SESSION_SECRET: "synthetic-cookie-test-secret" };
const pair = value => value.split(";", 1)[0];

test("HTTPS cookies and clearing cookies satisfy the __Host prefix contract", async () => {
  for (const [cookie, name] of [
    [buildSessionCookie("synthetic-token", true), "__Host-pd_session"],
    [clearSessionCookie(true), "__Host-pd_session"],
    [await buildOAuthStateCookie(signingEnv, "state", "verifier", true, null, "nonce"), "__Host-pd_oauth"],
    [clearOAuthStateCookie(true), "__Host-pd_oauth"],
  ]) {
    assert.ok(cookie.startsWith(name + "="));
    assert.match(cookie, /; Path=\/(?:;|$)/);
    assert.match(cookie, /; Secure(?:;|$)/);
    assert.match(cookie, /; HttpOnly(?:;|$)/);
    assert.match(cookie, /; SameSite=Lax(?:;|$)/);
    assert.doesNotMatch(cookie, /; Domain=/i);
  }
});

test("secure session lookup ignores legacy cookies and rejects ambiguous duplicate secure names", () => {
  const secure = pair(buildSessionCookie("secure-token", true));
  const legacy = pair(buildSessionCookie("legacy-token", false));
  assert.equal(readSessionCookie(legacy), null);
  assert.equal(readSessionCookie(legacy + "; " + secure), "secure-token");
  assert.equal(readSessionCookie(secure + "; " + legacy), "secure-token");
  assert.equal(readSessionCookie(secure + "; " + secure), null);
  assert.equal(readSessionCookie("__Host-pd_session=%; " + legacy), null);
  assert.equal(readSessionCookie(legacy, false), "legacy-token");
  assert.equal(readSessionCookie(secure, false), null);
});

test("signed OAuth state cannot fall back to legacy names or select duplicate secure names", async () => {
  const secure = pair(await buildOAuthStateCookie(signingEnv, "secure-state", "verifier", true, null, "nonce"));
  const legacy = pair(await buildOAuthStateCookie(signingEnv, "legacy-state", "verifier", false, null, "nonce"));
  assert.equal(await readOAuthStateCookie(signingEnv, legacy), null);
  assert.equal((await readOAuthStateCookie(signingEnv, legacy + "; " + secure)).state, "secure-state");
  assert.equal((await readOAuthStateCookie(signingEnv, secure + "; " + legacy)).state, "secure-state");
  assert.equal(await readOAuthStateCookie(signingEnv, secure + "; " + secure), null);
  assert.equal(await readOAuthStateCookie(signingEnv, "__Host-pd_oauth=invalid; " + legacy), null);
  assert.equal((await readOAuthStateCookie(signingEnv, legacy, false)).state, "legacy-state");
  assert.equal(await readOAuthStateCookie(signingEnv, secure, false), null);
});

test("legacy session names work only on explicit development HTTP, not HTTPS or production HTTP", async t => {
  const db = openDatabase(t);
  db.exec("INSERT INTO users(id,email,role,status,created_at) VALUES ('user','user@example.test','user','active','now')");
  const env = { ...signingEnv, DB: createD1(db), KV: createKv(), AUTH_MODE: "cookie", ENVIRONMENT: "development" };
  const token = await issueSessionToken(env, "user");
  const app = new Hono(); app.use("*", requireAccessUser); app.get("/", c => c.json({ user: c.get("user").id }));
  const request = (url, secure) => app.request(url, { headers: { Cookie: pair(buildSessionCookie(token, secure)) } }, env);
  assert.equal((await request("http://localhost/", false)).status, 200);
  assert.equal((await request("https://app.example.test/", false)).status, 401);
  assert.equal((await request("https://app.example.test/", true)).status, 200);
  env.ENVIRONMENT = "production";
  assert.equal((await request("http://localhost/", false)).status, 401);
  env.ENVIRONMENT = undefined;
  assert.equal((await request("http://localhost/", false)).status, 401);
});
