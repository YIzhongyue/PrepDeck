import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { updateProfileRequestSchema } from "./profile.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

const data = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

test("a body that is missing or not an object gets the route's own message", () => {
  for (const body of [null, "text", 42]) assert.equal(error(updateProfileRequestSchema, body), "displayName is required");
});

test("profile: a trimmed display name", () => {
  assert.deepEqual(data(updateProfileRequestSchema, { displayName: " Ada " }), { displayName: "Ada" });
  assert.equal(error(updateProfileRequestSchema, { displayName: "  " }), "displayName is required");
  assert.equal(error(updateProfileRequestSchema, { displayName: "d".repeat(101) }), "displayName must be 100 characters or fewer");
});
