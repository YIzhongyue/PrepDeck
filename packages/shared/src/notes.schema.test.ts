import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { createNoteRequestSchema, updateNoteRequestSchema } from "./notes.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

const data = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

test("a body that is missing or not an object gets the route's own message", () => {
  for (const body of [null, "text", 42]) assert.equal(error(updateNoteRequestSchema, body), "Invalid JSON body");
});

test("notes: create and update, checked and stored trimmed", () => {
  assert.deepEqual(data(createNoteRequestSchema, { content: "  Hi  ", visibility: "shared" }), { content: "Hi", visibility: "shared" });
  assert.equal(error(createNoteRequestSchema, { content: "  ", visibility: "shared" }), "content is required");
  assert.equal(error(createNoteRequestSchema, { content: `  ${"c".repeat(10_000)}  `, visibility: "private" }), null);
  assert.equal(error(createNoteRequestSchema, { content: "c".repeat(10_001), visibility: "private" }), "content must be 10,000 characters or fewer");
  assert.equal(error(createNoteRequestSchema, { content: "Hi" }), "visibility must be private or shared");

  assert.equal(error(updateNoteRequestSchema, {}), null);
  assert.equal(error(updateNoteRequestSchema, { content: " " }), "content must be a non-empty string");
  assert.equal(error(updateNoteRequestSchema, { content: "c".repeat(10_001) }), "content must be 10,000 characters or fewer");
  assert.equal(error(updateNoteRequestSchema, { visibility: "public" }), "visibility must be private or shared");
});
