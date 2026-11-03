import assert from "node:assert/strict";
import test from "node:test";
import { knowledgePointSearchTextSchema, knowledgePointSearchTagsSchema } from "./knowledgePointSearch.schema.ts";

test("REST and MCP share pre-trim query and tag bounds", () => {
  assert.equal(knowledgePointSearchTextSchema.safeParse("界".repeat(200)).success, true);
  assert.equal(knowledgePointSearchTextSchema.safeParse("界".repeat(201)).success, false);
  assert.equal(knowledgePointSearchTagsSchema.safeParse(Array(20).fill("tag")).success, true);
  assert.equal(knowledgePointSearchTagsSchema.safeParse(Array(21).fill("tag")).success, false);
  assert.equal(knowledgePointSearchTagsSchema.safeParse(["x".repeat(201)]).success, false);
});
