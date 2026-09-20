import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { circuitBreaker } from "../src/middleware/circuitBreaker.ts";

function app() {
  const hono = new Hono();
  hono.use("*", circuitBreaker);
  hono.all("*", (c) => c.text("ok"));
  return hono;
}

test("normal mode passes every request through untouched", async () => {
  const res = await app().request("/api/auth/login", { method: "POST" }, { CIRCUIT_MODE: "normal" });
  assert.equal(res.status, 200);
});

test("emergency mode still allows storage-free recovery paths from any source", async () => {
  const env = { CIRCUIT_MODE: "emergency", EMERGENCY_ADMIN_IPS: "" };
  assert.equal((await app().request("/api/auth/google/start", {}, env)).status, 200);
  assert.equal((await app().request("/api/auth/logout", { method: "POST" }, env)).status, 200);
});

test("emergency mode blocks unauthenticated login and OAuth callback (they touch D1/KV)", async () => {
  const env = { CIRCUIT_MODE: "emergency", EMERGENCY_ADMIN_IPS: "" };
  const login = await app().request("/api/auth/login", { method: "POST" }, env);
  assert.equal(login.status, 503);
  const callback = await app().request("/api/auth/google/callback", {}, env);
  assert.equal(callback.status, 503);
});

test("emergency mode allows login/callback only from an allow-listed admin IP", async () => {
  const env = { CIRCUIT_MODE: "emergency", EMERGENCY_ADMIN_IPS: "203.0.113.9" };
  const blocked = await app().request(
    "/api/auth/login",
    { method: "POST", headers: { "CF-Connecting-IP": "198.51.100.1" } },
    env
  );
  assert.equal(blocked.status, 503);
  const allowed = await app().request(
    "/api/auth/login",
    { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.9" } },
    env
  );
  assert.equal(allowed.status, 200);
});

test("emergency mode's health override handles both GET and HEAD", async () => {
  const env = { CIRCUIT_MODE: "emergency" };
  const get = await app().request("/api/health", {}, env);
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), { status: "restricted", mode: "emergency" });
  const head = await app().request("/api/health", { method: "HEAD" }, env);
  assert.equal(head.status, 200);
});

test("degraded mode blocks unsafe methods and AI/import/explanation reads, allows other GETs", async () => {
  const env = { CIRCUIT_MODE: "degraded" };
  assert.equal((await app().request("/api/exams", {}, env)).status, 200);
  assert.equal((await app().request("/api/exams", { method: "POST" }, env)).status, 503);
  assert.equal((await app().request("/api/ai/generate", { method: "POST" }, env)).status, 503);
  assert.equal((await app().request("/api/questions/q1/ai-explanations", {}, env)).status, 503);
  assert.equal((await app().request("/api/exams/e1/import", { method: "POST" }, env)).status, 503);
});
