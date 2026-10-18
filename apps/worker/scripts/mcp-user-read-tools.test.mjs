// User MCP reads over the shared question bank: quiz presentation and
// what learners see of an archived question.
// The harness is mcp-foundation-fixture.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { componentQuestion } from "../../../tests/fixtures/mcp-presentation/question.mjs";
import {
  rpc, payload, questionBankFixture, callAdminTool, callAdminToolExpectingError,
} from "./mcp-foundation-fixture.mjs";

test("quiz presentation crosses both SDK transports with full images, safe columns and no bank writes", async (t) => {
  const f = await questionBankFixture(t), snapshot = componentQuestion();
  f.sqlite.prepare("UPDATE questions SET content_json = ?, explanation = 'EXPLANATION_SENTINEL', correct_answers_json = '[\"KEY_SENTINEL\"]' WHERE id = 'q1'")
    .run(JSON.stringify(snapshot));
  const before = f.sqlite.prepare("SELECT * FROM questions ORDER BY id").all();
  f.queries.length = 0;
  for (const protocol of ["2025-11-25", "2026-07-28"]) {
    const invoke = async args => (await payload(await rpc(f.env, "user", f.alice.token, "tools/call",
      { name: "user_present_question", arguments: args }, { headers: { "MCP-Protocol-Version": protocol } }))).result;
    const result = await invoke({ examId: "examA", id: "q1" });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.data.status, "available");
    assert.equal(result.structuredContent.data.imageMode, "inline");
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.equal(result.content.filter(c => c.type === "image").length, 2);
    assert.equal(result.content.find(c => c.type === "image").data, snapshot.assets[0].data);
    assert.doesNotMatch(JSON.stringify(result), /SENTINEL|correctAnswers|explanation|annotations/);
    const fallback = await invoke({ examId: "examA", id: "q1", imageMode: "text-only" });
    assert.equal(fallback.structuredContent.data.status, "incomplete");
    assert.equal(fallback.content.some(c => c.type === "image"), false);
    assert.equal((await invoke({ examId: "examB", id: "q1" })).structuredContent.error.code, "not_found");
    assert.equal((await invoke({ examId: "examA", id: "q1", imageMode: "unsupported" })).structuredContent.error.code, "invalid_input");
    const legacy = await invoke({ examId: "examB", id: "q5" });
    assert.equal(legacy.structuredContent.data.format, "legacy-markdown");
  }
  const bankQueries = f.queries.filter(q => /\bquestions\b/i.test(q.sql));
  assert.ok(bankQueries.length > 0);
  for (const { sql } of bankQueries) {
    assert.match(sql, /^SELECT id, exam_id, revision, type, stem, options_json, content_json/);
    assert.doesNotMatch(sql, /correct_answers|explanation|annotations|baseline/i);
  }
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM questions ORDER BY id").all(), before);
  assert.equal(f.metrics.some(metric => metric.blobs?.includes("user_present_question")), true);
});

test("issues #92/#93: a duplicate found by admin_find_duplicate_questions is archived reversibly and leaves every learner flow", async (t) => {
  const f = await questionBankFixture(t);
  const callUser = async (name, args) => (await payload(await rpc(f.env, "user", f.alice.token, "tools/call", { name, arguments: args }))).result;

  const [group] = (await callAdminTool(f, "admin_find_duplicate_questions", { examId: "examA" })).items;
  assert.deepEqual(group.questions.map((question) => question.id).sort(), ["q1", "q2"]);
  const contentBefore = { ...f.sqlite.prepare("SELECT revision, updated_at, stem FROM questions WHERE id = 'q2'").get() };

  const archived = await callAdminTool(f, "admin_archive_question", { examId: "examA", id: "q2" });
  assert.equal(archived.archived, true);
  assert.equal(archived.changed, true);
  assert.ok(archived.archivedAt);
  assert.deepEqual([archived.question.id, archived.question.revision, archived.question.archivedAt], ["q2", 1, archived.archivedAt]);
  assert.deepEqual({ ...f.sqlite.prepare("SELECT revision, updated_at, stem FROM questions WHERE id = 'q2'").get() }, contentBefore,
    "archiving is lifecycle state, not a content edit");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount, "nothing is deleted");
  assert.ok(f.kvInvalidations.includes("practice-questions:v3:examA"));

  // The duplicate group is resolved, so the review loop terminates.
  assert.equal((await callAdminTool(f, "admin_find_duplicate_questions", { examId: "examA" })).items.length, 0);
  // Retrying is safe and keeps the first archive time.
  const again = await callAdminTool(f, "admin_archive_question", { examId: "examA", id: "q2" });
  assert.deepEqual([again.archived, again.changed, again.archivedAt], [true, false, archived.archivedAt]);

  // Admins keep full access, with the state visible.
  assert.equal((await callAdminTool(f, "admin_get_question", { examId: "examA", id: "q2" })).question.archivedAt, archived.archivedAt);
  assert.deepEqual((await callAdminTool(f, "admin_search_questions", { examId: "examA", archived: true })).questions.map((q) => q.id), ["q2"]);
  assert.equal((await callAdminTool(f, "admin_search_questions", { examId: "examA", archived: false })).total, 3);
  assert.equal((await callAdminTool(f, "admin_search_questions", { examId: "examA" })).total, 4);
  const stats = await callAdminTool(f, "admin_get_exam_statistics", { examId: "examA" });
  assert.deepEqual([stats.exam.questionCount, stats.statistics.scannedCount, stats.archivedQuestionCount], [3, 3, 1]);

  // Learners no longer find, get recommended, or start practice on it...
  assert.deepEqual((await callUser("user_search_questions", { examId: "examA", q: "2+2" })).structuredContent.data.questions.map((q) => q.id), ["q1"]);
  const candidates = (await callUser("user_get_practice_candidates", { examId: "examA", limit: 100 })).structuredContent.data.questions;
  assert.deepEqual(candidates.map((q) => q.id).sort(), ["q1", "q3", "q4"]);
  assert.equal((await callUser("user_get_exam", { id: "examA" })).structuredContent.data.exam.questionCount, 3);
  const refused = await callUser("user_start_practice", { examId: "examA", questionIds: ["q1", "q2"] });
  assert.equal(refused.isError, true);
  assert.deepEqual([refused.structuredContent.error.code, refused.structuredContent.error.reason], ["invalid_input", "questions_archived"]);
  // ...but history that already names it still resolves by id.
  assert.equal((await callUser("user_get_question", { examId: "examA", id: "q2" })).structuredContent.data.question.archivedAt, archived.archivedAt);

  const restored = await callAdminTool(f, "admin_unarchive_question", { examId: "examA", id: "q2" });
  assert.deepEqual([restored.archived, restored.changed, restored.archivedAt], [false, true, null]);
  assert.equal((await callAdminTool(f, "admin_unarchive_question", { examId: "examA", id: "q2" })).changed, false);
  assert.equal((await callAdminTool(f, "admin_find_duplicate_questions", { examId: "examA" })).items.length, 1);
  assert.equal((await callUser("user_start_practice", { examId: "examA", questionIds: ["q2"] })).isError, undefined);

  for (const name of ["admin_archive_question", "admin_unarchive_question"]) {
    assert.equal((await callAdminToolExpectingError(f, name, { examId: "examA", id: "missing" })).code, "not_found");
    assert.equal((await callAdminToolExpectingError(f, name, { examId: "examB", id: "q1" })).code, "not_found", "scoped to examId");
    const asUser = await callUser(name, { examId: "examA", id: "q1" });
    assert.equal(asUser.structuredContent.error.code, "not_found", `${name} must not exist on the User MCP catalog`);
  }
  assert.equal(f.sqlite.prepare("SELECT archived_at FROM questions WHERE id = 'q1'").get().archived_at, null);

  const audit = f.sqlite.prepare("SELECT tool, action, outcome, target_ids_json, detail_json FROM admin_mcp_audit_log ORDER BY rowid").all()
    .map((row) => [row.tool, row.action, row.outcome, JSON.parse(row.target_ids_json), JSON.parse(row.detail_json)]);
  assert.deepEqual(audit, [
    ["admin_archive_question", "archive", "success", ["q2"], { changed: true }],
    ["admin_archive_question", "archive", "success", ["q2"], { changed: false }],
    ["admin_unarchive_question", "unarchive", "success", ["q2"], { changed: true }],
    ["admin_unarchive_question", "unarchive", "success", ["q2"], { changed: false }],
  ]);
});
