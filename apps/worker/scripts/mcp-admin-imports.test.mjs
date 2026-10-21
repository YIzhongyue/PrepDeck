// Admin MCP imports and exports: preview, execute, resume and replay, and
// how tag changes interact with re-import baselines.
// The harness is mcp-foundation-fixture.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  fixture, issueMcpCredential, getQuestionTags, questionBankFixture, callAdminTool, callAdminToolExpectingError, importFile, lastMetric,
} from "./mcp-foundation-fixture.mjs";

test("implementation: a pure catalog rename of a previously-imported question's tag does not manufacture a false 'locally_edited' conflict on re-import", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{
    externalId: "TAGGED1", type: "single_choice", stem: "Tagged import Q?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"], tags: ["old-tag"],
  }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  await callAdminTool(f, "admin_execute_import", { examId: "examA", file, importId: preview.importId, importToken: preview.importToken });
  const created = await callAdminTool(f, "admin_search_questions", { examId: "examA", q: "TAGGED1" });
  assert.deepEqual(getQuestionTags(f.sqlite, created.questions[0].id), ["old-tag"]);

  // Rename the tag — a pure catalog identity change, no question touched.
  await callAdminTool(f, "admin_update_tag", { name: "old-tag", newName: "new-tag" });
  assert.deepEqual(getQuestionTags(f.sqlite, created.questions[0].id), ["new-tag"]);

  // Re-preview the SAME original file (which still says "old-tag") — this
  // question's own content was never locally edited, only the shared tag's
  // display name changed, so the reason must be "incoming_changes" (the
  // file's stale tag name vs. the live rename), never "locally_edited".
  const reImport = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  assert.equal(reImport.conflicts.length, 0, "resolved as a plain update candidate, not a conflict needing manual review");
  assert.equal(reImport.updates.length, 1);
});

test("merging imported tag identities preserves re-import baselines without hiding later content edits", async (t) => {
  const f = await questionBankFixture(t);
  const question = { externalId: "MERGED1", type: "fill_blank", stem: "Original imported question", correctAnswers: ["yes"], tags: ["legacy-a", "legacy-b", "standard"] };
  const file = importFile([question]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  await callAdminTool(f, "admin_execute_import", { examId: "examA", file, importId: preview.importId, importToken: preview.importToken });
  const stored = f.sqlite.prepare("SELECT id, revision FROM questions WHERE external_id='MERGED1'").get();
  await callAdminTool(f, "admin_merge_tags", { names: ["legacy-a", "legacy-b"], targetName: "standard" });
  const target = f.sqlite.prepare("SELECT id FROM question_bank_tags WHERE name='standard'").get().id;
  const merged = f.sqlite.prepare("SELECT revision, import_baseline_tag_ids_json FROM questions WHERE id=?").get(stored.id);
  assert.equal(merged.revision, stored.revision);
  assert.deepEqual(JSON.parse(merged.import_baseline_tag_ids_json), [target]);
  const incoming = importFile([{ ...question, stem: "Supplier revision", tags: ["standard"] }]);
  const next = await callAdminTool(f, "admin_preview_import", { examId: "examA", file: incoming });
  assert.equal(next.conflicts.length, 0);
  assert.equal(next.updates.length, 1);
  f.sqlite.prepare("UPDATE questions SET stem='Manual correction', revision=revision+1 WHERE id=?").run(stored.id);
  const edited = await callAdminTool(f, "admin_preview_import", { examId: "examA", file: incoming });
  assert.equal(edited.updates.length, 0);
  assert.equal(edited.conflicts[0].reason, "locally_edited");
});

test("a question save preserves the import baseline remapped by a concurrent tag merge", async (t) => {
  const f = await questionBankFixture(t);
  const question = { externalId: "MERGE-RACE", type: "fill_blank", stem: "Original imported question", correctAnswers: ["yes"], tags: ["legacy", "standard"] };
  const file = importFile([question]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  await callAdminTool(f, "admin_execute_import", { examId: "examA", file, importId: preview.importId, importToken: preview.importToken });
  const stored = f.sqlite.prepare("SELECT id, revision, import_baseline_json FROM questions WHERE external_id='MERGE-RACE'").get();
  const payload = { stem: question.stem };
  const proposal = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", id: stored.id, payload });

  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let merged = false;
  f.env.DB.batch = async (statements) => {
    f.env.DB.batch = originalBatch;
    // The save already read the original baseline and tag links. A catalog
    // merge remaps both without changing the question revision before it writes.
    await callAdminTool(f, "admin_merge_tags", { names: ["legacy"], targetName: "standard" });
    merged = true;
    return originalBatch(statements);
  };
  await callAdminTool(f, "admin_update_question", {
    examId: "examA", id: stored.id, expectedRevision: stored.revision, payload, proposalToken: proposal.proposalToken,
  });
  assert.equal(merged, true);
  const saved = f.sqlite.prepare("SELECT revision, import_baseline_json, import_baseline_tag_ids_json FROM questions WHERE id=?").get(stored.id);
  const target = f.sqlite.prepare("SELECT id FROM question_bank_tags WHERE name='standard'").get().id;
  assert.equal(saved.revision, stored.revision + 1);
  assert.equal(saved.import_baseline_json, stored.import_baseline_json);
  assert.deepEqual(JSON.parse(saved.import_baseline_tag_ids_json), [target]);
  assert.deepEqual(getQuestionTags(f.sqlite, stored.id), ["standard"]);

  const incoming = importFile([{ ...question, stem: "Supplier revision", tags: ["standard"] }]);
  const next = await callAdminTool(f, "admin_preview_import", { examId: "examA", file: incoming });
  assert.equal(next.conflicts.length, 0, "a no-op save must not manufacture a locally_edited conflict");
  assert.equal(next.updates.length, 1);
});

test("implementation (review): a taxonomy change between preview and execute invalidates the approved import token instead of silently resolving a name differently than reviewed", async (t) => {
  const f = await questionBankFixture(t);
  await callAdminTool(f, "admin_create_tag", { name: "aws" });
  const file = importFile([{
    externalId: "NEWTAG1", type: "single_choice", stem: "New tagged import?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"], tags: ["aws"],
  }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  assert.equal(preview.creates.length, 1);

  // Between preview and execute, "aws" is renamed away — an execute using
  // the file+importToken exactly as reviewed would otherwise resolve "aws"
  // to a BRAND NEW catalog identity (the reviewed one no longer matches),
  // silently changing what the approved import actually commits.
  await callAdminTool(f, "admin_update_tag", { name: "aws", newName: "amazon-web-services" });

  const error = await callAdminToolExpectingError(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(error.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'NEWTAG1'").get().c, 0,
    "nothing committed under a stale tag-resolution token");

  // A fresh preview picks up the renamed taxonomy and its own token then
  // executes cleanly. No alias table (deliberately out of scope — see the
  // PR description): the file still literally says "aws", which no longer
  // matches any catalog row post-rename, so this creates a distinct new
  // "aws" identity rather than reusing "amazon-web-services" — an
  // explicit, visible outcome instead of a silently wrong one.
  const freshPreview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const executed = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: freshPreview.importId, importToken: freshPreview.importToken,
  });
  assert.equal(executed.created, 1);
  assert.equal(lastMetric(f, "tool").created, 1);
  assert.equal(lastMetric(f, "tool").kind, "admin_mutation");
  const created = await callAdminTool(f, "admin_search_questions", { examId: "examA", q: "NEWTAG1" });
  assert.deepEqual(getQuestionTags(f.sqlite, created.questions[0].id), ["aws"]);
  const awsRow = f.sqlite.prepare("SELECT id FROM question_bank_tags WHERE normalized_name = 'aws'").get();
  const renamedRow = f.sqlite.prepare("SELECT id FROM question_bank_tags WHERE normalized_name = 'amazon-web-services'").get();
  assert.notEqual(awsRow.id, renamedRow.id, "a distinct new identity, not the renamed original");
});

test("implementation: admin_preview_import classifies without writing, and admin_execute_import binds to the exact reviewed file", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{
    externalId: "NEW1", type: "single_choice", stem: "Import Q1?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"],
  }]);

  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  assert.equal(preview.valid, true);
  assert.equal(preview.creates.length, 1);
  assert.equal(preview.updates.length, 0);
  assert.equal(preview.conflicts.length, 0);
  assert.ok(preview.importId);
  assert.ok(preview.importToken);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount, "preview must not write");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_import_jobs").get().c, 0, "preview must not create a job row");

  const tamperedFile = importFile([{ ...file.questions[0], stem: "Tampered" }]);
  const stale = await callAdminToolExpectingError(f, "admin_execute_import", {
    examId: "examA", file: tamperedFile, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(stale.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount);

  const executed = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(executed.created, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'NEW1'").get().c, 1);
  assert.ok(f.env.IMPORT_VALIDATE_RATE_LIMITER.calls.length > 0);
  assert.ok(f.env.IMPORT_EXECUTE_RATE_LIMITER.calls.length > 0);
  assert.ok([...f.bucketObjects.keys()].some((key) => key.startsWith("imports/examA/")));

  const status = await callAdminTool(f, "admin_get_import_status", { importId: preview.importId });
  assert.equal(status.status, "completed");
  assert.equal(status.createdCount, 1);

  // A retry with the exact same importId/importToken/resolutions (lost
  // response, at-least-once delivery) must replay instead of duplicating —
  // this is the fix for the reviewed version's missing commit boundary.
  const replay = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(lastMetric(f, "tool").outcome, "replayed");
  assert.equal(lastMetric(f, "tool").created, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'NEW1'").get().c, 1);

  // The stale-token attempt above and the real execute each wrote their own
  // audit row; the later replay is not a new mutation and must add no more.
  const importAudit = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_execute_import' AND action = 'import_execute' ORDER BY rowid",
  ).all();
  assert.deepEqual(importAudit.map((r) => r.outcome), ["failure", "success"]);
});

test("implementation: admin_execute_import requires an explicit resolution for any changed row, and rejects a same-importId replay whose conflictResolutions differ", async (t) => {
  const f = await questionBankFixture(t);
  const original = {
    externalId: "EXT-Q1", type: "single_choice", stem: "Original stem?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"],
  };
  const firstFile = importFile([original]);
  const firstPreview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file: firstFile });
  await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file: firstFile, importId: firstPreview.importId, importToken: firstPreview.importToken,
  });
  const createdRow = f.sqlite.prepare("SELECT id FROM questions WHERE external_id = 'EXT-Q1'").get();

  const incoming = { ...original, stem: "Updated stem?" };
  const file = importFile([incoming]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  assert.equal(preview.updates.length, 1, "an unedited row with a new incoming value is a candidate update in preview");
  assert.equal(preview.conflicts.length, 0);
  const candidate = preview.updates[0];
  assert.equal(candidate.questionId, createdRow.id);

  // REST's own execute rule (routes/imports.ts): ANY non-identical row needs
  // an explicit, exactly-matching resolution to be applied — even one
  // preview classified as a safe "update", not just a "conflict".
  const noResolution = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(noResolution.updated, 0);
  const conflictOutcome = noResolution.outcomes.find((o) => o.questionId === createdRow.id);
  assert.equal(conflictOutcome.status, "conflict");
  assert.equal(f.sqlite.prepare("SELECT stem FROM questions WHERE id = ?").get(createdRow.id).stem, "Original stem?");

  const preview2 = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const applied = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview2.importId, importToken: preview2.importToken,
    conflictResolutions: [{
      questionId: createdRow.id, expectedRevision: candidate.expectedRevision,
      incomingToken: candidate.incomingToken, action: "apply",
    }],
  });
  assert.equal(applied.updated, 1);
  assert.equal(f.sqlite.prepare("SELECT stem FROM questions WHERE id = ?").get(createdRow.id).stem, "Updated stem?");

  // Same importId, different resolution (keep vs apply) — must be rejected,
  // never silently replay the first result or apply the new decision.
  const differentResolution = await callAdminToolExpectingError(f, "admin_execute_import", {
    examId: "examA", file, importId: preview2.importId, importToken: preview2.importToken,
    conflictResolutions: [{
      questionId: createdRow.id, expectedRevision: candidate.expectedRevision,
      incomingToken: candidate.incomingToken, action: "keep",
    }],
  });
  assert.equal(differentResolution.code, "conflict");
});

test("implementation: a stale in_progress import claim is taken over on resume without duplicating already-created rows", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{
    externalId: "RESUME1", type: "single_choice", stem: "Resumable?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"],
  }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const result = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(result.created, 1);

  // Simulate a crashed prior attempt: force the job back to in_progress with
  // a stale timestamp, as claimImportJob would find it after a real crash.
  f.sqlite.prepare("UPDATE admin_mcp_import_jobs SET status = 'in_progress', updated_at = ? WHERE id = ?")
    .run(Date.now() - 5 * 60 * 1000, preview.importId);
  f.kvInvalidations.length = 0; // isolate what THIS resumed call invalidates

  const resumed = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(resumed.failed, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'RESUME1'").get().c, 1,
    "resume must not recreate the already-created row");
  // implementation (review round 2): re-classifying against current DB state
  // would see the already-created row as "identical" and reclassify it as a
  // plain skip, undercounting `created` and skipping cache invalidation —
  // the admin_mcp_import_committed_items ledger must recover it instead.
  assert.equal(resumed.created, 1,
    "the resumed attempt must recover the prior attempt's committed create, not report it as a skip");
  assert.ok(f.kvInvalidations.includes("practice-questions:examA"),
    "a resume that recovers a committed create must still invalidate cache, in case the original attempt died before invalidating");

  // A fresh (non-stale) in_progress claim must NOT be taken over.
  f.sqlite.prepare("UPDATE admin_mcp_import_jobs SET status = 'in_progress', updated_at = ? WHERE id = ?")
    .run(Date.now(), preview.importId);
  const busy = await callAdminToolExpectingError(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(busy.code, "conflict");
});

test("implementation: admin import tools reject excessive JSON nesting", async (t) => {
  const f = await questionBankFixture(t);
  let deep = "leaf";
  for (let i = 0; i < 40; i++) deep = [deep];
  const badFile = importFile([{
    type: "single_choice", stem: "Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    correctAnswers: ["a"], tags: deep,
  }]);
  const rejected = await callAdminToolExpectingError(f, "admin_validate_import", { examId: "examA", file: badFile });
  assert.equal(rejected.code, "invalid_input");
});

test("implementation: the import rate limiter distinguishes an unreachable limiter from an exceeded quota, and both block the request", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{ type: "single_choice", stem: "Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] }]);

  f.env.IMPORT_VALIDATE_RATE_LIMITER.respond = () => { throw new Error("simulated Cloudflare rate-limiter outage"); };
  const unavailable = await callAdminToolExpectingError(f, "admin_validate_import", { examId: "examA", file });
  assert.equal(unavailable.code, "unavailable");

  f.env.IMPORT_VALIDATE_RATE_LIMITER.respond = () => ({ success: false });
  const limited = await callAdminToolExpectingError(f, "admin_validate_import", { examId: "examA", file });
  assert.equal(limited.code, "rate_limited");

  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount, "neither rejection wrote anything");
});

for (const name of ["reading", "case-with-figure", ...(process.env.COMPONENT_SOURCE_FILES?.split(",") ?? [])]) test(`component ${name}: MCP preview, idempotent import and export preserve the package`, async t => {
  const f = await fixture(t);
  await callAdminTool(f, "admin_create_exam", { slug: "component-exam", name: "Components" }).then(result => { f.componentExamId = result.exam.id; });
  const file = JSON.parse(await readFile(name.startsWith('/') ? name : new URL(`../../../tests/fixtures/components/${name}.json`, import.meta.url), 'utf8'));
  const preview = await callAdminTool(f, 'admin_preview_import', { examId: f.componentExamId, file });
  assert.equal(preview.valid, true);
  const args = { examId: f.componentExamId, file, importId: preview.importId, importToken: preview.importToken };
  const imported = await callAdminTool(f, 'admin_execute_import', args);
  assert.equal(imported.created, file.questions.length);
  const replay = await callAdminTool(f, 'admin_execute_import', args);
  assert.equal(replay.idempotentReplay, true);
  const exported = await callAdminTool(f, 'admin_export_questions', { examId: f.componentExamId, limit: 1 });
  assert.equal(exported.file.schemaVersion, '2.0'); assert.equal(exported.nextOffset, file.questions.length > 1 ? 1 : null);
  assert.deepEqual(exported.file.stimuli, file.stimuli ?? []);
  assert.deepEqual(exported.file.assets, file.assets ?? []);
  assert.ok(exported.file.questions[0].scoring);
});

test("MCP export rejects missing external IDs without writing and preserves assigned identities on re-import", async t => {
  const f = await fixture(t);
  const { exam } = await callAdminTool(f, "admin_create_exam", { slug: "round-trip", name: "Round trip" });
  const fields = { type: "fill_blank", stem: "Complete this.", correctAnswers: ["answer"], needsReview: true };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: exam.id, payload: fields });
  const { question } = await callAdminTool(f, "admin_create_question", {
    examId: exam.id, payload: preview.payload, proposalToken: preview.proposalToken, proposalId: preview.proposalId,
  });
  const before = f.sqlite.prepare("SELECT * FROM questions").all();
  const error = await callAdminToolExpectingError(f, "admin_export_questions", { examId: exam.id });
  assert.equal(error.code, "export_requires_external_id");
  assert.match(error.message, /Assign a unique external ID/);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM questions").all(), before);
  const identity = await callAdminTool(f, "admin_validate_question_payload", { examId: exam.id, id: question.id, payload: { externalId: "manual-1" } });
  await callAdminTool(f, "admin_update_question", {
    examId: exam.id, id: question.id, expectedRevision: identity.currentRevision, payload: identity.payload, proposalToken: identity.proposalToken,
  });
  const { file } = await callAdminTool(f, "admin_export_questions", { examId: exam.id });
  assert.equal(file.questions[0].externalId, "manual-1");
  assert.equal(file.questions[0].needsReview, true);
  const imported = await callAdminTool(f, "admin_preview_import", { examId: exam.id, file });
  assert.equal(imported.creates.length, 0);
  assert.equal(imported.conflicts[0].questionId, question.id);
  const result = await callAdminTool(f, "admin_execute_import", {
    examId: exam.id, file, importId: imported.importId, importToken: imported.importToken,
    conflictResolutions: imported.conflicts.map(({ questionId, expectedRevision, incomingToken }) => ({ questionId, expectedRevision, incomingToken, action: "apply" })),
  });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM questions").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT needs_review FROM questions WHERE id = ?").get(question.id).needs_review, 1);
});

// Issue #178: a job's own tag registration must not stale its original proposal.
test("new import-created tags permit terminal replay without duplicate writes", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{ externalId: "NEW-TAG-REPLAY", type: "fill_blank", stem: "Synthetic replay", correctAnswers: ["yes"], tags: ["new-replay-tag"] }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const args = { examId: "examA", file, importId: preview.importId, importToken: preview.importToken };
  const result = await callAdminTool(f, "admin_execute_import", args);
  assert.equal(result.created, 1);
  const rows = f.sqlite.prepare("SELECT * FROM questions").all();
  const replay = await callAdminTool(f, "admin_execute_import", args);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.created, 1);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM questions").all(), rows);
});

for (const interruptAfter of ["tags", "first question batch"]) {
  test(`new import-created tags permit recovery after ${interruptAfter}`, async (t) => {
    const f = await questionBankFixture(t);
    const file = importFile(Array.from({ length: 18 }, (_, i) => ({
      // Deliberately omit external IDs: fresh re-import is not safe recovery.
      type: "fill_blank", stem: `Synthetic recovery ${i}`, correctAnswers: ["yes"], tags: ["new-resume-tag"],
    })));
    const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
    const args = { examId: "examA", file, importId: preview.importId, importToken: preview.importToken };
    const originalBatch = f.env.DB.batch.bind(f.env.DB);
    const originalPrepare = f.env.DB.prepare.bind(f.env.DB);
    let interrupted = false;
    f.env.DB.batch = async (statements) => {
      const result = await originalBatch(statements);
      const target = interruptAfter === "tags" ? "INSERT OR IGNORE INTO question_bank_tags" : "INSERT INTO questions";
      if (statements.some((s) => s.sql.includes(target))) {
        interrupted = true;
        // Simulate losing the process after the atomic commit: no later
        // audit, counters or terminal status may be persisted by this attempt.
        f.env.DB.prepare = () => { throw new Error("simulated process interruption"); };
        throw new Error("simulated process interruption");
      }
      return result;
    };
    await callAdminToolExpectingError(f, "admin_execute_import", args);
    assert.equal(interrupted, true);
    f.env.DB.batch = originalBatch;
    f.env.DB.prepare = originalPrepare;
    const committed = f.sqlite.prepare("SELECT * FROM admin_mcp_import_committed_items WHERE import_id = ? ORDER BY item_index").all(preview.importId);
    assert.equal(committed.length, interruptAfter === "tags" ? 0 : 16);
    f.sqlite.prepare("UPDATE admin_mcp_import_jobs SET updated_at = ? WHERE id = ?").run(Date.now() - 5 * 60_000, preview.importId);
    const resumed = await callAdminTool(f, "admin_execute_import", args);
    assert.equal(resumed.created, 18);
    assert.equal(resumed.failed, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem LIKE 'Synthetic recovery %'").get().c, 18);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM admin_mcp_import_committed_items WHERE import_id = ? ORDER BY item_index LIMIT ?").all(preview.importId, committed.length), committed);
  });
}


test("import replay binds file, resolutions, exam and administrator identity", async (t) => {
  const f = await questionBankFixture(t);
  await callAdminTool(f, "admin_create_tag", { name: "existing-identity-tag" });
  const file = importFile([{ externalId: "BOUND-REPLAY", type: "fill_blank", stem: "Bound replay", correctAnswers: ["yes"], tags: ["existing-identity-tag", "new-identity-tag"] }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const args = { examId: "examA", file, importId: preview.importId, importToken: preview.importToken };
  await callAdminTool(f, "admin_execute_import", args);
  const rows = f.sqlite.prepare("SELECT * FROM questions").all();
  for (const changed of [
    { file: importFile([{ ...file.questions[0], stem: "Changed content" }]) },
    { conflictResolutions: [{ questionId: "different", expectedRevision: 1, incomingToken: "a".repeat(64), action: "keep" }] },
    { examId: "examB" },
  ]) {
    assert.equal((await callAdminToolExpectingError(f, "admin_execute_import", { ...args, ...changed })).code, "conflict");
  }
  f.sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = 'bob'").run();
  const otherAdmin = await issueMcpCredential(f.DB, { userId: "bob", audience: "admin", name: "synthetic second admin", expiresAt: Date.now() + 60_000 });
  assert.equal((await callAdminToolExpectingError({ ...f, admin: otherAdmin }, "admin_execute_import", args)).code, "conflict");
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM questions").all(), rows);
});

for (const mode of ["terminal", "resume"]) for (const mutation of ["rename own", "merge own", "delete own", "rename existing", "merge existing"]) {
  test(`import ${mode} rejects unrelated taxonomy mutation: ${mutation}`, async (t) => {
    const f = await questionBankFixture(t);
    await callAdminTool(f, "admin_create_tag", { name: "existing-protected-tag" });
    await callAdminTool(f, "admin_create_tag", { name: "merge-target" });
    const file = importFile([{ externalId: "TAXONOMY-REPLAY", type: "fill_blank", stem: "Taxonomy replay", correctAnswers: ["yes"], tags: ["own-protected-tag", "existing-protected-tag"] }]);
    const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
    const args = { examId: "examA", file, importId: preview.importId, importToken: preview.importToken };
    await callAdminTool(f, "admin_execute_import", args);
    if (mode === "resume") f.sqlite.prepare("UPDATE admin_mcp_import_jobs SET status = 'in_progress', updated_at = ? WHERE id = ?").run(Date.now() - 5 * 60_000, preview.importId);
    const name = mutation.endsWith("own") ? "own-protected-tag" : "existing-protected-tag";
    if (mutation.startsWith("rename")) await callAdminTool(f, "admin_update_tag", { name, newName: "renamed-away" });
    else if (mutation.startsWith("merge")) await callAdminTool(f, "admin_merge_tags", { names: [name], targetName: "merge-target" });
    else f.sqlite.prepare("DELETE FROM question_bank_tags WHERE normalized_name = ?").run(name);
    const before = f.sqlite.prepare("SELECT * FROM admin_mcp_import_jobs WHERE id = ?").get(preview.importId);
    const rows = f.sqlite.prepare("SELECT * FROM questions").all();
    assert.equal((await callAdminToolExpectingError(f, "admin_execute_import", args)).code, "conflict");
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM questions").all(), rows);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM admin_mcp_import_jobs WHERE id = ?").get(preview.importId), before);
  });
}

test("failed empty imports retain own-tag evidence when retried", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{ type: "fill_blank", stem: "Retry empty failed import", correctAnswers: ["yes"], tags: ["failed-retry-tag"] }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const args = { examId: "examA", file, importId: preview.importId, importToken: preview.importToken };
  const batch = f.env.DB.batch.bind(f.env.DB);
  f.env.DB.batch = (statements) => {
    if (statements.some((s) => s.sql.includes("INSERT INTO questions"))) throw new Error("simulated question batch failure");
    return batch(statements);
  };
  const failed = await callAdminTool(f, "admin_execute_import", args);
  assert.equal(failed.failed, 1);
  const evidence = f.sqlite.prepare("SELECT * FROM admin_mcp_import_created_tags WHERE import_id = ?").all(preview.importId);
  assert.equal(evidence.length, 1);
  const archive = f.sqlite.prepare("SELECT r2_object_key FROM admin_mcp_import_jobs WHERE id = ?").get(preview.importId);
  f.env.DB.batch = batch;
  const retry = await callAdminTool(f, "admin_execute_import", args);
  assert.equal(retry.created, 1);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM admin_mcp_import_created_tags WHERE import_id = ?").all(preview.importId), evidence);
  assert.deepEqual(f.sqlite.prepare("SELECT r2_object_key FROM admin_mcp_import_jobs WHERE id = ?").get(preview.importId), archive);
  assert.equal((await callAdminTool(f, "admin_execute_import", args)).idempotentReplay, true);
});

for (const change of ["insert missing", "rename existing"]) {
  test(`import rejects concurrent external tag change during resolution: ${change}`, async (t) => {
    const f = await questionBankFixture(t);
    await callAdminTool(f, "admin_create_tag", { name: "existing-race-tag" });
    const file = importFile([{ type: "fill_blank", stem: "Concurrent external taxonomy", correctAnswers: ["yes"], tags: ["missing-race-tag", "existing-race-tag"] }]);
    const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
    const args = { examId: "examA", file, importId: preview.importId, importToken: preview.importToken };
    const batch = f.env.DB.batch.bind(f.env.DB);
    let raced = false;
    f.env.DB.batch = async (statements) => {
      if (statements.some((s) => s.sql.includes("INSERT OR IGNORE INTO question_bank_tags"))) {
        f.env.DB.batch = batch;
        raced = true;
        if (change === "insert missing") await callAdminTool(f, "admin_create_tag", { name: "missing-race-tag" });
        else await callAdminTool(f, "admin_update_tag", { name: "existing-race-tag", newName: "renamed-race-tag" });
      }
      return batch(statements);
    };
    assert.equal((await callAdminToolExpectingError(f, "admin_execute_import", args)).code, "conflict");
    assert.equal(raced, true);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Concurrent external taxonomy'").get().c, 0);
    if (change === "insert missing") assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_import_created_tags WHERE import_id = ?").get(preview.importId).c, 0,
      "another request's winning tag insertion must not be journaled as our own");
  });
}

test("an active tagged import excludes concurrent execution of the same job", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{ type: "fill_blank", stem: "Concurrent job", correctAnswers: ["yes"], tags: ["concurrent-job-tag"] }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const args = { examId: "examA", file, importId: preview.importId, importToken: preview.importToken };
  const batch = f.env.DB.batch.bind(f.env.DB);
  let enter, release;
  const entered = new Promise((resolve) => { enter = resolve; });
  const released = new Promise((resolve) => { release = resolve; });
  f.env.DB.batch = async (statements) => {
    if (statements.some((s) => s.sql.includes("INSERT OR IGNORE INTO question_bank_tags"))) {
      enter();
      await released;
    }
    return batch(statements);
  };
  const first = callAdminTool(f, "admin_execute_import", args);
  await entered;
  try {
    assert.equal((await callAdminToolExpectingError(f, "admin_execute_import", args)).code, "conflict");
  } finally { release(); }
  assert.equal((await first).created, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Concurrent job'").get().c, 1);
});

test("tag creation and job evidence roll back together", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{ type: "fill_blank", stem: "Atomic tag evidence", correctAnswers: ["yes"], tags: ["atomic-evidence-tag"] }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const args = { examId: "examA", file, importId: preview.importId, importToken: preview.importToken };
  const batch = f.env.DB.batch.bind(f.env.DB);
  f.env.DB.batch = (statements) => batch(statements.some((s) => s.sql.includes("INSERT OR IGNORE INTO question_bank_tags")) ?
    [...statements, f.env.DB.prepare("INSERT INTO missing_test_table VALUES (1)")] : statements);
  await callAdminToolExpectingError(f, "admin_execute_import", args);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags WHERE normalized_name = 'atomic-evidence-tag'").get().c, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_import_created_tags WHERE import_id = ?").get(preview.importId).c, 0);
  f.env.DB.batch = batch;
  f.sqlite.prepare("UPDATE admin_mcp_import_jobs SET updated_at = ? WHERE id = ?").run(Date.now() - 5 * 60_000, preview.importId);
  assert.equal((await callAdminTool(f, "admin_execute_import", args)).created, 1);
});


test("legacy jobs without own-tag evidence fail closed instead of guessing tag ownership", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{ type: "fill_blank", stem: "Legacy job", correctAnswers: ["yes"], tags: ["legacy-evidence-tag"] }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const args = { examId: "examA", file, importId: preview.importId, importToken: preview.importToken };
  await callAdminTool(f, "admin_execute_import", args);
  f.sqlite.prepare("DELETE FROM admin_mcp_import_created_tags WHERE import_id = ?").run(preview.importId);
  assert.equal((await callAdminToolExpectingError(f, "admin_execute_import", args)).code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Legacy job'").get().c, 1);
});
