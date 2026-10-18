// Direct coverage for lib/questionImport.ts, the import pipeline shared by
// the REST import routes and Admin MCP's import tools. Both entry points are
// covered end to end in question-authoring, mutation-consistency and
// mcp-foundation; this file pins the pipeline's own contract: how rows are
// classified, which resolutions apply, where the caller's chained statements
// sit, and how stale and rolled-back batches are reported.
import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { openDatabase, SEED_MIGRATION } from "../../../tests/support/migrations.mjs";

const {
  validateImport, importTagNames, findImportTargets, decideImportRows, classifyImportDecisions, changedRowConflicts,
  isCleanUpdate, planImportWrites, commitImportWrites, countImportOutcomes, limitImportRequest, archiveImportFile,
  cleanOldImportArchives, recordImportLog,
} = await importTs(new URL("../src/lib/questionImport.ts", import.meta.url));

const choice = { type: "single_choice", stem: "Which value is even?", options: [{ id: "A", text: "2" }, { id: "B", text: "3" }], correctAnswers: ["A"] };
const fileOf = (questions) => ({ schemaVersion: "1.0", exam: { id: "exam", name: "Exam" }, questions });
const NOW = "2026-10-18T00:00:00.000Z";

function fixture(t, options = {}) {
  const sqlite = openDatabase(t, { filter: (name) => name !== SEED_MIGRATION });
  sqlite.prepare("INSERT INTO users (id, email, role, status, created_at) VALUES ('admin', 'admin@example.test', 'admin', 'active', ?)").run(NOW);
  sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES ('exam', 'exam', 'Exam', ?)").run(NOW);
  return { sqlite, db: createD1(sqlite, options) };
}

// Adds a question with no import baseline, as an admin-authored one has.
function insertAuthored(sqlite, id, externalId, stem = "Authored stem") {
  sqlite.prepare(
    `INSERT INTO questions (id, exam_id, external_id, sequence_number, type, stem, options_json, correct_answers_json, points, created_at, updated_at)
     VALUES (?, 'exam', ?, (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM questions), 'single_choice', ?, ?, '["A"]', 1, ?, ?)`,
  ).run(id, externalId, stem, JSON.stringify(choice.options), NOW, NOW);
}

async function decide(db, questions) {
  const { file } = validateImport(fileOf(questions));
  const existing = await findImportTargets(db, "exam", file.questions);
  return { file, decisions: await decideImportRows(db, existing, file.questions) };
}

// Two questions sharing an externalId, as legacy data from before migration
// 0015's uniqueness trigger can.
function insertLegacyDuplicates(sqlite, externalId, ids) {
  sqlite.exec("DROP TRIGGER questions_external_id_insert");
  for (const id of ids) insertAuthored(sqlite, id, externalId);
}

const noChained = () => [];

// Runs the whole pipeline the way a caller would, with no resolutions.
async function importAll(db, questions, { resolutionFor = () => undefined, chainedStatements = noChained } = {}) {
  const { file, decisions } = await decide(db, questions);
  const plan = await planImportWrites(db, { examId: "exam", questions: file.questions, decisions, now: NOW, resolutionFor, chainedStatements });
  const results = await commitImportWrites(db, plan.writes, { itemsPerBatch: 50, onRollback: async () => {} });
  return { decisions, plan, results };
}

test("validateImport normalizes only a valid file", () => {
  const valid = validateImport(fileOf([{ ...choice, externalId: "Q1" }]));
  assert.deepEqual(valid.issues, []);
  assert.equal(valid.questionCount, 1);
  assert.equal(valid.file.questions[0].externalId, "Q1");

  const invalid = validateImport(fileOf([{ ...choice, externalId: "Q1" }, { ...choice, externalId: "Q1" }]));
  assert.equal(invalid.file, null);
  assert.deepEqual(invalid.duplicateExternalIdsInFile, ["Q1"]);
  assert.ok(invalid.issues.length > 0);
});

test("importTagNames collects every row's tags", () => {
  assert.deepEqual(importTagNames([{ tags: ["a", "b"] }, {}, { tags: ["a"] }]), ["a", "b", "a"]);
});

test("rows are classified against stored questions in file order", async (t) => {
  const { sqlite, db } = fixture(t);
  await importAll(db, [{ ...choice, externalId: "IMPORTED" }, { ...choice, externalId: "EDITED" }]);
  sqlite.prepare("UPDATE questions SET stem = 'Edited here', revision = revision + 1 WHERE external_id = 'EDITED'").run();
  insertAuthored(sqlite, "authored", "AUTHORED");
  insertLegacyDuplicates(sqlite, "DUP", ["dup1", "dup2"]);

  const { decisions } = await decide(db, [
    { ...choice, externalId: "NEW" },
    { ...choice, externalId: "IMPORTED" },
    { ...choice, externalId: "EDITED", stem: "Incoming" },
    { ...choice, externalId: "AUTHORED", stem: "Incoming" },
    { ...choice, externalId: "DUP" },
    { ...choice },
  ]);

  assert.deepEqual(decisions.map((d) => [d.index, d.kind, d.kind === "changed" ? d.conflict.reason : null]), [
    [0, "create", null],
    [1, "identical", null],
    [2, "changed", "locally_edited"],
    [3, "changed", "unknown_provenance"],
    [4, "changed", "ambiguous_external_id"],
    [4, "changed", "ambiguous_external_id"],
    [5, "create", null],
  ]);
  assert.deepEqual(decisions.filter((d) => d.kind === "changed").map(isCleanUpdate), [false, false, false, false]);
  // REST's /validate lists every differing row, each ambiguous match separately.
  assert.deepEqual(changedRowConflicts(decisions).map((c) => c.reason),
    ["locally_edited", "unknown_provenance", "ambiguous_external_id", "ambiguous_external_id"]);
  assert.deepEqual(changedRowConflicts(decisions).slice(2).map((c) => c.questionId).sort(), ["dup1", "dup2"]);
});

test("a change to an untouched imported question is a clean update in preview, and still a conflict in REST's list", async (t) => {
  const { db } = fixture(t);
  await importAll(db, [{ ...choice, externalId: "Q1" }]);
  const { decisions } = await decide(db, [{ ...choice, externalId: "Q1", stem: "Incoming" }, { ...choice, externalId: "Q2" }]);
  const classification = classifyImportDecisions(decisions);
  assert.equal(classification.updates.length, 1);
  assert.equal(classification.updates[0].index, 0);
  assert.equal(classification.updates[0].expectedRevision, decisions[0].row.revision);
  assert.equal(classification.updates[0].incomingToken, decisions[0].conflict.incomingToken);
  assert.deepEqual(classification.creates, [{ index: 1, externalId: "Q2" }]);
  assert.deepEqual(classification.conflicts, []);
  assert.deepEqual(changedRowConflicts(decisions).map((c) => c.reason), ["incoming_changes"]);
});

test("only an exactly matching resolution applies, and an ambiguous row never does", async (t) => {
  const { sqlite, db } = fixture(t);
  await importAll(db, [{ ...choice, externalId: "KEEP" }, { ...choice, externalId: "APPLY" }, { ...choice, externalId: "STALE" }]);
  insertLegacyDuplicates(sqlite, "DUP", ["dup1", "dup2"]);
  const incoming = ["KEEP", "APPLY", "STALE", "DUP"].map((externalId) => ({ ...choice, externalId, stem: `Incoming ${externalId}` }));
  const { file, decisions } = await decide(db, incoming);
  const asked = [];
  const resolutionFor = (d) => {
    asked.push(d.row.external_id);
    const match = { questionId: d.row.id, expectedRevision: d.row.revision, incomingToken: d.conflict.incomingToken };
    if (d.row.external_id === "KEEP") return { ...match, action: "keep" };
    if (d.row.external_id === "STALE") return { ...match, expectedRevision: d.row.revision - 1, action: "apply" };
    return { ...match, action: "apply" };
  };
  const plan = await planImportWrites(db, { examId: "exam", questions: file.questions, decisions, now: NOW, resolutionFor, chainedStatements: noChained });

  assert.deepEqual(asked, ["KEEP", "APPLY", "STALE"]);
  assert.deepEqual(plan.writes.map((p) => [p.write.kind, p.write.externalId]), [["update", "APPLY"]]);
  assert.deepEqual(plan.unchanged.map((u) => [u.decision.row.external_id, u.status, u.reason]), [
    ["KEEP", "skipped", "kept_current"],
    ["STALE", "conflict", "incoming_changes"],
    ["DUP", "conflict", "ambiguous_external_id"],
    ["DUP", "conflict", "ambiguous_external_id"],
  ]);
});

test("a planned write puts the caller's chained statements right after its row write, then its tag links", async (t) => {
  const { sqlite, db } = fixture(t);
  sqlite.exec("CREATE TABLE chained (question_id TEXT, wrote INTEGER)");
  const chainedStatements = (w) => [db.prepare("INSERT INTO chained (question_id, wrote) SELECT ?, changes()").bind(w.questionId)];
  const { plan, results } = await importAll(db, [{ ...choice, externalId: "Q1", tags: ["Alpha", "Beta"] }], { chainedStatements });

  assert.equal(plan.writes.length, 1);
  const [{ write, statements }] = plan.writes;
  assert.equal(write.kind, "create");
  assert.equal(write.examId, "exam");
  assert.match(statements[0].sql, /^INSERT INTO questions/);
  assert.match(statements[1].sql, /INSERT INTO chained/);
  assert.deepEqual(results, [{ write, status: "committed" }]);
  // The chained row saw the question insert's changes().
  assert.deepEqual({ ...sqlite.prepare("SELECT question_id, wrote FROM chained").get() }, { question_id: write.questionId, wrote: 1 });
  const tags = sqlite.prepare(
    "SELECT t.name FROM question_tag_links l JOIN question_bank_tags t ON t.id = l.tag_id WHERE l.question_id = ? ORDER BY t.name",
  ).all(write.questionId).map((r) => r.name);
  assert.deepEqual(tags, ["Alpha", "Beta"]);
  // The row records its import baseline, so a re-import is identical.
  const again = await decide(db, [{ ...choice, externalId: "Q1", tags: ["Alpha", "Beta"] }]);
  assert.equal(again.decisions[0].kind, "identical");
});

test("an update whose question moved on after planning commits nothing and is reported stale", async (t) => {
  const { sqlite, db } = fixture(t);
  await importAll(db, [{ ...choice, externalId: "Q1", tags: ["Old"] }]);
  const { file, decisions } = await decide(db, [{ ...choice, externalId: "Q1", stem: "Incoming", tags: ["New"] }]);
  const plan = await planImportWrites(db, {
    examId: "exam", questions: file.questions, decisions, now: NOW, chainedStatements: noChained,
    resolutionFor: (d) => ({ questionId: d.row.id, expectedRevision: d.row.revision, incomingToken: d.conflict.incomingToken, action: "apply" }),
  });
  // A concurrent edit reaches the revision the planned update would have.
  sqlite.prepare("UPDATE questions SET stem = 'Concurrent edit', revision = revision + 1, updated_at = '2026-10-18T00:00:01.000Z' WHERE external_id = 'Q1'").run();

  const results = await commitImportWrites(db, plan.writes, { itemsPerBatch: 50, onRollback: async () => assert.fail("no rollback") });
  assert.deepEqual(results.map((r) => r.status), ["stale"]);
  const row = sqlite.prepare("SELECT id, stem FROM questions WHERE external_id = 'Q1'").get();
  assert.equal(row.stem, "Concurrent edit");
  // Its tag links are guarded on the same write, so they stayed as they were.
  const tags = sqlite.prepare(
    "SELECT t.name FROM question_tag_links l JOIN question_bank_tags t ON t.id = l.tag_id WHERE l.question_id = ?",
  ).all(row.id).map((r) => r.name);
  assert.deepEqual(tags, ["Old"]);
});

test("a batch that throws rolls back as a unit, is reported once, and later batches still commit", async (t) => {
  let failOn = null;
  const { sqlite, db } = fixture(t, {
    onQuery: ({ method, args }) => { if (method === "batch" && failOn && args.includes(failOn)) throw new Error("synthetic batch failure"); },
  });
  const { file, decisions } = await decide(db, ["Q1", "Q2", "Q3", "Q4", "Q5"].map((externalId) => ({ ...choice, externalId })));
  const plan = await planImportWrites(db, {
    examId: "exam", questions: file.questions, decisions, now: NOW, resolutionFor: () => undefined, chainedStatements: noChained,
  });
  failOn = "Q3";
  const rolledBack = [];
  const results = await commitImportWrites(db, plan.writes, { itemsPerBatch: 2, onRollback: async (writes) => { rolledBack.push(writes.map((w) => w.externalId)); } });

  assert.deepEqual(results.map((r) => [r.write.externalId, r.status]), [
    ["Q1", "committed"], ["Q2", "committed"], ["Q3", "rolled_back"], ["Q4", "rolled_back"], ["Q5", "committed"],
  ]);
  assert.deepEqual(rolledBack, [["Q3", "Q4"]]);
  assert.deepEqual(sqlite.prepare("SELECT external_id FROM questions ORDER BY external_id").all().map((r) => r.external_id), ["Q1", "Q2", "Q5"]);
});

test("countImportOutcomes counts conflicts as skipped", () => {
  assert.deepEqual(
    countImportOutcomes(["created", "created", "updated", "skipped", "conflict", "failed"].map((status) => ({ status }))),
    { created: 2, updated: 1, skipped: 2, failed: 1 },
  );
});

test("limitImportRequest consumes the kind's limiter for this user and exam", async () => {
  const calls = [];
  const limiter = (name, success) => ({ limit: async (options) => { calls.push([name, options.key]); return { success }; } });
  const env = { IMPORT_VALIDATE_RATE_LIMITER: limiter("validate", true), IMPORT_EXECUTE_RATE_LIMITER: limiter("execute", false) };
  assert.equal(await limitImportRequest(env, "validate", "admin", "exam"), true);
  assert.equal(await limitImportRequest(env, "execute", "admin", "exam"), false);
  assert.deepEqual(calls, [["validate", "admin:exam"], ["execute", "admin:exam"]]);
});

test("the source file is archived under its exam, logged, and old archives are pruned", async (t) => {
  const { sqlite, db } = fixture(t);
  const objects = new Map();
  const bucket = {
    put: async (key, body, options) => { objects.set(key, { body, options, uploaded: new Date() }); },
    list: async ({ prefix }) => ({
      objects: [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({ key, uploaded: o.uploaded })), truncated: false,
    }),
    delete: async (keys) => { for (const key of keys) objects.delete(key); },
  };
  const key = await archiveImportFile(bucket, "exam", "{\"questions\":[]}");
  assert.match(key, /^imports\/exam\/\d+-[0-9a-f-]+\.json$/);
  assert.equal(objects.get(key).body, "{\"questions\":[]}");
  assert.equal(objects.get(key).options.httpMetadata.contentType, "application/json");

  const id = await recordImportLog(db, { examId: "exam", uploadedBy: "admin", r2ObjectKey: key, questionCount: 3, createdAt: NOW });
  assert.deepEqual({ ...sqlite.prepare("SELECT exam_id, uploaded_by, r2_object_key, question_count, created_at FROM import_logs WHERE id = ?").get(id) },
    { exam_id: "exam", uploaded_by: "admin", r2_object_key: key, question_count: 3, created_at: NOW });

  const expired = "imports/exam/expired.json";
  objects.set(expired, { body: "{}", uploaded: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) });
  objects.set("imports/other/expired.json", { body: "{}", uploaded: new Date(0) });
  await cleanOldImportArchives(bucket, "exam", key);
  assert.deepEqual([...objects.keys()].sort(), ["imports/other/expired.json", key].sort());
});
