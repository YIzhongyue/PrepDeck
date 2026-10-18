import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { createAnnotationRequestSchema, updateAnnotationRequestSchema } from "./annotations.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

const data = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

test("annotations: create", () => {
  const valid = { targetType: "stem", rangeStart: 0, rangeEnd: 4, style: "hl1" };
  assert.equal(error(createAnnotationRequestSchema, valid), null);
  assert.equal(error(createAnnotationRequestSchema, { ...valid, targetType: "options" }), "targetType must be one of stem, option, ai_explanation");
  assert.equal(error(createAnnotationRequestSchema, { ...valid, targetType: "option" }), "targetRef is required when targetType is option");
  assert.equal(error(createAnnotationRequestSchema, { ...valid, targetType: "option", targetRef: "" }), "targetRef is required when targetType is option");
  assert.equal(error(createAnnotationRequestSchema, { ...valid, targetType: "option", targetRef: "opt-a" }), null);
  assert.equal(error(createAnnotationRequestSchema, { ...valid, targetRef: "opt-a" }), "targetRef must be omitted unless targetType is option");
  assert.equal(error(createAnnotationRequestSchema, { ...valid, targetRef: 5 }), "targetRef must be omitted unless targetType is option");
  assert.equal(error(createAnnotationRequestSchema, { ...valid, targetRef: null }), null);
  for (const rangeStart of [-1, 1.5, "0", undefined]) {
    assert.equal(error(createAnnotationRequestSchema, { ...valid, rangeStart }), "rangeStart must be a non-negative integer");
  }
  for (const rangeEnd of [0, 4.5, null]) {
    assert.equal(error(createAnnotationRequestSchema, { ...valid, rangeStart: 0, rangeEnd }), "rangeEnd must be an integer greater than rangeStart");
  }
  assert.equal(error(createAnnotationRequestSchema, { ...valid, style: "" }), "style is required");
  assert.equal(error(createAnnotationRequestSchema, { ...valid, note: 3 }), "note must be a string");
  assert.equal(error(createAnnotationRequestSchema, { ...valid, note: "n".repeat(2001) }), "note must be 2,000 characters or fewer");
  assert.equal(error(createAnnotationRequestSchema, { ...valid, style: "s".repeat(65) }), "style must be 64 characters or fewer");
  // The note is checked before the style's length, as it always was.
  assert.equal(error(createAnnotationRequestSchema, { ...valid, style: "s".repeat(65), note: 3 }), "note must be a string");
});

test("annotations: update", () => {
  assert.equal(error(updateAnnotationRequestSchema, {}), null);
  assert.deepEqual(data(updateAnnotationRequestSchema, { style: null, note: null }), { style: null, note: null });
  assert.equal(error(updateAnnotationRequestSchema, { style: "" }), "style must be a non-empty string");
  assert.equal(error(updateAnnotationRequestSchema, { style: 2 }), "style must be a non-empty string");
  assert.equal(error(updateAnnotationRequestSchema, { note: false }), "note must be a string");
  assert.equal(error(updateAnnotationRequestSchema, { style: "s".repeat(65) }), "style must be 64 characters or fewer");
});
