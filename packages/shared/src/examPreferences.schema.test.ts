import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { updateExamStudyPreferencesRequestSchema } from "./examPreferences.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

const data = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

test("exam study preferences keep omitted and null apart", () => {
  const schema = updateExamStudyPreferencesRequestSchema;
  assert.equal(error(schema, {}), "Provide targetDate and/or weeklyGoalMinutes");
  assert.deepEqual(data(schema, { targetDate: null }), { targetDate: null });
  assert.deepEqual(data(schema, { weeklyGoalMinutes: 120 }), { weeklyGoalMinutes: 120 });
  for (const targetDate of ["2026-02-31", "banana", 20260101]) {
    assert.equal(error(schema, { targetDate }), "targetDate must be a calendar date in YYYY-MM-DD form, or null");
  }
  for (const weeklyGoalMinutes of [14, 10081, 30.5, "60"]) {
    assert.equal(error(schema, { weeklyGoalMinutes }), "weeklyGoalMinutes must be a whole number of minutes between 15 and 10080, or null");
  }
});
