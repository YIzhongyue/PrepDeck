import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { updateDailyEmailSettingsRequestSchema } from "./dailyEmailSettings.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

test("daily email settings", () => {
  const schema = updateDailyEmailSettingsRequestSchema;
  assert.equal(error(schema, {}), "Provide at least one of enabled, questionsPerEmail, source, timezone, sendHourLocal");
  assert.equal(error(schema, { enabled: true }), null);
  assert.equal(error(schema, { enabled: "true" }), "enabled must be a boolean");
  for (const questionsPerEmail of [1, 5]) assert.equal(error(schema, { questionsPerEmail }), null);
  for (const questionsPerEmail of [0, 6, 2.5]) assert.equal(error(schema, { questionsPerEmail }), "questionsPerEmail must be an integer between 1 and 5");
  for (const source of ["wrong", "bm", "new"]) assert.equal(error(schema, { source }), null);
  assert.equal(error(schema, { source: "unattempted" }), "source must be one of wrong, bm, new");
  for (const sendHourLocal of [0, 23]) assert.equal(error(schema, { sendHourLocal }), null);
  for (const sendHourLocal of [24, -1]) assert.equal(error(schema, { sendHourLocal }), "sendHourLocal must be an integer between 0 and 23");
  for (const timezone of ["America/Los_Angeles", "UTC"]) assert.equal(error(schema, { timezone }), null);
  for (const timezone of ["Not/AZone", "", null]) assert.equal(error(schema, { timezone }), "timezone must be a valid IANA time zone name");
});
