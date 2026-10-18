import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { inviteUserRequestSchema, updateUserRequestSchema } from "./admin.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

const data = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

test("a body that is missing or not an object gets the route's own message", () => {
  for (const body of [null, "text", 42]) assert.equal(error(inviteUserRequestSchema, body), "A valid email is required");
});

test("admin users: invite and update", () => {
  assert.deepEqual(data(inviteUserRequestSchema, { email: "  Ada@Example.COM ", role: "user" }), { email: "ada@example.com", role: "user" });
  assert.equal(error(inviteUserRequestSchema, { email: "nope", role: "user" }), "A valid email is required");
  assert.equal(error(inviteUserRequestSchema, { email: "   ", role: "user" }), "A valid email is required");
  assert.equal(error(inviteUserRequestSchema, { email: "a@b.co", role: "owner" }), "role must be 'admin' or 'user'");
  assert.equal(error(inviteUserRequestSchema, { email: "a@b.co" }), "role must be 'admin' or 'user'");

  assert.equal(error(updateUserRequestSchema, {}), "Nothing to update");
  assert.equal(error(updateUserRequestSchema, { role: "owner" }), "role must be 'admin' or 'user'");
  assert.equal(error(updateUserRequestSchema, { status: "invited" }), "status must be 'active' or 'revoked'");
  assert.equal(error(updateUserRequestSchema, { googleSub: "123" }), "googleSub can only be cleared (null)");
  assert.deepEqual(data(updateUserRequestSchema, { googleSub: null }), { googleSub: null });
  assert.deepEqual(data(updateUserRequestSchema, { role: "admin", status: "revoked" }), { role: "admin", status: "revoked" });
});
