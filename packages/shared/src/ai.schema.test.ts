import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { generateAiExplanationRequestSchema, updateAiExplanationRequestSchema } from "./ai.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

const data = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

test("a body that is missing or not an object gets the route's own message", () => {
  for (const body of [null, "text", 42]) assert.equal(error(generateAiExplanationRequestSchema, body), "questionId is required");
});

test("a body that is missing or not an object gets the route's own message", () => {
  for (const body of [null, "text", 42]) assert.equal(error(updateAiExplanationRequestSchema, body), "content is required");
});

test("AI explanations: generate and correct", () => {
  const valid = { questionId: "q1", provider: "openai", model: " gpt-x " };
  assert.deepEqual(data(generateAiExplanationRequestSchema, valid), { questionId: "q1", provider: "openai", model: "gpt-x" });
  assert.equal(error(generateAiExplanationRequestSchema, { ...valid, questionId: 7 }), "questionId is required");
  assert.equal(error(generateAiExplanationRequestSchema, { ...valid, provider: "gemini" }), "provider must be 'openai' or 'anthropic'");
  for (const model of [undefined, 3, "   ", "m".repeat(101)]) {
    assert.equal(error(generateAiExplanationRequestSchema, { ...valid, model }), "model is required");
  }
  // A malformed key or force flag is treated as absent, as before: the key is
  // only required on a cache miss, and only `true` forces a regeneration.
  const lenient = data(generateAiExplanationRequestSchema, { ...valid, apiKey: 5, force: "yes" });
  assert.equal(lenient.apiKey, undefined);
  assert.equal(lenient.force, undefined);
  assert.equal(data(generateAiExplanationRequestSchema, { ...valid, apiKey: "sk", force: true }).force, true);

  assert.equal(data(updateAiExplanationRequestSchema, { content: "  Better.  " }).content, "Better.");
  assert.equal(error(updateAiExplanationRequestSchema, { content: "  " }), "content is required");
});
