import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { updateUserSettingsRequestSchema } from "./settings.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

const data = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

test("user settings", () => {
  const schema = updateUserSettingsRequestSchema;
  assert.equal(error(schema, {}), "Provide showSharedNotes, theme and/or timezone");
  assert.equal(error(schema, { showSharedNotes: 1 }), "showSharedNotes must be a boolean");
  assert.deepEqual(data(schema, { theme: null }), { theme: null });
  assert.equal(error(schema, { theme: "light" }), "theme must be one of cream, sage, clay, dusk, or null");
  assert.deepEqual(data(schema, { timezone: "utc" }), { timezone: "UTC" });
  for (const timezone of ["Mars/Base", null, 3]) assert.equal(error(schema, { timezone }), "timezone must be a valid IANA time zone name");
});
