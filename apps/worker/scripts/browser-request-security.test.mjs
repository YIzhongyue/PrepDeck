import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { openDatabase } from "../../../tests/support/migrations.mjs";
import { createBindings } from "../../../tests/support/bindings.mjs";

const { worker, issueSessionToken, buildSessionCookie } = await importTs({
  contents: `export { default as worker } from './src/index.ts';
    export { issueSessionToken, buildSessionCookie } from './src/lib/session.ts';`,
  resolveDir: new URL("..", import.meta.url),
}, { platform: "workerd" });
const BASE = "https://app.example.test";
function fixture(t) {
  const db = openDatabase(t);
  db.exec("INSERT INTO users(id,email,role,status,created_at) VALUES ('admin','admin@example.test','admin','active','now')");
  const env = { ...createBindings(), DB: createD1(db), AUTH_MODE: "cookie", ENVIRONMENT: "production", APP_BASE_URL: BASE, SESSION_SECRET: "synthetic-session-key", GOOGLE_CLIENT_ID: "synthetic-client", MCP_OAUTH_ENABLED: "true" };
  const call = async (path, { method = "POST", body, headers = {}, origin = BASE, cookie = true } = {}) => {
    const session = cookie ? buildSessionCookie(await issueSessionToken(env, "admin"), true).split(";", 1)[0] : undefined;
    return worker.fetch(new Request(BASE + path, { method, headers: {
      "CF-Connecting-IP": "192.0.2.1", ...(session ? { Cookie: session } : {}),
      ...(origin === undefined || origin === null ? {} : { Origin: origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers,
    }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  };
  return { db, env, call };
}
const invitation = { email: "new@example.test", role: "admin" };

test("same-site sibling cannot create an admin invitation, including a simple text/plain request", async t => {
  const f = fixture(t);
  for (const origin of ["https://evil.example.test", "https://other.test", "null", BASE + "/", BASE + ".evil.test"]) {
    const res = await f.call("/api/admin/users", { origin, body: invitation, headers: { "Content-Type": "text/plain", "Sec-Fetch-Site": "same-site", Referer: BASE + "/admin" } });
    assert.equal(res.status, 403);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM users WHERE email=?").get(invitation.email).n, 0);
});

test("same-origin JSON mutations work and form/plain/missing media types fail before writes", async t => {
  const f = fixture(t);
  for (const mediaType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""]) {
    const res = await f.call("/api/admin/users", { body: invitation, headers: { "Content-Type": mediaType } });
    assert.equal(res.status, 415);
  }
  assert.equal((await f.call("/api/admin/users", { body: invitation, headers: { "Content-Type": "application/json; charset=utf-8" } })).status, 201);
});

test("missing origin requires same-origin Referer; request URL and forwarding headers do not establish trust", async t => {
  const f = fixture(t);
  assert.equal((await f.call("/api/admin/users", { origin: null, body: invitation, headers: { "Sec-Fetch-Site": "same-origin", Host: "app.example.test", "X-Forwarded-Host": "app.example.test" } })).status, 403);
  assert.equal((await f.call("/api/admin/users", { origin: null, body: invitation, headers: { Referer: "https://evil.example.test/" } })).status, 403);
  assert.equal((await f.call("/api/admin/users", { origin: null, body: invitation, headers: { Referer: BASE + "/admin" } })).status, 201);
});

test("logout rejects sibling requests without revoking sessions; same-origin bodyless logout succeeds", async t => {
  const f = fixture(t);
  assert.equal((await f.call("/api/auth/logout", { origin: "https://evil.example.test" })).status, 403);
  assert.equal(f.db.prepare("SELECT session_version FROM users WHERE id='admin'").get().session_version, 0);
  assert.equal((await f.call("/api/auth/logout")).status, 200);
  assert.equal(f.db.prepare("SELECT session_version FROM users WHERE id='admin'").get().session_version, 1);
});

test("safe reads and Google callback remain cross-site; Google form start requires same origin", async t => {
  const f = fixture(t);
  assert.equal((await f.call("/api/admin/users", { method: "GET", origin: null })).status, 200);
  assert.equal((await f.call("/api/auth/google/callback?error=access_denied", { method: "GET", origin: null, cookie: false })).status, 302);
  assert.equal((await f.call("/api/auth/google/start", { origin: "https://evil.example.test", cookie: false })).status, 403);
  const response = await worker.fetch(new Request(BASE + "/api/auth/google/start", { method: "POST", headers: { Origin: BASE, "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.1" }, body: "returnTo=%2F" }), f.env);
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get("Location")).hostname, "accounts.google.com");
});

test("image uploads keep their validated binary handler and public OAuth remains credential-free", async t => {
  const f = fixture(t);
  const res = await f.call("/api/me/avatar", { body: "not-a-real-image", headers: { "Content-Type": "image/svg+xml" } });
  assert.equal(res.status, 400); // image media validation, not JSON media rejection
  const registration = await f.call("/api/oauth/register", { cookie: false, origin: "https://client.example", body: { client_name: "Synthetic client", redirect_uris: ["https://client.example/callback"] } });
  assert.equal(registration.status, 201);
  assert.equal(registration.headers.get("Access-Control-Allow-Origin"), "*");
});

test("missing or invalid trusted application origin fails closed for unsafe browser requests", async t => {
  const f = fixture(t);
  for (const configured of [undefined, "not-a-url", "data:text/plain,invalid"]) {
    f.env.APP_BASE_URL = configured;
    assert.equal((await f.call("/api/auth/logout")).status, 503);
  }
});

// workerd represents even bodyless HTTP mutations as a non-null empty stream.
test("streamed empty mutations pass, nonempty untyped streams fail, JSON stays readable", async () => {
  const { Hono, requireJsonMutationBody } = await importTs({
    contents: `export { Hono } from 'hono'; export { requireJsonMutationBody } from './src/middleware/browserRequest.ts';`,
    resolveDir: new URL("..", import.meta.url),
  }, { platform: "workerd" });
  const app = new Hono();
  app.use("*", requireJsonMutationBody);
  app.all("*", async c => c.text(await c.req.text()));
  const request = (method, chunks, headers = {}) => app.fetch(new Request(BASE + "/api/test", {
    method, headers, duplex: "half", body: new ReadableStream({ start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    } }),
  }));
  for (const method of ["DELETE", "POST", "PATCH"]) {
    assert.equal((await request(method, [])).status, 200);
    assert.equal((await request(method, ["", ""])).status, 200);
    assert.equal((await request(method, ["", "{}"])).status, 415);
    assert.equal((await request(method, ["{}"], { "Content-Length": "0" })).status, 415);
    assert.equal((await request(method, ["{}"], { "Content-Type": "text/plain" })).status, 415);
    const json = await request(method, ['{"ok":true}'], { "Content-Type": "application/json" });
    assert.equal(json.status, 200);
    assert.equal(await json.text(), '{"ok":true}');
  }
});

test("explicit local Worker preview origin works only with development opt-ins and loopback configuration", async t => {
  const f = fixture(t);
  f.env.DEV_WORKER_ORIGIN = "http://localhost:8787";
  const preview = () => f.call("/api/knowledge-points", { origin: f.env.DEV_WORKER_ORIGIN, body: {} });
  assert.equal((await preview()).status, 403);
  f.env.ENVIRONMENT = "development";
  f.env.APP_BASE_URL = "http://localhost:5173";
  assert.equal((await preview()).status, 403);
  f.env.ENABLE_DEV_PASSWORD_LOGIN = "true";
  assert.equal((await preview()).status, 201);
  for (const invalid of ["http://evil.example:8787", "http://localhost:8787/path", "http://localhost:8787.evil.test", "https://evil.example"]) {
    f.env.DEV_WORKER_ORIGIN = invalid;
    assert.equal((await preview()).status, 403);
  }
  f.env.DEV_WORKER_ORIGIN = "http://localhost:8787";
  f.env.APP_BASE_URL = BASE;
  assert.equal((await preview()).status, 403);
});
