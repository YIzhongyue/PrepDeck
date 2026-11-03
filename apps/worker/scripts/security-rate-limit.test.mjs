import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { authenticatedRateLimit, classifyRequest, generalRateLimit, trustedClientKey } from "../src/middleware/rateLimit.ts";
import { RateLimiterObject } from "../src/rateLimiterObject.ts";
import { createRateLimiter } from "../../../tests/support/rate-limit.mjs";

test("trusted key ignores forged forwarding headers and groups IPv6 rotations", () => {
  const a = new Headers({ "CF-Connecting-IP": "2001:db8:1234:5678::1", "X-Forwarded-For": "1.2.3.4" });
  const b = new Headers({ "CF-Connecting-IP": "2001:db8:1234:5678::ffff", "X-Forwarded-For": "5.6.7.8" });
  assert.equal(trustedClientKey(a), "v6:2001:0db8:1234:5678/64");
  assert.equal(trustedClientKey(a), trustedClientKey(b));
  assert.equal(trustedClientKey(new Headers({ "X-Forwarded-For": "1.2.3.4" })), "unknown");
});

function durableState() {
  const values = new Map();
  let tail = Promise.resolve();
  return { storage: { transaction(callback) {
    const operation = tail.then(() => callback({
      get: async (key) => values.get(key),
      put: async (key, value) => { values.set(key, value); },
    }));
    tail = operation.catch(() => {});
    return operation;
  } } };
}

test("Durable Object atomically rejects excess concurrent cross-isolate requests", async () => {
  const object = new RateLimiterObject(durableState());
  const body = JSON.stringify({ windowSeconds: 60, max: 20 });
  // These concurrent calls model many Worker isolates addressing the same DO id.
  const results = await Promise.all(Array.from({ length: 100 }, () => object.fetch(new Request("https://limit/consume", { method: "POST", body }))));
  const payloads = await Promise.all(results.map((response) => response.json()));
  assert.equal(payloads.filter(({ allowed }) => allowed).length, 20);
  assert.equal(payloads.filter(({ allowed }) => !allowed).length, 80);
});

function failingEnv(extra = {}) {
  return { RATE_LIMITER: createRateLimiter({ respond: () => { throw new Error("storage down"); } }), ...extra };
}

test("storage failure fails closed for writes but degrades for ordinary GET", async () => {
  const app = new Hono();
  app.use("/api/*", generalRateLimit);
  app.all("/api/*", (c) => c.text("ok"));
  const write = await app.request("/api/settings", { method: "POST", headers: { "CF-Connecting-IP": "192.0.2.1" } }, failingEnv());
  assert.equal(write.status, 503);
  assert.equal(write.headers.get("Retry-After"), "30");
  const read = await app.request("/api/settings", { headers: { "CF-Connecting-IP": "192.0.2.1" } }, failingEnv());
  assert.equal(read.status, 200);
});

test("mock-exam draft saves get their own generous budget instead of the generic write bucket", () => {
  assert.equal(classifyRequest("PUT", "/api/attempts/attempt-1/answers/question-1"), "draft");
  assert.equal(classifyRequest("PUT", "/api/attempts/attempt-1/flags/question-1"), "draft");
  // Other methods on the same shape, and unrelated attempt routes, stay "write"/"read".
  assert.equal(classifyRequest("POST", "/api/attempts/attempt-1/answers"), "write");
  assert.equal(classifyRequest("GET", "/api/attempts/active"), "read");
});

test("logout shares the stricter auth bucket instead of falling through to write", () => {
  assert.equal(classifyRequest("POST", "/api/auth/logout"), "auth");
});

// The on/off GLOBAL_CIRCUIT_BREAKER this file used to test here was replaced
// by the normal/degraded/emergency circuit breaker — see
// scripts/circuit-breaker.test.mjs for its coverage.

test("only authenticated POST generation consumes global AI budget, after account admission", async () => {
  const app = new Hono();
  app.use("*", generalRateLimit);
  app.use("*", async (c, next) => {
    if (!c.req.header("Test-User")) return c.json({ error: "unauthorized" }, 401);
    c.set("user", { id: c.req.header("Test-User") });
    await next();
  });
  app.use("*", authenticatedRateLimit);
  app.post("/api/ai/generate", (c) => c.text("ok"));
  const limiter = createRateLimiter();
  const env = { RATE_LIMITER: limiter };
  for (const method of ["POST", "GET"]) {
    assert.equal((await app.request("/api/ai/generate", { method }, env)).status, 401);
  }
  await app.request("/api/ai/generate", { headers: { "Test-User": "alice" } }, env);
  assert.equal(limiter.calls.filter(({ key }) => key === "ai:global").length, 0);
  assert.equal((await app.request("/api/ai/generate", { method: "POST", headers: { "Test-User": "alice" } }, env)).status, 200);
  assert.deepEqual(limiter.calls.slice(-2).map(({ key }) => key), ["ai:user:alice", "ai:global"]);
  limiter.respond = ({ key }) => ({ allowed: key !== "ai:user:alice", retryAfter: 7 });
  const before = limiter.calls.filter(({ key }) => key === "ai:global").length;
  assert.equal((await app.request("/api/ai/generate", { method: "POST", headers: { "Test-User": "alice" } }, env)).status, 429);
  assert.equal(limiter.calls.filter(({ key }) => key === "ai:global").length, before);
  limiter.respond = ({ key }) => ({ allowed: key !== "ai:global", retryAfter: 9 });
  const full = await app.request("/api/ai/generate", { method: "POST", headers: { "Test-User": "bob" } }, env);
  assert.equal(full.status, 429);
  assert.equal(full.headers.get("Retry-After"), "9");
  limiter.respond = ({ key }) => { if (key === "ai:global") throw new Error("unavailable"); };
  assert.equal((await app.request("/api/ai/generate", { method: "POST", headers: { "Test-User": "bob" } }, env)).status, 503);
});