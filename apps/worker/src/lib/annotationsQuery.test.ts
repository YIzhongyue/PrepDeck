import assert from "node:assert/strict";
import test from "node:test";
import { buildAnnotationsListQuery } from "./annotationsQuery.ts";

test("no params reproduces the pre-filter unfiltered, created_at ASC query", () => {
  const q = buildAnnotationsListQuery("u1", undefined, undefined);
  assert.equal(q?.sql, "SELECT * FROM annotations WHERE user_id = ? ORDER BY created_at ASC, id ASC");
  assert.deepEqual(q?.binds, ["u1"]);
});

test("filters by a single mark type", () => {
  const q = buildAnnotationsListQuery("u1", "hl2", undefined);
  assert.equal(q?.sql, "SELECT * FROM annotations WHERE user_id = ? AND style IN (?) ORDER BY created_at ASC, id ASC");
  assert.deepEqual(q?.binds, ["u1", "hl2"]);
});

test("filters by multiple mark types", () => {
  const q = buildAnnotationsListQuery("u1", "hl1,hl3", undefined);
  assert.equal(q?.sql, "SELECT * FROM annotations WHERE user_id = ? AND style IN (?,?) ORDER BY created_at ASC, id ASC");
  assert.deepEqual(q?.binds, ["u1", "hl1", "hl3"]);
});

test("trims whitespace around mark type values", () => {
  const q = buildAnnotationsListQuery("u1", " hl1 , hl2 ", undefined);
  assert.deepEqual(q?.binds, ["u1", "hl1", "hl2"]);
});

test("rejects an invalid mark type", () => {
  assert.equal(buildAnnotationsListQuery("u1", "hl1,bogus", undefined), null);
});

test("empty-string markType is treated as no filter", () => {
  const q = buildAnnotationsListQuery("u1", "", undefined);
  assert.equal(q?.sql, "SELECT * FROM annotations WHERE user_id = ? ORDER BY created_at ASC, id ASC");
});

test("sort=desc orders newest first", () => {
  const q = buildAnnotationsListQuery("u1", undefined, "desc");
  assert.equal(q?.sql, "SELECT * FROM annotations WHERE user_id = ? ORDER BY created_at DESC, id ASC");
});

test("sort=asc orders oldest first", () => {
  const q = buildAnnotationsListQuery("u1", undefined, "asc");
  assert.equal(q?.sql, "SELECT * FROM annotations WHERE user_id = ? ORDER BY created_at ASC, id ASC");
});

test("rejects an invalid sort value", () => {
  assert.equal(buildAnnotationsListQuery("u1", undefined, "sideways"), null);
});

test("combines a mark-type filter with a sort order", () => {
  const q = buildAnnotationsListQuery("u1", "hl1,hl2", "desc");
  assert.equal(q?.sql, "SELECT * FROM annotations WHERE user_id = ? AND style IN (?,?) ORDER BY created_at DESC, id ASC");
  assert.deepEqual(q?.binds, ["u1", "hl1", "hl2"]);
});

// implementation — pagination for the User MCP's list_annotations tool. Omitted
// (as above) keeps the REST route's existing unpaginated contract.
test("page appends LIMIT/OFFSET, querying limit + 1 rows", () => {
  const q = buildAnnotationsListQuery("u1", undefined, undefined, undefined, { limit: 25, offset: 50 });
  assert.equal(q?.sql, "SELECT * FROM annotations WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?");
  assert.deepEqual(q?.binds, ["u1", 26, 50]);
});

test("page combines with examId, mark-type, and sort filters", () => {
  const q = buildAnnotationsListQuery("u1", "hl1", "desc", "exam1", { limit: 10, offset: 0 });
  assert.equal(
    q?.sql,
    "SELECT * FROM annotations WHERE user_id = ? AND question_id IN (SELECT id FROM questions WHERE exam_id = ?) AND style IN (?) ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?",
  );
  assert.deepEqual(q?.binds, ["u1", "exam1", "hl1", 11, 0]);
});
