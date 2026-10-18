import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { autosaveKnowledgePointRequestSchema, createKnowledgePointRequestSchema, linkKnowledgePointQuestionRequestSchema, reorderKnowledgePointRequestSchema, setKnowledgePointGroupRequestSchema } from "./knowledgePoints.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

const data = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

test("a body that is missing or not an object gets the route's own message", () => {
  for (const body of [null, "text", 42]) assert.equal(error(setKnowledgePointGroupRequestSchema, body), "groupId is required");
});

test("a body that is missing or not an object gets the route's own message", () => {
  for (const body of [null, "text", 42]) assert.equal(error(reorderKnowledgePointRequestSchema, body), "beforeId is required");
});

test("a body that is missing or not an object gets the route's own message", () => {
  for (const body of [null, "text", 42]) assert.equal(error(linkKnowledgePointQuestionRequestSchema, body), "questionId is required");
});

test("knowledge points: create is never refused, ids pass through String()", () => {
  for (const body of [null, [], "x", {}, { groupId: null }]) {
    assert.deepEqual(data(createKnowledgePointRequestSchema, body), { groupId: null });
  }
  assert.deepEqual(data(createKnowledgePointRequestSchema, { groupId: "g1" }), { groupId: "g1" });
  assert.deepEqual(data(createKnowledgePointRequestSchema, { groupId: 5 }), { groupId: "5" });
});

test("knowledge points: autosave, group move, reorder and link", () => {
  const valid = { baseRevision: 1, title: "T", bodyMarkdown: "B" };
  assert.equal(error(autosaveKnowledgePointRequestSchema, valid), null);
  assert.equal(error(autosaveKnowledgePointRequestSchema, { ...valid, baseRevision: "1" }), "baseRevision is required");
  assert.equal(error(autosaveKnowledgePointRequestSchema, { ...valid, title: undefined }), "title is required");
  assert.equal(error(autosaveKnowledgePointRequestSchema, { ...valid, title: "t".repeat(201) }), "title must be 200 characters or fewer");
  assert.equal(error(autosaveKnowledgePointRequestSchema, { ...valid, bodyMarkdown: null }), "bodyMarkdown is required");
  assert.equal(error(autosaveKnowledgePointRequestSchema, { ...valid, bodyMarkdown: "b".repeat(200_001) }), "bodyMarkdown must be 200000 characters or fewer");

  assert.equal(error(setKnowledgePointGroupRequestSchema, {}), "groupId is required");
  assert.deepEqual(data(setKnowledgePointGroupRequestSchema, { groupId: null }), { groupId: null });
  assert.deepEqual(data(setKnowledgePointGroupRequestSchema, { groupId: 9 }), { groupId: "9" });

  assert.equal(error(reorderKnowledgePointRequestSchema, {}), "beforeId is required");
  assert.deepEqual(data(reorderKnowledgePointRequestSchema, { beforeId: null }), { beforeId: null });
  assert.deepEqual(data(reorderKnowledgePointRequestSchema, { beforeId: "kp2", expectedOrderRevision: 3 }), { beforeId: "kp2", expectedOrderRevision: 3 });
  for (const expectedOrderRevision of [0, 1.5, "2", null, 2 ** 53]) {
    assert.equal(error(reorderKnowledgePointRequestSchema, { beforeId: null, expectedOrderRevision }),
      "expectedOrderRevision must be a positive integer; reload the list before reordering");
  }

  assert.equal(error(linkKnowledgePointQuestionRequestSchema, { questionId: "" }), "questionId is required");
  assert.equal(error(linkKnowledgePointQuestionRequestSchema, { questionId: "q1" }), null);
});
