import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { saveDraftAnswerRequestSchema, saveFlagRequestSchema } from "./attempts.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

const data = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

test("mock drafts and flags", () => {
  assert.deepEqual(data(saveDraftAnswerRequestSchema, { selectedAnswer: ["a", "b"] }), { selectedAnswer: ["a", "b"] });
  for (const body of [null, {}, { selectedAnswer: "a" }]) {
    assert.equal(error(saveDraftAnswerRequestSchema, body), "selectedAnswer is required");
  }
  assert.equal(error(saveDraftAnswerRequestSchema, { selectedAnswer: ["a", 1] }), "selectedAnswer must be an array of strings");
  assert.equal(error(saveFlagRequestSchema, { flagged: false }), null);
  for (const body of [null, {}, { flagged: "true" }]) assert.equal(error(saveFlagRequestSchema, body), "flagged is required");
});
