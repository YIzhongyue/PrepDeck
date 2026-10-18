// Admin MCP mutations: question create/update/delete and batches, their
// proposals, revisions, audit and quota, exam lifecycle, tags and component
// questions.
// The harness is mcp-foundation-fixture.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  fixture, rpc, payload, seedQuestionTags, getQuestionTags, questionBankFixture, callAdminTool,
  callAdminToolExpectingError, lastMetric,
} from "./mcp-foundation-fixture.mjs";

test("implementation: admin_validate_question_payload previews create and edit without mutating, and only issues a proposalToken when valid", async (t) => {
  const f = await questionBankFixture(t);

  const newQuestion = { type: "single_choice", stem: "New question?",
    options: [{ id: "a", text: "Yes" }, { id: "b", text: "No" }], correctAnswers: ["a"], difficulty: "easy", tags: ["new"] };
  const createPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: newQuestion });
  assert.equal(createPreview.valid, true);
  assert.deepEqual(createPreview.issues, []);
  assert.equal(createPreview.currentRevision, undefined);
  assert.ok(createPreview.proposalToken);

  const invalidPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", payload: { type: "single_choice", correctAnswers: ["a"] } });
  assert.equal(invalidPreview.valid, false);
  assert.ok(invalidPreview.issues.length > 0);
  assert.equal(invalidPreview.proposalToken, undefined);

  const editPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { tags: ["math", "algebra"] } });
  assert.equal(editPreview.valid, true);
  assert.equal(editPreview.currentRevision, 1);
  assert.equal(editPreview.answerRevised, false);
  // implementation: payloadOf() sorts tags so comparisons are order-independent
  // — "incoming" reflects that canonical (sorted) order, not input order.
  assert.deepEqual(editPreview.diff, [{ field: "tags", current: ["math"], incoming: ["algebra", "math"] }]);
  assert.ok(editPreview.proposalToken);

  assert.equal((await callAdminToolExpectingError(f, "admin_validate_question_payload",
    { examId: "examA", id: "missing", payload: {} })).code, "not_found");
  assert.equal((await callAdminToolExpectingError(f, "admin_validate_question_payload",
    { examId: "missing", payload: newQuestion })).code, "not_found");

  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_audit_log").get().c, 0);
});

test("implementation: admin_create_question commits only the exact payload reviewed via admin_validate_question_payload, and a retry with the same proposalId replays instead of duplicating", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "single_choice", stem: "New Q?",
    options: [{ id: "a", text: "Yes" }, { id: "b", text: "No" }], correctAnswers: ["a"], difficulty: "easy", tags: ["new"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  assert.ok(preview.proposalId);

  // Editing the payload after preview invalidates the token; the commit is rejected, not silently applied.
  const tampered = { ...fields, stem: "Tampered?" };
  const mismatch = await callAdminToolExpectingError(f, "admin_create_question",
    { examId: "examA", payload: tampered, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  assert.equal(mismatch.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount);

  const created = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  assert.equal(created.question.stem, "New Q?");
  assert.equal(created.question.revision, 1);
  assert.equal(created.idempotentReplay, undefined);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount + 1);
  assert.ok(f.kvInvalidations.includes("practice-questions:examA"));

  // A retry carrying the same proposalId (lost response, at-least-once
  // delivery) replays the original result instead of inserting a duplicate —
  // proposalToken alone can't serve this role since it's a deterministic
  // content hash, and two intentionally identical payloads must both be
  // allowed to create separate questions.
  const replay = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(lastMetric(f, "tool").outcome, "replayed");
  assert.equal(lastMetric(f, "tool").created, 0);
  assert.equal(replay.question.id, created.question.id);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount + 1);

  const audit = f.sqlite.prepare(
    "SELECT * FROM admin_mcp_audit_log WHERE tool = 'admin_create_question' ORDER BY rowid",
  ).all();
  assert.equal(audit.length, 2, "the rejected mismatch and the successful create are audited; the idempotent replay is not a new mutation");
  assert.deepEqual(audit.map((row) => row.outcome), ["failure", "success"]);
  assert.equal(audit[1].admin_user_id, "admin");
  assert.equal(audit[1].exam_id, "examA");
  assert.deepEqual(JSON.parse(audit[1].target_ids_json), [created.question.id]);
  // implementation — the audit row is a persisted logging surface: it must never
  // carry the question's actual content (stem/options/correctAnswers), only
  // which fields were set.
  const successDetail = JSON.parse(audit[1].detail_json);
  assert.deepEqual(Object.keys(successDetail), ["fields"]);
  assert.ok(successDetail.fields.includes("stem"));
  assert.equal(JSON.stringify(successDetail).includes("New Q?"), false);
});

test("implementation: admin_create_question rejects a duplicate externalId within the same exam", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { externalId: "EXT1", type: "single_choice", stem: "Q?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview1 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview1.proposalToken, proposalId: preview1.proposalId });

  const fields2 = { ...fields, stem: "Q2?" };
  const preview2 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields2 });
  const conflict = await callAdminToolExpectingError(f, "admin_create_question",
    { examId: "examA", payload: fields2, proposalToken: preview2.proposalToken, proposalId: preview2.proposalId });
  assert.equal(conflict.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'EXT1'").get().c, 1);
});

test("implementation (review): a KV cache-invalidation failure never suppresses a mutation's audit record", async (t) => {
  const f = await questionBankFixture(t);
  f.env.KV.failures.delete = new Error("simulated KV outage");

  const fields = { type: "single_choice", stem: "Resilient Q?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  const created = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  assert.ok(created.question.id);
  const createAudit = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_create_question' AND target_ids_json = ?",
  ).get(JSON.stringify([created.question.id]));
  assert.equal(createAudit.outcome, "success");

  const tagPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { tags: ["kv-outage"] } });
  const updated = await callAdminTool(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 1, payload: { tags: ["kv-outage"] }, proposalToken: tagPreview.proposalToken,
  });
  assert.deepEqual(updated.question.tags, ["kv-outage"]);
  const updateAudit = f.sqlite.prepare(
    "SELECT outcome, detail_json FROM admin_mcp_audit_log WHERE tool = 'admin_update_question' AND target_ids_json = ?",
  ).get(JSON.stringify(["q1"]));
  assert.equal(updateAudit.outcome, "success");
  // implementation — changed field names only, never the before/after tag values.
  assert.deepEqual(JSON.parse(updateAudit.detail_json), { fields: ["tags"] });
});

test("implementation: admin_update_question enforces optimistic concurrency and implementation's answer-revision preservation", async (t) => {
  const f = await questionBankFixture(t);

  // A tag-only edit does not revise the answer key.
  const tagPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { tags: ["math", "algebra"] } });
  assert.equal(tagPreview.answerRevised, false);
  const tagged = await callAdminTool(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 1, payload: { tags: ["math", "algebra"] }, proposalToken: tagPreview.proposalToken,
  });
  // implementation: tags read back sorted, independent of write-time order.
  assert.deepEqual(tagged.question.tags, ["algebra", "math"]);
  assert.equal(tagged.question.revision, 2);
  assert.equal(tagged.question.answerRevision, 1);
  assert.equal(tagged.question.answerRevisedAt, null);
  assert.ok(f.kvInvalidations.includes("practice-questions:examA"));

  // Retrying with the same (now-stale) expectedRevision/proposalToken is rejected, never silently reapplied.
  const staleRetry = await callAdminToolExpectingError(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 1, payload: { tags: ["math", "algebra"] }, proposalToken: tagPreview.proposalToken,
  });
  assert.equal(staleRetry.code, "conflict");

  // An answer-key change bumps answer_revision/answer_revised_at independently of the generic revision.
  const answerPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { correctAnswers: ["a"] } });
  assert.equal(answerPreview.answerRevised, true);
  const revised = await callAdminTool(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 2, payload: { correctAnswers: ["a"] }, proposalToken: answerPreview.proposalToken,
  });
  assert.equal(revised.question.revision, 3);
  assert.equal(revised.question.answerRevision, 2);
  assert.ok(revised.question.answerRevisedAt);

  // A payload changed after preview (without a refreshed preview) is rejected.
  const freshPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { explanation: "Updated." } });
  const tamperedMismatch = await callAdminToolExpectingError(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 3, payload: { explanation: "Something else." }, proposalToken: freshPreview.proposalToken,
  });
  assert.equal(tamperedMismatch.code, "conflict");

  assert.equal((await callAdminToolExpectingError(f, "admin_update_question", {
    examId: "examA", id: "missing", expectedRevision: 1, payload: {}, proposalToken: "0".repeat(64),
  })).code, "not_found");
});

test("implementation: admin_delete_question requires expectedRevision and is blocked by a dependent attempt, without cascading", async (t) => {
  const f = await questionBankFixture(t);

  const wrongRevision = await callAdminToolExpectingError(f, "admin_delete_question", { examId: "examB", id: "q5", expectedRevision: 2 });
  assert.equal(wrongRevision.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE id = 'q5'").get().c, 1);

  const deleted = await callAdminTool(f, "admin_delete_question", { examId: "examB", id: "q5", expectedRevision: 1 });
  assert.equal(deleted.deleted, true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE id = 'q5'").get().c, 0);
  assert.ok(f.kvInvalidations.includes("practice-questions:examB"));

  f.sqlite.prepare("UPDATE attempts SET question_ids_json = ? WHERE id = 'attempt2'").run(JSON.stringify(["q4"]));
  const blocked = await callAdminToolExpectingError(f, "admin_delete_question", { examId: "examA", id: "q4", expectedRevision: 1 });
  assert.equal(blocked.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE id = 'q4'").get().c, 1);

  const outcomes = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_delete_question' ORDER BY rowid",
  ).all().map((row) => row.outcome);
  assert.deepEqual(outcomes, ["failure", "success", "failure"]);
});

test("implementation: admin_batch_create_questions returns per-item outcomes correlated to input order via inputIndex, and never applies an invalid or stale item", async (t) => {
  const f = await questionBankFixture(t);
  const good1 = { type: "single_choice", stem: "Batch Q1?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const good2 = { type: "single_choice", stem: "Batch Q2?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["b"] };
  const bad = { type: "single_choice", correctAnswers: ["a"] }; // missing stem/options

  const preview1 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: good1 });
  const preview2 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: good2 });
  const tamperedGood2 = { ...good2, stem: "Changed after preview" };

  // Neither good1 nor tamperedGood2 sets externalId, matching a case a
  // review of this PR flagged: a "created" and a "skipped" outcome both with
  // externalId: null were otherwise indistinguishable — inputIndex fixes that.
  const result = await callAdminTool(f, "admin_batch_create_questions", {
    examId: "examA",
    items: [
      { payload: good1, proposalToken: preview1.proposalToken, proposalId: preview1.proposalId },
      { payload: tamperedGood2, proposalToken: preview2.proposalToken, proposalId: preview2.proposalId },
      { payload: bad, proposalToken: "0".repeat(64), proposalId: crypto.randomUUID() },
    ],
  });
  assert.equal(result.created, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.failed, 0);
  // Outcomes are restored to input order and tagged with inputIndex, so
  // every one maps unambiguously back to the item that produced it.
  assert.deepEqual(result.outcomes.map((o) => o.inputIndex), [0, 1, 2]);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["created", "skipped", "skipped"]);
  assert.equal(result.outcomes[1].reason, "stale_proposal");
  assert.equal(result.outcomes[2].reason, "invalid");
  assert.equal(result.outcomes[0].payload.stem, "Batch Q1?");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem LIKE 'Batch%' OR stem LIKE 'Changed%'").get().c, 1);

  // Each item gets its own audit row (not one summary row for the call), so
  // an unrelated rollback elsewhere can't erase another item's audit trail.
  // Resolved-before-touching-the-database items (both skips here) are
  // audited first, in their own batch; the created item's audit — committed
  // atomically with its insert — comes after.
  const auditRows = f.sqlite.prepare(
    "SELECT outcome, detail_json FROM admin_mcp_audit_log WHERE tool = 'admin_batch_create_questions' ORDER BY rowid",
  ).all();
  assert.equal(auditRows.length, 3);
  assert.deepEqual(auditRows.map((row) => row.outcome), ["failure", "failure", "success"]);
  // implementation — the audit row persists which fields were set, never the
  // question content itself (stem/options/explanation/answer key).
  const createdDetail = JSON.parse(auditRows[2].detail_json);
  assert.equal(createdDetail.payload, undefined);
  assert.ok(createdDetail.fields.includes("stem"));
});

test("implementation: admin_batch_create_questions replays an item retried with the same proposalId instead of duplicating it", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "single_choice", stem: "Idempotent batch Q?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  const item = { payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId };

  const first = await callAdminTool(f, "admin_batch_create_questions", { examId: "examA", items: [item] });
  assert.equal(first.created, 1);
  const questionId = first.outcomes[0].questionId;

  const retry = await callAdminTool(f, "admin_batch_create_questions", { examId: "examA", items: [item] });
  assert.equal(retry.created, 1);
  assert.equal(retry.outcomes[0].questionId, questionId);
  assert.equal(retry.outcomes[0].reason, "idempotent_replay");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Idempotent batch Q?'").get().c, 1);
});

test("implementation: admin_batch_update_questions commits exactly the submitted, pre-tokened targets, correlated to input order via inputIndex, with per-item diffs audited", async (t) => {
  const f = await questionBankFixture(t);
  const q1Preview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { tags: ["math", "reviewed"] } });

  const result = await callAdminTool(f, "admin_batch_update_questions", {
    examId: "examA",
    items: [
      { id: "q1", expectedRevision: 1, proposalToken: q1Preview.proposalToken, payload: { tags: ["math", "reviewed"] } },
      { id: "q2", expectedRevision: 99, proposalToken: "0".repeat(64), payload: { tags: ["reviewed"] } },
    ],
  });
  assert.equal(result.updated, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.outcomes.map((o) => o.inputIndex), [0, 1]);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["updated", "skipped"]);
  assert.equal(result.outcomes[1].reason, "stale_proposal");
  assert.deepEqual(result.outcomes[0].diff, [{ field: "tags", current: ["math"], incoming: ["math", "reviewed"] }]);

  const q1Row = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q1'").get();
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["math", "reviewed"]);
  assert.equal(q1Row.revision, 2);
  assert.deepEqual(getQuestionTags(f.sqlite, "q2"), []);

  // Same per-item audit shape as batch create: the skipped item (resolved
  // before touching the database) is audited first; the updated item's
  // audit — committed atomically with the update via changes() — comes after.
  const auditRows = f.sqlite.prepare(
    "SELECT outcome, detail_json FROM admin_mcp_audit_log WHERE tool = 'admin_batch_update_questions' ORDER BY rowid",
  ).all();
  assert.equal(auditRows.length, 2);
  assert.deepEqual(auditRows.map((row) => row.outcome), ["failure", "success"]);
  // implementation — the audit row persists changed field names only, never the
  // before/after question content diffPayload() returns to the caller.
  const updatedDetail = JSON.parse(auditRows[1].detail_json);
  assert.equal(updatedDetail.diff, undefined);
  assert.deepEqual(updatedDetail.fields, ["tags"]);
});

test("implementation: a genuine DB-level stale-revision race in admin_batch_update_questions never applies its tag-link change either", async (t) => {
  const f = await questionBankFixture(t);
  // Pre-register the tag so buildTagNameResolver's bulk resolve has nothing
  // new to INSERT — otherwise ITS db.batch() call would be the one
  // intercepted below, racing the revision before validation even runs.
  await callAdminTool(f, "admin_create_tag", { name: "raced-tag" });
  const preview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { tags: ["raced-tag"] } });

  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let intercepted = false;
  f.env.DB.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      // Simulate another admin editing q1 between this call's own SELECT
      // (already read, expectedRevision baked into `preview`) and its
      // update statement committing — the update's WHERE clause on the
      // OLD revision will match zero rows.
      f.sqlite.prepare("UPDATE questions SET revision = revision + 1 WHERE id = 'q1'").run();
    }
    return originalBatch(statements);
  };

  const result = await callAdminTool(f, "admin_batch_update_questions", {
    examId: "examA",
    items: [{ id: "q1", expectedRevision: 1, proposalToken: preview.proposalToken, payload: { tags: ["raced-tag"] } }],
  });
  assert.equal(result.updated, 0);
  assert.equal(result.outcomes[0].status, "skipped");
  assert.equal(result.outcomes[0].reason, "stale_question; refresh preview");
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["math"],
    "the rejected update's tag-link sync must never have run — see buildTagLinkStatements' revision guard");
});

test("implementation: a duplicate externalId inside one batch rolls back the whole call, matching D1's atomic batch semantics", async (t) => {
  const f = await questionBankFixture(t);
  const item = (stem) => ({ type: "single_choice", externalId: "DUP1", stem,
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] });
  const p1 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: item("First") });
  const p2 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: item("Second") });

  const result = await callAdminTool(f, "admin_batch_create_questions", {
    examId: "examA",
    items: [
      { payload: item("First"), proposalToken: p1.proposalToken, proposalId: p1.proposalId },
      { payload: item("Second"), proposalToken: p2.proposalToken, proposalId: p2.proposalId },
    ],
  });
  assert.equal(result.created, 0);
  assert.equal(result.failed, 2);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["failed", "failed"]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'DUP1'").get().c, 0);
});

test("implementation (review): admin_create_question rejects a proposalId reused with a different request instead of replaying or recreating it", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "single_choice", stem: "Original Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });

  // A different, otherwise-valid request reusing the same proposalId must be
  // rejected as a conflict — never silently return the unrelated original
  // question, and never silently create the new one either.
  const otherFields = { type: "single_choice", stem: "Different Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["b"] };
  const otherPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: otherFields });
  const reused = await callAdminToolExpectingError(f, "admin_create_question",
    { examId: "examA", payload: otherFields, proposalToken: otherPreview.proposalToken, proposalId: preview.proposalId });
  assert.equal(reused.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Different Q?'").get().c, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount + 1);
});

test("implementation (review): admin_batch_create_questions reports a proposalId reused with a different request as a skipped item, not a successful replay", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "single_choice", stem: "Original Batch Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  const first = await callAdminTool(f, "admin_batch_create_questions",
    { examId: "examA", items: [{ payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId }] });
  assert.equal(first.created, 1);

  const otherFields = { type: "single_choice", stem: "Different Batch Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["b"] };
  const otherPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: otherFields });
  const second = await callAdminTool(f, "admin_batch_create_questions",
    { examId: "examA", items: [{ payload: otherFields, proposalToken: otherPreview.proposalToken, proposalId: preview.proposalId }] });
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 1);
  assert.equal(second.outcomes[0].reason, "proposal_id_reused_with_different_request");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Different Batch Q?'").get().c, 0);
});

test("implementation (review): a replay after the created question is deleted does not recreate it, but a fresh preview still allows intentional recreation", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "single_choice", stem: "Deletable Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  const created = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  await callAdminTool(f, "admin_delete_question", { examId: "examA", id: created.question.id, expectedRevision: 1 });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Deletable Q?'").get().c, 0);

  const replay = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(lastMetric(f, "tool").outcome, "replayed");
  assert.equal(lastMetric(f, "tool").created, 0);
  assert.equal(replay.deletedSinceCreation, true);
  assert.equal(replay.question, null);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Deletable Q?'").get().c, 0);

  const batchReplay = await callAdminTool(f, "admin_batch_create_questions", {
    examId: "examA", items: [{ payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId }],
  });
  assert.equal(batchReplay.created, 0);
  assert.equal(batchReplay.skipped, 1);
  assert.equal(batchReplay.outcomes[0].reason, "idempotent_replay_deleted_since");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Deletable Q?'").get().c, 0);

  // A fresh preview (a new proposalId) still allows intentionally recreating
  // the same content — deletion isn't permanently "poisoned."
  const freshPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  const recreated = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: freshPreview.proposalToken, proposalId: freshPreview.proposalId });
  assert.equal(recreated.idempotentReplay, undefined);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Deletable Q?'").get().c, 1);
});

test("implementation (review): an audit-insert failure rolls back its paired mutation atomically, for update, delete, and both batch tools", async (t) => {
  const f = await questionBankFixture(t);
  const boom = () => f.sqlite.exec(
    "CREATE TRIGGER audit_boom BEFORE INSERT ON admin_mcp_audit_log BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END;",
  );
  const disarm = () => f.sqlite.exec("DROP TRIGGER audit_boom");

  // Single update: if its paired audit row can't commit, the update itself
  // must not commit either — not just "KV didn't get invalidated."
  const tagPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", id: "q1", payload: { tags: ["boom"] } });
  boom();
  await assert.rejects(() => callAdminTool(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 1, payload: { tags: ["boom"] }, proposalToken: tagPreview.proposalToken,
  }));
  const q1AfterUpdateAttempt = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q1'").get();
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["math"]);
  assert.equal(q1AfterUpdateAttempt.revision, 1);
  disarm();

  // Single delete: same requirement.
  boom();
  await assert.rejects(() => callAdminTool(f, "admin_delete_question", { examId: "examB", id: "q5", expectedRevision: 1 }));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE id = 'q5'").get().c, 1);
  disarm();

  // Batch create: the queued item's insert must not survive if its paired
  // audit row can't.
  const fields = { type: "single_choice", stem: "Boom batch create?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const createPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  boom();
  await assert.rejects(() => callAdminTool(f, "admin_batch_create_questions", {
    examId: "examA", items: [{ payload: fields, proposalToken: createPreview.proposalToken, proposalId: createPreview.proposalId }],
  }));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Boom batch create?'").get().c, 0);
  disarm();

  // Batch update: same requirement.
  const q4Preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", id: "q4", payload: { tags: ["boom-batch"] } });
  boom();
  await assert.rejects(() => callAdminTool(f, "admin_batch_update_questions", {
    examId: "examA", items: [{ id: "q4", expectedRevision: 1, proposalToken: q4Preview.proposalToken, payload: { tags: ["boom-batch"] } }],
  }));
  const q4Row = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q4'").get();
  assert.deepEqual(getQuestionTags(f.sqlite, "q4"), ["fill"]);
  assert.equal(q4Row.revision, 1);
  disarm();
});

test("implementation: Admin MCP content mutations consume a separate, stricter quota than reads and the blanket account quota", async (t) => {
  const f = await questionBankFixture(t);

  // A normal read consumes only the blanket account quota, never the
  // mutation-specific one.
  await callAdminTool(f, "admin_list_exams", {});
  assert.ok(f.limits.some(({ key, max }) => key === "mcp:admin:user:admin" && max === 30));
  assert.ok(!f.limits.some(({ key }) => key === "mcp:admin:admin:mutation"));

  const preview = await callAdminTool(f, "admin_validate_question_payload", {
    examId: "examA",
    payload: { type: "single_choice", stem: "Quota'd?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] },
  });

  // A create consumes the mutation-specific quota, using its own configured
  // max — distinct from (and stricter than) the blanket account quota.
  await callAdminTool(f, "admin_create_question", {
    examId: "examA", payload: preview.payload, proposalToken: preview.proposalToken, proposalId: preview.proposalId,
  });
  assert.ok(f.limits.some(({ key, max }) => key === "mcp:admin:admin:mutation" && max === 10));

  // Now exhaust only the mutation-specific quota — reads and the blanket
  // quota remain unaffected, proving the two gates are independent.
  f.env.RATE_LIMITER.respond = ({ key }) => key === "mcp:admin:admin:mutation" ? { allowed: false, retryAfter: 5 } : undefined;

  await callAdminTool(f, "admin_list_exams", {}); // reads still succeed

  const beforeQuestions = f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c;
  const beforeAudit = f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_audit_log").get().c;
  const blocked = await callAdminToolExpectingError(f, "admin_update_exam", { id: "examA", name: "Renamed while quota'd" });
  assert.equal(blocked.code, "rate_limited");
  // implementation — the operation-level limiter's own retryAfter must reach the
  // caller, not be discarded in favor of a bare "rate_limited" with no guidance.
  assert.equal(blocked.retryAfter, 5);
  // A rejected mutation leaves no trace: no data change, no audit row —
  // the quota gate runs before any write is attempted.
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, beforeQuestions);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_audit_log").get().c, beforeAudit);
  assert.equal(f.sqlite.prepare("SELECT name FROM exams WHERE id = 'examA'").get().name, "Exam A");

  // implementation — the mutation-key limiter itself being unreachable (as
  // opposed to denying the request) must surface as "unavailable", not the
  // generic "internal" an unrelated application bug would produce, and must
  // still block the write — even though the account/IP gates ahead of it
  // are healthy.
  f.env.RATE_LIMITER.respond = ({ key }) => {
    if (key === "mcp:admin:admin:mutation") throw new Error("simulated mutation-limiter outage");
  };
  const unavailable = await callAdminToolExpectingError(f, "admin_update_exam", { id: "examA", name: "Renamed during outage" });
  assert.equal(unavailable.code, "unavailable");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, beforeQuestions);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_audit_log").get().c, beforeAudit);
  assert.equal(f.sqlite.prepare("SELECT name FROM exams WHERE id = 'examA'").get().name, "Exam A");
});

test("implementation: admin_create_exam/admin_update_exam/admin_archive_exam use safe lifecycle semantics", async (t) => {
  const f = await fixture(t);
  const created = await callAdminTool(f, "admin_create_exam", { slug: "new-exam", name: "New Exam" });
  assert.equal(created.exam.slug, "new-exam");
  assert.equal(created.exam.archivedAt, null);

  const dup = await callAdminToolExpectingError(f, "admin_create_exam", { slug: "new-exam", name: "Dup" });
  assert.equal(dup.code, "conflict");

  const updated = await callAdminTool(f, "admin_update_exam", { id: created.exam.id, name: "Renamed Exam" });
  assert.equal(updated.exam.name, "Renamed Exam");

  const noFields = await callAdminToolExpectingError(f, "admin_update_exam", { id: created.exam.id });
  assert.equal(noFields.code, "invalid_input");

  const archived = await callAdminTool(f, "admin_archive_exam", { id: created.exam.id });
  assert.ok(archived.archivedAt);

  const alreadyArchived = await callAdminToolExpectingError(f, "admin_archive_exam", { id: created.exam.id });
  assert.equal(alreadyArchived.code, "conflict");

  const notFound = await callAdminToolExpectingError(f, "admin_archive_exam", { id: "missing-exam" });
  assert.equal(notFound.code, "not_found");

  const audit = f.sqlite.prepare("SELECT action, outcome FROM admin_mcp_audit_log ORDER BY rowid").all();
  assert.deepEqual(audit.map((r) => `${r.action}:${r.outcome}`), [
    "exam_create:success", "exam_create:failure", "exam_update:success",
    "exam_archive:success", "exam_archive:failure", "exam_archive:failure",
  ]);
});

test("implementation: admin_create_tag registers a zero-reference catalog entry that admin_list_tags surfaces", async (t) => {
  const f = await questionBankFixture(t);
  const created = await callAdminTool(f, "admin_create_tag", { name: "unused-tag" });
  assert.ok(created.id);
  const dup = await callAdminToolExpectingError(f, "admin_create_tag", { name: "Unused-Tag" });
  assert.equal(dup.code, "conflict");

  const listed = await callAdminTool(f, "admin_list_tags", {});
  const entry = listed.items.find((tag) => tag.tag === "unused-tag");
  assert.ok(entry, "a catalog tag with zero questions must still be listed");
  assert.equal(entry.questionCount, 0);
  assert.equal(entry.registered, true);
});

test("implementation: admin_update_tag renames a tag's catalog identity, case-insensitively, without rewriting any question", async (t) => {
  const f = await questionBankFixture(t);
  const before = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q3'").get().revision;
  const renamed = await callAdminTool(f, "admin_update_tag", { name: "SCIENCE", newName: "natural-science" });
  assert.equal(renamed.affectedQuestionCount, 1);
  assert.deepEqual(getQuestionTags(f.sqlite, "q3"), ["natural-science"]);
  const after = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q3'").get().revision;
  assert.equal(after, before, "a pure catalog rename must not bump the question's content revision");
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags WHERE normalized_name = 'science'").get().c, 0,
    "the old identity is renamed in place, not left behind as a second row",
  );
  // No question row changed, but the renamed display name is embedded in
  // examA's cached practice catalog — that still needs invalidating.
  assert.ok(f.kvInvalidations.includes("practice-questions:examA"));
});

test("implementation: admin_merge_tags reassigns every source tag's association on a question carrying more than one of them, without dropping any, and never rewrites a question", async (t) => {
  const f = await questionBankFixture(t);
  // q1 seeds with tags ["math"]; give it a second tag also being merged, so
  // one question is affected by two source names at once — this is exactly
  // the scenario implementation's original per-row rewrite bug dropped a tag on.
  seedQuestionTags(f.sqlite, "q1", ["algebra"]);
  const before = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q1'").get().revision;

  const merged = await callAdminTool(f, "admin_merge_tags", { names: ["math", "algebra"], targetName: "mathematics" });
  assert.equal(merged.affectedQuestionCount, 2, "q1 (math+algebra) and q5 (math) both carry a merged-away name");

  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["mathematics"],
    "both merged-away tags on the same question collapse into exactly one association with the target, not a dropped tag");
  assert.equal(f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q1'").get().revision, before,
    "a merge is a pure catalog + association change — it must not bump any question's content revision");

  assert.deepEqual(getQuestionTags(f.sqlite, "q5"), ["examB", "mathematics"]);

  // implementation: unlike implementation's original lazy-registration model, every other
  // tag actually used by a question (science/fill/examB, from the base
  // fixture) is already its own real catalog row too — merging math+algebra
  // only removes THOSE two source identities, not the unrelated ones.
  const catalogNames = f.sqlite.prepare("SELECT name FROM question_bank_tags ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(catalogNames, ["examB", "fill", "mathematics", "science"], "both source catalog identities are gone, only the target remains besides the unrelated tags");
  assert.ok(f.kvInvalidations.includes("practice-questions:examA"));
  assert.ok(f.kvInvalidations.includes("practice-questions:examB"));
});

test("implementation: renaming a tag used by more than 500 questions succeeds without rewriting any of them", async (t) => {
  const f = await questionBankFixture(t);
  const now = new Date().toISOString();
  const insertQuestion = f.sqlite.prepare(`INSERT INTO questions
    (id, exam_id, external_id, sequence_number, type, stem, options_json, correct_answers_json,
     explanation, difficulty, points, created_at, updated_at)
    VALUES (?, 'examA', NULL, ?, 'fill_blank', ?, NULL, '["x"]', NULL, 'easy', 1, ?, ?)`);
  const ids = [];
  for (let i = 0; i < 501; i++) {
    const id = `bulk-${i}`;
    ids.push(id);
    insertQuestion.run(id, 100 + i, `Bulk question ${i}`, now, now);
    seedQuestionTags(f.sqlite, id, ["bulk-tag"]);
  }
  const renamed = await callAdminTool(f, "admin_update_tag", { name: "bulk-tag", newName: "renamed-bulk-tag" });
  assert.equal(renamed.affectedQuestionCount, 501);
  assert.deepEqual(getQuestionTags(f.sqlite, ids[500]), ["renamed-bulk-tag"]);
  for (const id of ids) {
    assert.equal(f.sqlite.prepare("SELECT revision FROM questions WHERE id = ?").get(id).revision, 1);
  }
});

// --- implementation review round 2 — catalog rename identity and admin_list_tags
// pagination; implementation replaces the per-row rewrite-conflict tests above
// with catalog-level concurrency tests (there is no more per-row rewrite to
// race with — see lib/questionBankTags.ts). --------------------------------

test("implementation: a concurrent rename of the same tag between read and write is reported as a conflict, never silently lost", async (t) => {
  const f = await questionBankFixture(t);
  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let intercepted = false;
  f.env.DB.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      // Simulate another admin renaming "math" concurrently, between this
      // call's findTagCatalogRowByName read (which captured the pre-race
      // revision) and its own compare-and-swap write committing.
      f.sqlite.prepare(
        "UPDATE question_bank_tags SET name = 'algebra-ish', normalized_name = 'algebra-ish', revision = revision + 1 WHERE normalized_name = 'math'",
      ).run();
    }
    return originalBatch(statements);
  };

  const error = await callAdminToolExpectingError(f, "admin_update_tag", { name: "math", newName: "mathematics" });
  assert.equal(error.code, "conflict");

  // The concurrent rename stands; our own rename (bound to the stale
  // revision it read) never applied.
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags WHERE normalized_name = 'mathematics'").get().c, 0);
  assert.ok(f.sqlite.prepare("SELECT 1 FROM question_bank_tags WHERE normalized_name = 'algebra-ish'").get());
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["algebra-ish"]);

  const auditRow = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_update_tag' ORDER BY rowid DESC LIMIT 1",
  ).get();
  assert.equal(auditRow.outcome, "failure");

  // A retry against the tag's now-current name succeeds normally.
  const retry = await callAdminTool(f, "admin_update_tag", { name: "algebra-ish", newName: "mathematics" });
  assert.equal(retry.conflicts.length, 0);
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["mathematics"]);
});

test("implementation (review): a concurrent rename of one SOURCE tag between admin_merge_tags' read and its write aborts the whole merge, not just that source", async (t) => {
  const f = await questionBankFixture(t);
  // Sources: "math" (q1, q5) and "science" (q3). Simulate another admin
  // renaming "science" away right before the merge batch commits — after
  // mergeTags already read its (now-stale) revision.
  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let intercepted = false;
  f.env.DB.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      f.sqlite.prepare(
        "UPDATE question_bank_tags SET name = 'natural-science', normalized_name = 'natural-science', revision = revision + 1 WHERE normalized_name = 'science'",
      ).run();
    }
    return originalBatch(statements);
  };

  const error = await callAdminToolExpectingError(f, "admin_merge_tags", { names: ["math", "science"], targetName: "mathematics" });
  assert.equal(error.code, "conflict");

  // The WHOLE merge must abort — not just skip the drifted source: "math"
  // (which did NOT drift) must still be untouched too, proving this isn't a
  // per-source partial-success but a single atomic all-or-nothing decision.
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags WHERE normalized_name = 'mathematics'").get().c, 0,
    "the target must never be created/touched when any source drifted");
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["math"], "an undrifted source's links must also be untouched");
  assert.deepEqual(getQuestionTags(f.sqlite, "q3"), ["natural-science"], "the concurrently-renamed source's own edit stands, undisturbed");
  assert.ok(f.sqlite.prepare("SELECT 1 FROM question_bank_tags WHERE normalized_name = 'math'").get(), "the undrifted source catalog row must survive too");

  const auditRow = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_merge_tags' ORDER BY rowid DESC LIMIT 1",
  ).get();
  assert.equal(auditRow.outcome, "failure");

  // A retry against the now-current names succeeds normally.
  const retry = await callAdminTool(f, "admin_merge_tags", { names: ["math", "natural-science"], targetName: "mathematics" });
  assert.equal(retry.conflicts.length, 0);
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["mathematics"]);
  assert.deepEqual(getQuestionTags(f.sqlite, "q3"), ["mathematics"]);
});

test("implementation (review): a source tag deleted by a concurrent merge between admin_merge_tags' read and its write also aborts the whole merge", async (t) => {
  const f = await questionBankFixture(t);
  // Sources: "math" (q1, q5) and "science" (q3). Simulate another admin's
  // concurrent merge fully absorbing "science" into some other tag (not
  // just renaming it, but deleting its catalog row outright) right before
  // this merge's batch commits — after mergeTags already read its
  // (now-stale) revision. A deleted source has no row left to match the
  // old `(id = ? AND revision <> ?)` OR-chain (there's nothing to compare
  // a "changed" revision against), so it must still be caught by the
  // "every expected source id still exists at exactly its expected
  // revision" guard (implementation follow-up review) rather than let the merge
  // proceed as if "science" had never drifted.
  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let intercepted = false;
  f.env.DB.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      f.sqlite.prepare("DELETE FROM question_bank_tags WHERE normalized_name = 'science'").run();
    }
    return originalBatch(statements);
  };

  const error = await callAdminToolExpectingError(f, "admin_merge_tags", { names: ["math", "science"], targetName: "mathematics" });
  assert.equal(error.code, "conflict");

  // The WHOLE merge must abort — "math" (which did NOT drift) must still be
  // untouched too, proving the vanished source aborts the entire atomic
  // batch rather than just being skipped.
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags WHERE normalized_name = 'mathematics'").get().c, 0,
    "the target must never be created/touched when a source vanished concurrently");
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["math"], "an undrifted source's links must also be untouched");
  assert.ok(f.sqlite.prepare("SELECT 1 FROM question_bank_tags WHERE normalized_name = 'math'").get(), "the undrifted source catalog row must survive too");

  const auditRow = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_merge_tags' ORDER BY rowid DESC LIMIT 1",
  ).get();
  assert.equal(auditRow.outcome, "failure");
});

test("implementation (review round 2): admin_update_tag preserves the catalog entry's id across a rename, including renaming back", async (t) => {
  const f = await questionBankFixture(t);
  const beforeCount = f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags").get().c;
  const created = await callAdminTool(f, "admin_create_tag", { name: "old-name" });
  const renamed = await callAdminTool(f, "admin_update_tag", { name: "old-name", newName: "new-name" });
  assert.equal(renamed.conflicts.length, 0);
  // Scoped to +1 over whatever the fixture's own questions already
  // registered (implementation: every used tag is a real catalog row now) —
  // the assertion that matters is "rename must not create a SECOND
  // identity for the same tag", not "the catalog is empty otherwise".
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags").get().c, beforeCount + 1);
  const row = f.sqlite.prepare("SELECT id, name FROM question_bank_tags WHERE id = ?").get(created.id);
  assert.equal(row.name, "new-name");

  // Renaming back must not be rejected as a collision with a leftover old row.
  const renamedBack = await callAdminTool(f, "admin_update_tag", { name: "new-name", newName: "old-name" });
  assert.equal(renamedBack.conflicts.length, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags").get().c, beforeCount + 1);
  const rowAfter = f.sqlite.prepare("SELECT id, name FROM question_bank_tags WHERE id = ?").get(created.id);
  assert.equal(rowAfter.name, "old-name");
});

for (const name of ["reading", "code", "case-with-figure"]) test(`single component ${name}: preview derives a committable payload and reuses create idempotency`, async t => {
  const f = await questionBankFixture(t);
  const file = JSON.parse(await readFile(new URL(`../../../tests/fixtures/components/${name}.json`, import.meta.url), "utf8"));
  const question = { ...file.questions[0], needsReview: true };
  const preview = await callAdminTool(f, "admin_preview_component_question", {
    examId: "examA", question, stimuli: file.stimuli, assets: file.assets,
  });
  assert.equal(preview.valid, true, JSON.stringify(preview));
  assert.equal(preview.payload.type, { reading: "single_choice", code: "ordering", "case-with-figure": "matching" }[name]);
  assert.ok(preview.payload.stem);
  assert.deepEqual(preview.payload.content.stimuli, file.stimuli ?? []);
  assert.deepEqual(preview.payload.content.assets, file.assets ?? []);
  assert.equal(preview.payload.needsReview, true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM questions").get().n, f.questionRowCount);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_mcp_audit_log").get().n, 0);
  const args = { examId: "examA", payload: preview.payload, proposalToken: preview.proposalToken, proposalId: preview.proposalId };
  assert.equal((await callAdminToolExpectingError(f, "admin_create_question", { ...args, payload: { ...preview.payload, needsReview: false } })).code, "conflict");
  const created = await callAdminTool(f, "admin_create_question", args);
  assert.equal(created.question.needsReview, true);
  assert.deepEqual(created.question.content.interaction, question.interaction);
  const replay = await callAdminTool(f, "admin_create_question", args);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.question.id, created.question.id);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM questions").get().n, f.questionRowCount + 1);
  assert.ok(f.limits.some(({ key }) => key === "mcp:admin:admin:mutation"));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_mcp_audit_log WHERE tool='admin_create_question' AND outcome='success'").get().n, 1);
});

test("single component edits preserve omitted metadata across JSON and reject stale revisions", async t => {
  const f = await questionBankFixture(t);
  const file = JSON.parse(await readFile(new URL("../../../tests/fixtures/components/code.json", import.meta.url), "utf8"));
  f.sqlite.prepare("UPDATE questions SET needs_review=1 WHERE id='q1'").run();
  const preview = await callAdminTool(f, "admin_preview_component_question", { examId: "examA", id: "q1", question: file.questions[0] });
  assert.equal(preview.valid, true, JSON.stringify(preview));
  assert.equal(preview.currentRevision, 1);
  assert.equal(preview.answerRevised, true);
  assert.equal(preview.payload.needsReview, true);
  assert.equal(preview.payload.explanation, "Because 2+2=4.");
  assert.equal(preview.payload.difficulty, "easy");
  assert.deepEqual(preview.payload.tags, ["math"]);
  const args = { examId: "examA", id: "q1", expectedRevision: preview.currentRevision, payload: preview.payload, proposalToken: preview.proposalToken };
  const updated = await callAdminTool(f, "admin_update_question", args);
  assert.equal(updated.question.type, "ordering");
  assert.equal(updated.question.answerRevision, 2);
  assert.equal(updated.question.needsReview, true);
  assert.equal((await callAdminToolExpectingError(f, "admin_update_question", args)).code, "conflict");
  const reviewed = await callAdminTool(f, "admin_preview_component_question", {
    examId: "examA", id: "q1", question: { ...file.questions[0], needsReview: false },
  });
  assert.equal(reviewed.answerRevised, false);
  const signedOff = await callAdminTool(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: reviewed.currentRevision, payload: reviewed.payload, proposalToken: reviewed.proposalToken,
  });
  assert.equal(signedOff.question.needsReview, false);
  assert.equal(signedOff.question.answerRevision, 2);
  assert.deepEqual(signedOff.question.tags, ["math"]);
});

test("single component preview rejects invalid references, metadata and wrong exam targets without proposals or writes", async t => {
  const f = await questionBankFixture(t);
  const file = JSON.parse(await readFile(new URL("../../../tests/fixtures/components/reading.json", import.meta.url), "utf8"));
  for (const input of [
    { question: file.questions[0] },
    { question: { ...file.questions[0], needsReview: "true" }, stimuli: file.stimuli },
    { question: { ...file.questions[0], scoring: { method: "exact", correctAnswers: ["missing"] } }, stimuli: file.stimuli },
  ]) {
    const result = await callAdminTool(f, "admin_preview_component_question", { examId: "examA", ...input });
    assert.equal(result.valid, false);
    assert.ok(result.issues.length);
    assert.equal(result.proposalToken, undefined);
    assert.equal(result.proposalId, undefined);
  }
  const input = { question: file.questions[0], stimuli: file.stimuli };
  for (const target of [{ examId: "missing" }, { examId: "examB", id: "q1" }]) {
    assert.equal((await callAdminToolExpectingError(f, "admin_preview_component_question", { ...target, ...input })).code, "not_found");
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM questions").get().n, f.questionRowCount);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_mcp_audit_log").get().n, 0);
});

test("taxonomy hints account for same-name updates and repeated merges advancing revisions", async (t) => {
  const f = await questionBankFixture(t);
  const tools = (await payload(await rpc(f.env, "admin", f.admin.token))).result.tools;
  const hints = Object.fromEntries(tools.map(tool => [tool.name, tool.annotations]));
  await callAdminTool(f, "admin_create_tag", { name: "source" });
  const rows = () => f.sqlite.prepare("SELECT * FROM question_bank_tags ORDER BY id").all();
  const beforeDuplicate = rows();
  assert.equal((await callAdminToolExpectingError(f, "admin_create_tag", { name: "source" })).code, "conflict");
  assert.deepEqual(rows(), beforeDuplicate);
  assert.equal(hints.admin_create_tag.idempotentHint, true);

  const revision = name => f.sqlite.prepare("SELECT revision FROM question_bank_tags WHERE name = ?").get(name).revision;
  for (const [tool, args, target] of [
    ["admin_update_tag", { name: "source", newName: "source" }, "source"],
    ["admin_merge_tags", { names: ["source"], targetName: "target" }, "target"],
  ]) {
    await callAdminTool(f, tool, args);
    const before = revision(target);
    await callAdminTool(f, tool, args);
    assert.equal(revision(target), before + 1, `${tool} still updates the catalog on retry`);
    assert.equal(hints[tool].idempotentHint, false);
    assert.equal(hints[tool].destructiveHint, true);
  }
});
