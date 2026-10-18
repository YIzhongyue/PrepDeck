import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { updateAnnotationSettingsRequestSchema } from "./annotationSettings.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

test("annotation settings: at least one alias, each a short string", () => {
  assert.equal(error(updateAnnotationSettingsRequestSchema, {}), "Provide at least one of hl1Alias, hl2Alias, hl3Alias");
  assert.equal(error(updateAnnotationSettingsRequestSchema, { hl1Alias: "Service" }), null);
  assert.equal(error(updateAnnotationSettingsRequestSchema, { hl2Alias: 42 }), "hl2Alias must be a string");
  assert.equal(error(updateAnnotationSettingsRequestSchema, { hl3Alias: "x".repeat(41) }), "hl3Alias must be 40 characters or fewer");
  // Measured trimmed.
  assert.equal(error(updateAnnotationSettingsRequestSchema, { hl1Alias: `  ${"x".repeat(40)}  ` }), null);
});
