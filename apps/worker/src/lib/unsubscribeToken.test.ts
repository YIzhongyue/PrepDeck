import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../bindings.ts";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribeToken.ts";
import { createSessionToken } from "./session.ts";

const env = { SESSION_SECRET: "test-secret-value" } as Env;

test("round trip: a created token verifies back to the same user id", async () => {
  const token = await createUnsubscribeToken("user-123", env);
  const result = await verifyUnsubscribeToken(token, env);
  assert.deepEqual(result, { userId: "user-123" });
});

test("rejects a tampered signature", async () => {
  const token = await createUnsubscribeToken("user-123", env);
  const tampered = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
  assert.equal(await verifyUnsubscribeToken(tampered, env), null);
});

test("rejects a tampered payload", async () => {
  const token = await createUnsubscribeToken("user-123", env);
  const tampered = token.replace("user-123", "user-456");
  assert.equal(await verifyUnsubscribeToken(tampered, env), null);
});

test("rejects garbage input", async () => {
  assert.equal(await verifyUnsubscribeToken("not-a-token", env), null);
  assert.equal(await verifyUnsubscribeToken("", env), null);
});

test("a session cookie token is never accepted as an unsubscribe token", async () => {
  const sessionToken = await createSessionToken("user-123", env);
  assert.equal(await verifyUnsubscribeToken(sessionToken, env), null);
});
