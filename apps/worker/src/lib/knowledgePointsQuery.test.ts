import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgePointsListQuery } from "./knowledgePointsQuery.ts";

test("no params defaults to updated DESC, unfiltered beyond owner", () => {
  const q = buildKnowledgePointsListQuery("u1", {});
  assert.equal(q?.where, "kp.user_id = ?");
  assert.deepEqual(q?.binds, ["u1"]);
  assert.equal(q?.orderBy, "kp.updated_at DESC, kp.id ASC");
});

test("filters by a specific group", () => {
  const q = buildKnowledgePointsListQuery("u1", { groupId: "g1" });
  assert.equal(q?.where, "kp.user_id = ? AND kp.group_id = ?");
  assert.deepEqual(q?.binds, ["u1", "g1"]);
});

test("ungrouped filters to group_id IS NULL and ignores a stray groupId", () => {
  const q = buildKnowledgePointsListQuery("u1", { ungrouped: true, groupId: "g1" });
  assert.equal(q?.where, "kp.user_id = ? AND kp.group_id IS NULL");
  assert.deepEqual(q?.binds, ["u1"]);
});

test("a single tag adds one AND-subquery condition", () => {
  const q = buildKnowledgePointsListQuery("u1", { tagIds: ["t1"] });
  assert.equal(
    q?.where,
    "kp.user_id = ? AND kp.id IN (SELECT knowledge_point_id FROM knowledge_point_tag_links WHERE tag_id = ?)"
  );
  assert.deepEqual(q?.binds, ["u1", "t1"]);
});

test("multiple tags AND together as separate subqueries, not OR/IN", () => {
  const q = buildKnowledgePointsListQuery("u1", { tagIds: ["t1", "t2"] });
  assert.equal(
    q?.where,
    "kp.user_id = ? AND kp.id IN (SELECT knowledge_point_id FROM knowledge_point_tag_links WHERE tag_id = ?) AND kp.id IN (SELECT knowledge_point_id FROM knowledge_point_tag_links WHERE tag_id = ?)"
  );
  assert.deepEqual(q?.binds, ["u1", "t1", "t2"]);
});

test("blank/whitespace-only tag ids are dropped", () => {
  const q = buildKnowledgePointsListQuery("u1", { tagIds: ["  ", "t1", ""] });
  assert.deepEqual(q?.binds, ["u1", "t1"]);
});

test("search matches title or body", () => {
  const q = buildKnowledgePointsListQuery("u1", { q: "scp" });
  assert.equal(q?.where, "kp.user_id = ? AND (kp.title LIKE ? OR kp.body_markdown LIKE ?)");
  assert.deepEqual(q?.binds, ["u1", "%scp%", "%scp%"]);
});

test("trims the search term", () => {
  const q = buildKnowledgePointsListQuery("u1", { q: "  scp  " });
  assert.deepEqual(q?.binds, ["u1", "%scp%", "%scp%"]);
});

test("empty-string search is treated as no filter", () => {
  const q = buildKnowledgePointsListQuery("u1", { q: "" });
  assert.equal(q?.where, "kp.user_id = ?");
});

test("filters by a linked question id", () => {
  const q = buildKnowledgePointsListQuery("u1", { linkedQuestionId: "q1" });
  assert.equal(
    q?.where,
    "kp.user_id = ? AND kp.id IN (SELECT knowledge_point_id FROM knowledge_point_question_links WHERE question_id = ?)"
  );
  assert.deepEqual(q?.binds, ["u1", "q1"]);
});

test("combines linkedQuestionId with a tag filter", () => {
  const q = buildKnowledgePointsListQuery("u1", { tagIds: ["t1"], linkedQuestionId: "q1" });
  assert.equal(
    q?.where,
    "kp.user_id = ? AND kp.id IN (SELECT knowledge_point_id FROM knowledge_point_tag_links WHERE tag_id = ?) AND kp.id IN (SELECT knowledge_point_id FROM knowledge_point_question_links WHERE question_id = ?)"
  );
  assert.deepEqual(q?.binds, ["u1", "t1", "q1"]);
});

test("filters by exam via linked questions", () => {
  const q = buildKnowledgePointsListQuery("u1", { examId: "e1" });
  assert.equal(
    q?.where,
    "kp.user_id = ? AND kp.id IN (SELECT ql.knowledge_point_id FROM knowledge_point_question_links ql JOIN questions q ON q.id = ql.question_id WHERE q.exam_id = ?)"
  );
  assert.deepEqual(q?.binds, ["u1", "e1"]);
});

test("combines examId with a tag filter", () => {
  const q = buildKnowledgePointsListQuery("u1", { tagIds: ["t1"], examId: "e1" });
  assert.equal(
    q?.where,
    "kp.user_id = ? AND kp.id IN (SELECT knowledge_point_id FROM knowledge_point_tag_links WHERE tag_id = ?) AND kp.id IN (SELECT ql.knowledge_point_id FROM knowledge_point_question_links ql JOIN questions q ON q.id = ql.question_id WHERE q.exam_id = ?)"
  );
  assert.deepEqual(q?.binds, ["u1", "t1", "e1"]);
});

for (const [sort, orderBy] of [
  ["updated", "kp.updated_at DESC, kp.id ASC"],
  ["title", "kp.title COLLATE NOCASE ASC, kp.id ASC"],
  ["created", "kp.created_at DESC, kp.id ASC"],
  ["custom", "kp.position ASC, kp.id ASC"],
] as const) {
  test(`sort=${sort} maps to "${orderBy}"`, () => {
    const q = buildKnowledgePointsListQuery("u1", { sort });
    assert.equal(q?.orderBy, orderBy);
  });
}

test("every sort mode appends kp.id as a deterministic tiebreaker", () => {
  for (const sort of ["updated", "title", "created", "custom"] as const) {
    const q = buildKnowledgePointsListQuery("u1", { sort });
    assert.ok(q?.orderBy.endsWith(", kp.id ASC"), `${sort} should end with a kp.id tiebreaker`);
  }
});

test("rejects an invalid sort value", () => {
  assert.equal(buildKnowledgePointsListQuery("u1", { sort: "sideways" }), null);
});

test("combines group, tags, search, and sort", () => {
  const q = buildKnowledgePointsListQuery("u1", { groupId: "g1", tagIds: ["t1"], q: "scp", sort: "title" });
  assert.equal(
    q?.where,
    "kp.user_id = ? AND kp.group_id = ? AND kp.id IN (SELECT knowledge_point_id FROM knowledge_point_tag_links WHERE tag_id = ?) AND (kp.title LIKE ? OR kp.body_markdown LIKE ?)"
  );
  assert.deepEqual(q?.binds, ["u1", "g1", "t1", "%scp%", "%scp%"]);
  assert.equal(q?.orderBy, "kp.title COLLATE NOCASE ASC, kp.id ASC");
});
