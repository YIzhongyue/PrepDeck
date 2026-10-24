import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";

const { authRouter } = await importTs(new URL("../src/routes/auth.ts", import.meta.url));
const bindings = { AUTH_MODE: "cookie", ENVIRONMENT: "production", APP_BASE_URL: "https://app.example.test", SESSION_SECRET: "synthetic", GOOGLE_CLIENT_ID: "synthetic-client" };
const noDatabase = new Proxy({}, { get() { assert.fail("rejected origin must not access D1"); } });
const routes = ["/google/start", "/google/callback?code=synthetic&state=synthetic"];

for (const [label, APP_BASE_URL] of [
  ["missing", undefined], ["malformed", "not a URL"], ["HTTP", "http://app.example.test"],
  ["path", "https://app.example.test/path"], ["credentials", "https://user:pass@app.example.test"],
  ["query", "https://app.example.test/?q=1"], ["fragment", "https://app.example.test/#part"],
]) test(`Google refuses ${label} configured origin before side effects`, async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("no network on rejected origin"));
  for (const route of routes) {
    const response = await authRouter.request(`https://app.example.test${route}`, {}, { ...bindings, APP_BASE_URL, DB: noDatabase });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Set-Cookie"), null);
  }
});

test("Google refuses wrong host and HTTP request despite spoofed forwarding headers", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("no network on rejected origin"));
  for (const origin of ["https://attacker.example.test", "http://app.example.test"]) for (const route of routes) {
    const response = await authRouter.request(`${origin}${route}`, { headers: { Host: "app.example.test", "X-Forwarded-Host": "app.example.test", "X-Forwarded-Proto": "https" } }, { ...bindings, DB: noDatabase });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Set-Cookie"), null);
  }
});

test("Google callback requires configured cookie authentication mode", async () => {
  assert.equal((await authRouter.request("https://app.example.test/google/callback", {}, { ...bindings, AUTH_MODE: "access" })).status, 503);
});

test("Google uses configured HTTPS origin and emits Secure state cookie", async () => {
  const response = await authRouter.request("https://app.example.test/google/start", {}, { ...bindings, APP_BASE_URL: "https://app.example.test/" });
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("Location")).searchParams.get("redirect_uri"), "https://app.example.test/api/auth/google/callback");
  assert.match(response.headers.get("Set-Cookie"), /; Secure;/);
});

test("only explicit development may configure a matching loopback HTTP origin", async () => {
  for (const origin of ["http://localhost:8788", "http://127.0.0.1:8788", "http://[::1]:8788"]) {
    const response = await authRouter.request(`${origin}/google/start`, {}, { ...bindings, ENVIRONMENT: "development", APP_BASE_URL: origin });
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("Location")).searchParams.get("redirect_uri"), `${origin}/api/auth/google/callback`);
  }
  for (const ENVIRONMENT of [undefined, "staging", "production"]) {
    assert.equal((await authRouter.request("http://localhost:8788/google/start", {}, { ...bindings, ENVIRONMENT, APP_BASE_URL: "http://localhost:8788" })).status, 503);
  }
  assert.equal((await authRouter.request("http://app.example.test/google/start", {}, { ...bindings, ENVIRONMENT: "development", APP_BASE_URL: "http://app.example.test" })).status, 503);
  assert.equal((await authRouter.request("http://localhost:9999/google/start", {}, { ...bindings, ENVIRONMENT: "development", APP_BASE_URL: "http://localhost:8788" })).status, 403);
});
