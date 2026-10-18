// Admin MCP read and quality-control tools, and that none of them writes.
// The harness is mcp-foundation-fixture.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import {
  fixture, rpc, payload, seedQuestionTags, questionBankFixture, callAdminTool, callAdminToolExpectingError,
} from "./mcp-foundation-fixture.mjs";

test("implementation: admin_search_questions and admin_get_question reuse the exam-scoped question service", async (t) => {
  const f = await questionBankFixture(t);
  const search = await callAdminTool(f, "admin_search_questions", { examId: "examA", q: "2+2" });
  assert.deepEqual(search.questions.map((question) => question.id), ["q1", "q2"]);
  assert.equal(search.total, 2);

  const byType = await callAdminTool(f, "admin_search_questions", { examId: "examA", type: "true_false" });
  assert.deepEqual(byType.questions.map((question) => question.id), ["q3"]);

  const got = await callAdminTool(f, "admin_get_question", { examId: "examA", id: "q1" });
  assert.equal(got.question.stem, "What is 2+2?");
  assert.equal((await callAdminToolExpectingError(f, "admin_get_question", { examId: "examA", id: "missing" })).code, "not_found");
});

test("implementation: admin_list_exams and admin_get_exam reuse the exam service and respect includeArchived", async (t) => {
  const f = await questionBankFixture(t);
  const active = await callAdminTool(f, "admin_list_exams", {});
  assert.deepEqual(active.exams.map((exam) => exam.id), ["examA"]);
  const all = await callAdminTool(f, "admin_list_exams", { includeArchived: true });
  assert.deepEqual(new Set(all.exams.map((exam) => exam.id)), new Set(["examA", "examB"]));

  const exam = await callAdminTool(f, "admin_get_exam", { id: "examA" });
  assert.equal(exam.exam.questionCount, 4);
  assert.equal((await callAdminToolExpectingError(f, "admin_get_exam", { id: "missing" })).code, "not_found");
});

test("implementation: admin_list_exams bounds and paginates its result instead of returning every exam", async (t) => {
  const f = await fixture(t);
  const now = new Date().toISOString();
  const insertExam = f.sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)");
  for (const id of ["e1", "e2", "e3"]) insertExam.run(id, `exam-${id}`, `Exam ${id}`, now);

  const page1 = await callAdminTool(f, "admin_list_exams", { limit: 2, offset: 0 });
  assert.deepEqual(page1.exams.map((exam) => exam.id), ["e1", "e2"]);
  assert.equal(page1.nextOffset, 2);
  const page2 = await callAdminTool(f, "admin_list_exams", { limit: 2, offset: 2 });
  assert.deepEqual(page2.exams.map((exam) => exam.id), ["e3"]);
  assert.equal(page2.nextOffset, null);
});

test("implementation: admin_get_exam_statistics summarizes type/difficulty/quality counts and attempts for one exam", async (t) => {
  const f = await questionBankFixture(t);
  const { exam, statistics, attempts } = await callAdminTool(f, "admin_get_exam_statistics", { examId: "examA" });
  assert.equal(exam.id, "examA");
  assert.equal(statistics.scannedCount, 4);
  assert.equal(statistics.truncated, false);
  assert.deepEqual(statistics.byType, { single_choice: 2, multiple_choice: 0, true_false: 1, fill_blank: 1, ordering: 0, matching: 0 });
  assert.equal(statistics.byDifficulty.unset, 1);
  assert.equal(statistics.missingExplanationCount, 1);
  assert.equal(statistics.missingMetadataCount, 1);
  assert.equal(statistics.invalidAnswerReferenceCount, 1);
  assert.equal(statistics.duplicateGroupCount, 1);
  assert.equal(statistics.duplicateQuestionCount, 2);
  assert.deepEqual(attempts, { total: 2, completed: 1 });
  assert.equal((await callAdminToolExpectingError(f, "admin_get_exam_statistics", { examId: "missing" })).code, "not_found");
});

test("implementation: quality-control find_* tools locate the seeded duplicate, missing-explanation, invalid-reference and missing-metadata questions", async (t) => {
  const f = await questionBankFixture(t);

  const duplicates = await callAdminTool(f, "admin_find_duplicate_questions", { examId: "examA" });
  assert.equal(duplicates.items.length, 1);
  assert.deepEqual(duplicates.items[0].questions.map((question) => question.id).sort(), ["q1", "q2"]);
  assert.equal(duplicates.scannedCount, 4);

  const missingExplanations = await callAdminTool(f, "admin_find_questions_missing_explanations", { examId: "examA" });
  assert.deepEqual(missingExplanations.items.map((item) => item.id), ["q2"]);

  const invalidRefs = await callAdminTool(f, "admin_find_questions_with_invalid_answer_references", { examId: "examA" });
  assert.deepEqual(invalidRefs.items.map((item) => item.id), ["q3"]);
  assert.ok(invalidRefs.items[0].issues[0].includes("true_false"));

  const missingMetadata = await callAdminTool(f, "admin_find_questions_missing_metadata", { examId: "examA" });
  assert.deepEqual(missingMetadata.items.map((item) => item.id), ["q2"]);
  assert.deepEqual(missingMetadata.items[0], {
    id: "q2", examId: "examA", externalId: null, sequenceNumber: 2, type: "single_choice",
    stemPreview: "what is 2+2?", updatedAt: "2026-01-03T00:00:00.000Z",
    missingDifficulty: true, missingTags: true, invalidPoints: false,
  });

  assert.equal((await callAdminToolExpectingError(f, "admin_find_duplicate_questions", { examId: "missing" })).code, "not_found");
});

test("implementation: find_* tools apply offset to their in-memory-filtered matches, not just page one", async (t) => {
  // The find_* tools scan a whole exam and filter matches in memory (unlike
  // the SQL-paginated list tools), so their result array starts at index 0
  // regardless of `offset`. Three distinct one-item pages confirm offset is
  // honored rather than always slicing from the start of the match array.
  const f = await fixture(t);
  const now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)").run("examP", "exam-p", "Exam P", now);
  const insertQuestion = f.sqlite.prepare(`INSERT INTO questions
    (id, exam_id, external_id, sequence_number, type, stem, options_json, correct_answers_json,
     explanation, difficulty, points, created_at, updated_at)
    VALUES (?, 'examP', NULL, ?, 'fill_blank', ?, NULL, '["x"]', NULL, 'easy', 1, ?, ?)`);
  for (const [id, seq] of [["p1", 1], ["p2", 2], ["p3", 3]]) insertQuestion.run(id, seq, `Question ${seq}`, now, now);

  const page1 = await callAdminTool(f, "admin_find_questions_missing_explanations", { examId: "examP", limit: 1, offset: 0 });
  assert.deepEqual(page1.items.map((item) => item.id), ["p1"]);
  assert.equal(page1.nextOffset, 1);
  const page2 = await callAdminTool(f, "admin_find_questions_missing_explanations", { examId: "examP", limit: 1, offset: 1 });
  assert.deepEqual(page2.items.map((item) => item.id), ["p2"]);
  assert.equal(page2.nextOffset, 2);
  const page3 = await callAdminTool(f, "admin_find_questions_missing_explanations", { examId: "examP", limit: 1, offset: 2 });
  assert.deepEqual(page3.items.map((item) => item.id), ["p3"]);
  assert.equal(page3.nextOffset, null);
});

test("implementation: admin_get_question_bank_statistics and admin_list_tags aggregate across the whole bank", async (t) => {
  const f = await questionBankFixture(t);

  const bank = await callAdminTool(f, "admin_get_question_bank_statistics", {});
  assert.equal(bank.statistics.scannedCount, 5);
  assert.equal(bank.examsScanned, 2);
  assert.deepEqual(new Map(bank.byExam.map((e) => [e.examId, e.questionCount])), new Map([["examA", 4], ["examB", 1]]));

  const allTags = await callAdminTool(f, "admin_list_tags", {});
  // implementation: every tag association now references a real catalog row —
  // there is no more "used in tags_json but never registered" state, so
  // `registered` is always true for a tag actually applied to a question.
  assert.deepEqual(allTags.items, [
    { tag: "examB", questionCount: 1, registered: true }, { tag: "fill", questionCount: 1, registered: true },
    { tag: "math", questionCount: 2, registered: true }, { tag: "science", questionCount: 1, registered: true },
  ]);
  const examTags = await callAdminTool(f, "admin_list_tags", { examId: "examA" });
  assert.deepEqual(examTags.items.map((tag) => tag.tag), ["fill", "math", "science"]);
});

test("implementation: admin_list_tags counts distinct questions, not tag/question pairs", async (t) => {
  // A question can carry a duplicate tag value ("aws" twice) because
  // validateQuestionRow doesn't dedupe `tags`; the tag-count SQL joins
  // through json_each, so COUNT(*) would count that question twice.
  const f = await fixture(t);
  const now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)").run("examR", "exam-r", "Exam R", now);
  const insertQuestion = f.sqlite.prepare(`INSERT INTO questions
    (id, exam_id, external_id, sequence_number, type, stem, options_json, correct_answers_json,
     explanation, difficulty, points, created_at, updated_at)
    VALUES (?, 'examR', NULL, ?, 'fill_blank', ?, NULL, '["x"]', NULL, 'easy', 1, ?, ?)`);
  insertQuestion.run("r1", 1, "Question 1", now, now);
  seedQuestionTags(f.sqlite, "r1", ["aws", "aws"]);
  insertQuestion.run("r2", 2, "Question 2", now, now);
  seedQuestionTags(f.sqlite, "r2", ["aws"]);

  const tags = await callAdminTool(f, "admin_list_tags", { examId: "examR" });
  assert.deepEqual(tags.items, [{ tag: "aws", questionCount: 2, registered: true }]);
});

test("implementation: admin_get_recent_content_changes orders by updated_at, scopes by exam, and paginates", async (t) => {
  const f = await questionBankFixture(t);

  const page1 = await callAdminTool(f, "admin_get_recent_content_changes", { limit: 2, offset: 0 });
  assert.deepEqual(page1.items.map((item) => item.id), ["q3", "q2"]);
  assert.equal(page1.nextOffset, 2);

  const page2 = await callAdminTool(f, "admin_get_recent_content_changes", { limit: 2, offset: 2 });
  assert.deepEqual(page2.items.map((item) => item.id), ["q5", "q1"]);

  const scoped = await callAdminTool(f, "admin_get_recent_content_changes", { examId: "examA", limit: 10, offset: 0 });
  assert.deepEqual(scoped.items.map((item) => item.id), ["q3", "q2", "q1", "q4"]);
  assert.equal((await callAdminToolExpectingError(f, "admin_get_recent_content_changes", { examId: "missing" })).code, "not_found");
});

test("implementation: Admin MCP reads never mutate the question bank, and User MCP cannot reach admin tools", async (t) => {
  const f = await questionBankFixture(t);
  for (const [name, args] of [
    ["admin_search_questions", { examId: "examA" }], ["admin_get_question", { examId: "examA", id: "q1" }],
    ["admin_list_exams", {}], ["admin_get_exam", { id: "examA" }], ["admin_get_exam_statistics", { examId: "examA" }],
    ["admin_find_duplicate_questions", { examId: "examA" }], ["admin_get_question_bank_statistics", {}],
    ["admin_get_recent_content_changes", {}], ["admin_list_tags", {}],
  ]) {
    await callAdminTool(f, name, args);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount);

  const viaUser = await payload(await rpc(f.env, "user", f.alice.token, "tools/call",
    { name: "admin_search_questions", arguments: { examId: "examA" } }));
  assert.equal(viaUser.result.structuredContent.error.code, "not_found");
});

test("implementation (review round 2): admin_list_tags paginates the combined used/registered set correctly, without repeats or exceeding the limit", async (t) => {
  const f = await questionBankFixture(t);
  // "math" is already used (q1, q5) and — implementation — therefore already a
  // real catalog row; add an unused catalog-only tag that sorts after
  // everything used.
  await callAdminTool(f, "admin_create_tag", { name: "zzz-unused" });

  const allTags = [];
  let offset = 0;
  for (let i = 0; i < 20; i++) {
    const page = await callAdminTool(f, "admin_list_tags", { limit: 1, offset });
    assert.ok(page.items.length <= 1, "a page must never exceed the requested limit");
    allTags.push(...page.items);
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  const names = allTags.map((tag) => tag.tag);
  assert.equal(new Set(names).size, names.length, "no tag may be repeated across pages");
  assert.ok(names.includes("math"));
  assert.ok(names.includes("zzz-unused"));

  const mathEntry = allTags.find((tag) => tag.tag === "math");
  assert.equal(mathEntry.questionCount, 2, "a tag used on an early page must keep its real count, not be re-appended with 0");
  assert.equal(mathEntry.registered, true);
  const unusedEntry = allTags.find((tag) => tag.tag === "zzz-unused");
  assert.equal(unusedEntry.questionCount, 0);
  assert.equal(unusedEntry.registered, true);
});
