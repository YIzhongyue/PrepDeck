import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Hono } from "hono";

async function bundle(path) {
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"] });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const [{ questionsRouter }, { importsRouter }, { attemptsRouter, examAttemptsRouter }, { learningDetailRouter }, { questionTagsRouter },
  { importConflict }, { getQuestion }] = await Promise.all([
  bundle("../src/routes/questions.ts"), bundle("../src/routes/imports.ts"), bundle("../src/routes/attempts.ts"), bundle("../src/routes/learning.ts"), bundle("../src/routes/questionTags.ts"),
  bundle("../src/lib/importConflicts.ts"), bundle("../src/lib/questionManagement.ts")]);

// Minimal D1 surface over node:sqlite, shared by `setup` below and by the
// migration test at the end of this file (which has no Worker app at all).
function d1(db) {
  return { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { const r = db.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; } };
  }, async batch(statements) {
    db.exec("BEGIN");
    try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec("COMMIT"); return result; }
    catch (err) { db.exec("ROLLBACK"); throw err; }
  } };
}
const choice = { type: "single_choice", stem: "**Which** value is even?", options: [{ id: "A", text: "2" }, { id: "B", text: "3" }], correctAnswers: ["A"] };
function setup(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  db.exec("INSERT INTO users (id,email,role,created_at) VALUES ('admin','admin@test','admin','2026-09-09'); INSERT INTO exams(id,slug,name,created_at) VALUES ('exam','test','Test exam','2026-09-09')");
  const invalidations = [], pending = [];
  const DB = d1(db);
  const env = { DB, KV: { delete: async key => invalidations.push(key) },
    IMPORT_VALIDATE_RATE_LIMITER: { limit: async () => ({ success: true }) }, IMPORT_EXECUTE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    BUCKET: { put: async () => {}, list: async () => ({ objects: [], truncated: false }) } };
  const app = new Hono();
  app.onError((err, c) => { throw new Error(err.message); });
  app.use("*", async (c, next) => { c.set("user", { id: "admin", role: c.req.header("x-role") ?? "admin" }); await next(); });
  app.route("/exams/:examId/questions", questionsRouter); app.route("/exams/:examId/import", importsRouter);
  app.route("/admin/question-tags", questionTagsRouter);
  app.route("/exams/:examId/attempts", examAttemptsRouter); app.route("/attempts", attemptsRouter); app.route("/questions/:questionId/learning-detail", learningDetailRouter);
  const request = async (path, method = "GET", body, role = "admin") => {
    const response = await app.request(`https://test${path}`, { method, headers: { "Content-Type": "application/json", "x-role": role }, body: body === undefined ? undefined : JSON.stringify(body) }, env, { waitUntil: p => pending.push(p), passThroughOnException() {} });
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data };
  };
  const create = async (overrides = {}) => { const response = await request("/exams/exam/questions", "POST", { ...choice, ...overrides }); assert.equal(response.status, 201, JSON.stringify(response.data)); return response.data.question; };
  const update = (q, body) => request(`/exams/exam/questions/${q.id}`, "PATCH", { expectedRevision: q.revision, ...body });
  const file = (questions, extra = {}) => ({ schemaVersion: "1.0", exam: { id: "test", name: "Test" }, questions, ...extra });
  return { db, DB, request, create, update, file, invalidations };
}

test("all four types can be created in an empty exam with stable IDs and sequential ordinals", async t => {
  const { create, invalidations } = setup(t);
  const rows = [await create(), await create({ type: "multiple_choice", correctAnswers: ["A", "B"] }),
    await create({ type: "true_false", options: [{ id: "true", text: "True" }, { id: "false", text: "False" }], correctAnswers: ["false"] }),
    await create({ type: "fill_blank", options: undefined, correctAnswers: ["answer", "variant"] })];
  assert.deepEqual(rows.map(q => q.sequenceNumber), [1, 2, 3, 4]); assert.equal(new Set(rows.map(q => q.id)).size, 4);
  assert.ok(rows.every(q => q.revision === 1 && q.answerRevision === 1 && q.answerRevisedAt === null));
  assert.equal(invalidations.filter(key => key === 'practice-questions:v2:exam').length, 4);
  assert.equal(invalidations.filter(key => key === 'practice-questions:exam').length, 4);
});
test("invalid payloads and non-admin writes cannot persist anything", async t => {
  const { request, db } = setup(t);
  for (const body of [null, [], { ...choice, stem: " " }, { ...choice, correctAnswers: ["missing"] }, { ...choice, type: "true_false" }]) {
    const res = await request("/exams/exam/questions", "POST", body); assert.equal(res.status, 422); assert.ok(res.data.issues.length);
  }
  assert.equal((await request("/exams/missing/questions", "POST", choice)).status, 404);
  for (const [path, method, body] of [["/exams/exam/questions", "POST", choice], ["/exams/exam/questions/id", "PATCH", choice], ["/exams/exam/questions/id", "DELETE"], ["/exams/exam/questions", "GET"]]) assert.equal((await request(path, method, body, "user")).status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM questions WHERE exam_id='exam'").get().n, 0);
});
test("partial edits preserve unrelated fields and stable IDs; stale edits cannot overwrite", async t => {
  const { create, update, request } = setup(t);
  const q = await create({ externalId: "Q1", tags: ["tag"], explanation: "why", difficulty: "hard", points: 0 });
  const res = await update(q, { stem: "New stem" }); assert.equal(res.status, 200);
  assert.equal(res.data.question.id, q.id); assert.equal(res.data.question.sequenceNumber, q.sequenceNumber);
  for (const field of ["externalId", "tags", "explanation", "difficulty", "points"]) assert.deepEqual(res.data.question[field], q[field]);
  assert.equal((await update(q, { stem: "Stale" })).status, 409);
  assert.equal((await request(`/exams/exam/questions/${q.id}`, "PATCH", { stem: "Unversioned" })).status, 409);
  assert.equal((await update(res.data.question, { externalId: null })).data.question.externalId, null);
});
test("Admin tag suggestions include the global catalog and unused tags without writing", async t => {
  const { db, create, request } = setup(t);
  db.exec("DELETE FROM question_tag_links; DELETE FROM question_bank_tags");
  assert.deepEqual((await request("/admin/question-tags")).data, { tags: [] });
  await create({ tags: ["Zulu", "Alpha"] });
  db.exec("INSERT INTO question_bank_tags(id,name,normalized_name,revision,created_at,updated_at) VALUES ('unused','Unused','unused',1,'2026-09-19','2026-09-19')");
  const before = db.prepare("SELECT total_changes() AS n").get().n;
  const result = await request("/admin/question-tags");
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { tags: ["Alpha", "Unused", "Zulu"] });
  assert.equal(db.prepare("SELECT total_changes() AS n").get().n, before);
});
test("non-admin tag discovery is rejected before querying the catalog", async t => {
  const { DB, request } = setup(t);
  DB.prepare = () => { throw new Error("Unauthorized catalog read"); };
  assert.equal((await request("/admin/question-tags", "GET", undefined, "user")).status, 403);
});
test("question tag saves reuse normalized identities and round-trip selected sets", async t => {
  const { db, create, update, request } = setup(t);
  const q = await create({ tags: ["Tag Identity", " #tag\tidentity ", "C, C++"] });
  assert.deepEqual(q.tags, ["C, C++", "Tag Identity"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM question_bank_tags WHERE normalized_name='tag identity'").get().n, 1);
  const saved = await update(q, { tags: ["TAG IDENTITY", "New\t topic"] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.question.tags, ["New topic", "Tag Identity"]);
  assert.deepEqual((await request(`/exams/exam/questions/${q.id}`)).data.question.tags, saved.data.question.tags);
  assert.equal(saved.data.question.answerRevision, q.answerRevision);
  const cleared = await update(saved.data.question, { tags: [] });
  assert.deepEqual(cleared.data.question.tags, []);
  assert.deepEqual((await request(`/exams/exam/questions/${q.id}`)).data.question.tags, []);
});
test("external IDs are unique per exam, optional, and protected by SQLite on insert and update", async t => {
  const { create, request, update } = setup(t); const q = await create({ externalId: "Q1" });
  const duplicate = await request("/exams/exam/questions", "POST", { ...choice, externalId: "Q1" });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.data.issues[0].path, "$.externalId");
  const second = await create(); assert.equal((await update(second, { externalId: "Q1" })).status, 409);
  assert.equal((await update(q, { explanation: "Still editable" })).status, 200);
});
test("pagination reaches beyond 200 and combines exact IDs, type, difficulty and exact tags", async t => {
  const { create, request } = setup(t); let last;
  for (let i = 0; i < 205; i++) last = await create({ externalId: `Q${i}`, tags: [i === 204 ? "100%_tag" : "other"], difficulty: "hard" });
  const page = await request("/exams/exam/questions?limit=50&offset=200"); assert.equal(page.data.total, 205); assert.equal(page.data.questions.length, 5);
  const filtered = await request(`/exams/exam/questions?q=${last.id}&type=single_choice&difficulty=hard&tag=100%25_tag`);
  assert.equal(filtered.data.questions[0].id, last.id); assert.equal(filtered.data.total, 1);
  assert.equal((await request("/exams/exam/questions?q=Q204")).data.total, 1);
  assert.equal((await request("/exams/exam/questions?tag=%25")).data.total, 0);
});
test("review state is a question field, not a tag: it round-trips, filters, and survives partial edits", async t => {
  const { create, request, update, db } = setup(t);
  const flagged = await create({ externalId: "R1", needsReview: true });
  const clean = await create({ externalId: "R2" });
  assert.equal(flagged.needsReview, true); assert.deepEqual(flagged.tags, []);
  assert.equal(clean.needsReview, false);
  // Nothing about the flag touches the tag catalog — that is the whole point
  // of issue #15.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM question_bank_tags").get().n, 0);
  const only = await request("/exams/exam/questions?needsReview=true");
  assert.deepEqual(only.data.questions.map(q => q.id), [flagged.id]);
  assert.deepEqual((await request("/exams/exam/questions?needsReview=false")).data.questions.map(q => q.id), [clean.id]);
  // An empty filter is "any review state", not needsReview=false.
  assert.equal((await request("/exams/exam/questions?needsReview=")).data.total, 2);
  assert.equal((await request("/exams/exam/questions?needsReview=nonsense")).data.total, 2);
  // A PATCH that never mentions the flag preserves it; one that does clears it.
  const edited = (await update(flagged, { explanation: "Checked the source" })).data.question;
  assert.equal(edited.needsReview, true);
  assert.equal((await update(edited, { needsReview: false })).data.question.needsReview, false);
  assert.equal((await request("/exams/exam/questions?needsReview=true")).data.total, 0);
  assert.equal((await request("/exams/exam/questions", "POST", { ...choice, externalId: "R3", needsReview: "yes" })).status, 422);
});
test("imports carry review state, and clearing it locally is a reviewable conflict rather than a silent reset", async t => {
  const { request, file, db, update } = setup(t);
  const incoming = { ...choice, externalId: "Q1", needsReview: true };
  assert.equal((await request("/exams/exam/import", "POST", file([incoming]))).data.created, 1);
  let q = (await request("/exams/exam/questions?q=Q1")).data.questions[0];
  assert.equal(q.needsReview, true);
  assert.equal(db.prepare("SELECT needs_review FROM questions WHERE id=?").get(q.id).needs_review, 1);
  // Re-importing the same file is still an identical skip.
  assert.equal((await request("/exams/exam/import", "POST", file([incoming]))).data.outcomes[0].reason, "identical");
  // Once an admin signs the question off, the same file no longer overwrites
  // that decision unattended: it surfaces as a conflict naming the field.
  q = (await update(q, { needsReview: false })).data.question;
  const again = await request("/exams/exam/import", "POST", file([incoming]));
  assert.equal(again.data.updated, 0);
  assert.equal(again.data.conflicts[0].reason, "locally_edited");
  assert.deepEqual(again.data.conflicts[0].differences, [{ field: "needsReview", current: false, incoming: true }]);
});
test("a baseline written before the review field existed is not mistaken for a local edit", async t => {
  const { request, file, db } = setup(t);
  const incoming = { ...choice, externalId: "Q1" };
  await request("/exams/exam/import", "POST", file([incoming]));
  const q = (await request("/exams/exam/questions?q=Q1")).data.questions[0];
  // Exactly what an import committed before issue #15 left behind: a baseline
  // payload with no needsReview key at all.
  const legacy = JSON.parse(db.prepare("SELECT import_baseline_json FROM questions WHERE id=?").get(q.id).import_baseline_json);
  delete legacy.needsReview;
  db.prepare("UPDATE questions SET import_baseline_json=? WHERE id=?").run(JSON.stringify(legacy), q.id);
  const preview = await request("/exams/exam/import/validate", "POST", file([{ ...incoming, stem: "Incoming" }]));
  assert.equal(preview.data.conflicts[0].reason, "incoming_changes");
});
test("answer revisions ignore formatting and order; content writes clear AI cache atomically", async t => {
  const { create, update, db } = setup(t);
  let q = await create({ type: "fill_blank", options: undefined, correctAnswers: ["Answer", "variant"] });
  db.prepare("INSERT INTO ai_explanations(question_id,provider,model,content,generated_at) VALUES (?,'openai','test','cached','now')").run(q.id);
  q = (await update(q, { tags: ["new"] })).data.question;
  assert.equal(q.answerRevision, 1); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_explanations WHERE question_id=?").get(q.id).n, 1);
  q = (await update(q, { correctAnswers: ["VARIANT", " answer "] })).data.question;
  assert.equal(q.answerRevision, 1); assert.equal(q.answerRevisedAt, null);
  q = (await update(q, { correctAnswers: ["new"] })).data.question;
  assert.equal(q.answerRevision, 2); assert.ok(q.answerRevisedAt);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_explanations WHERE question_id=?").get(q.id).n, 0);
});
test("re-import preserves edited and legacy content, returns diffs, and applies only exact reviewed resolutions", async t => {
  const { create, update, request, file } = setup(t); let q = await create({ externalId: "Q1" });
  const incoming = { ...choice, externalId: "Q1", stem: "Incoming", correctAnswers: ["B"] };
  const preview = await request("/exams/exam/import/validate", "POST", file([incoming]));
  const conflict = preview.data.conflicts[0]; assert.equal(conflict.questionId, q.id); assert.equal(conflict.reason, "unknown_provenance");
  let imported = await request("/exams/exam/import?duplicateStrategy=overwrite", "POST", file([incoming]));
  assert.equal(imported.data.updated, 0); assert.equal(imported.data.conflicts.length, 1);
  imported = await request("/exams/exam/import", "POST", file([incoming], { conflictResolutions: [{ ...conflict, action: "apply" }] }));
  assert.equal(imported.data.updated, 1); q = (await request(`/exams/exam/questions/${q.id}`)).data.question;
  assert.equal(q.answerRevision, 2); assert.equal(q.stem, "Incoming");
  // Identical retry is safely skipped, even though the resolution is now stale.
  assert.equal((await request("/exams/exam/import", "POST", file([incoming], { conflictResolutions: [{ ...conflict, action: "apply" }] }))).data.updated, 0);
  q = (await update(q, { stem: "Admin correction" })).data.question;
  imported = await request("/exams/exam/import", "POST", file([incoming], { conflictResolutions: [{ ...conflict, action: "apply" }] }));
  assert.equal(imported.data.updated, 0); assert.equal(imported.data.conflicts[0].reason, "locally_edited");
  const fresh = imported.data.conflicts[0];
  imported = await request("/exams/exam/import", "POST", file([{ ...incoming, stem: "Unreviewed" }], { conflictResolutions: [{ ...fresh, action: "apply" }] }));
  assert.equal(imported.data.updated, 0);
});
test("import creates with provenance; keep resolution and imported edits use the same records", async t => {
  const { request, file, db, update } = setup(t);
  const imported = await request("/exams/exam/import", "POST", file([{ ...choice, externalId: "Q1" }, { ...choice, externalId: "Q2" }]));
  assert.equal(imported.data.created, 2);
  const q = (await request("/exams/exam/questions?q=Q1")).data.questions[0];
  assert.ok(db.prepare("SELECT import_baseline_json FROM questions WHERE id=?").get(q.id).import_baseline_json);
  assert.equal((await update(q, { explanation: "Manual edit" })).status, 200);
  const preview = (await request("/exams/exam/import/validate", "POST", file([{ ...choice, externalId: "Q1" }]))).data;
  const kept = await request("/exams/exam/import", "POST", file([{ ...choice, externalId: "Q1" }], { conflictResolutions: [{ ...preview.conflicts[0], action: "keep" }] }));
  assert.equal(kept.data.outcomes[0].reason, "kept_current");
});
for (const mode of ["practice", "mock"]) test(`${mode} answer correction preserves historical scores and snapshots; future attempts use new key`, async t => {
  const { create, update, request, db } = setup(t); let q = await create();
  const start = async () => (await request("/exams/exam/attempts", "POST", { mode, questionIds: [q.id] })).data.attemptId;
  const answer = (id, selected) => mode === "practice" ? request(`/attempts/${id}/answers`, "POST", { questionId: q.id, selectedAnswer: selected }) : request(`/attempts/${id}/answers/${q.id}`, "PUT", { selectedAnswer: selected });
  const id = await start(); await answer(id, ["A"]);
  const before = (await request(`/attempts/${id}/complete`, "POST")).data; assert.equal(before.score, 100);
  q = (await update(q, { correctAnswers: ["B"] })).data.question;
  const after = (await request(`/attempts/${id}/complete`, "POST")).data;
  assert.equal(after.score, 100); assert.equal(after.correctCount, 1); assert.deepEqual(after.breakdown[0].gradedAnswers, ["A"]); assert.deepEqual(after.breakdown[0].correctAnswers, ["B"]);
  assert.equal(after.breakdown[0].answerRevision, 1); assert.equal(after.breakdown[0].currentAnswerRevision, 2);
  const second = await start(); await answer(second, ["B"]); assert.equal((await request(`/attempts/${second}/complete`, "POST")).data.score, 100);
  // Legacy rows retain unknown historical keys rather than inventing one.
  db.prepare("UPDATE attempt_answers SET answer_revision=NULL, graded_answers_json=NULL WHERE attempt_id=?").run(id);
  const detail = (await request(`/questions/${q.id}/learning-detail`)).data;
  assert.ok(detail.history.some(h => h.answerRevision === null && h.gradedAnswers === null));
  assert.equal((await request(`/exams/exam/questions/${q.id}`, "DELETE")).status, 409);
});
test("dependent bookmarks prevent deletion without cascades; unused questions can be deleted", async t => {
  const { create, request, db } = setup(t); const q = await create();
  db.prepare("INSERT INTO bookmarks(user_id,question_id,created_at) VALUES ('admin',?,'now')").run(q.id);
  assert.equal((await request(`/exams/exam/questions/${q.id}`, "DELETE")).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bookmarks WHERE question_id=?").get(q.id).n, 1);
  const unused = await create(); assert.equal((await request(`/exams/exam/questions/${unused.id}`, "DELETE")).status, 204);
});

test("ungraded attempt question lists also prevent deletion", async t => {
  const { create, request } = setup(t); const q = await create();
  await request("/exams/exam/attempts", "POST", { mode: "mock", questionIds: [q.id] });
  assert.equal((await request(`/exams/exam/questions/${q.id}`, "DELETE")).status, 409);
});

test("an explicitly accepted imported answer correction preserves historical scores", async t => {
  const { create, request, file } = setup(t); const q = await create({ externalId: "Q1" });
  const id = (await request("/exams/exam/attempts", "POST", { mode: "practice", questionIds: [q.id] })).data.attemptId;
  await request(`/attempts/${id}/answers`, "POST", { questionId: q.id, selectedAnswer: ["A"] });
  await request(`/attempts/${id}/complete`, "POST");
  const incoming = { ...choice, externalId: "Q1", correctAnswers: ["B"] };
  const conflict = (await request("/exams/exam/import/validate", "POST", file([incoming]))).data.conflicts[0];
  const result = await request("/exams/exam/import", "POST", file([incoming], { conflictResolutions: [{ ...conflict, action: "apply" }] }));
  assert.equal(result.data.updated, 1);
  const history = (await request(`/attempts/${id}/complete`, "POST")).data;
  assert.equal(history.score, 100); assert.equal(history.breakdown[0].isCorrect, true);
  assert.deepEqual(history.breakdown[0].gradedAnswers, ["A"]); assert.deepEqual(history.breakdown[0].correctAnswers, ["B"]);
});

test("import reports rolled-back batches and successful later batches separately", async t => {
  const { DB, request, file, db } = setup(t);
  const original = DB.batch; let batches = 0;
  DB.batch = async statements => { if (++batches === 1) throw new Error("Simulated D1 failure"); return original(statements); };
  const data = file(Array.from({ length: 51 }, (_, i) => ({ ...choice, externalId: `Q${i}` })));
  const result = (await request("/exams/exam/import", "POST", data)).data;
  assert.equal(result.failed, 50); assert.equal(result.created, 1);
  assert.equal(result.outcomes.filter(o => o.status === "failed").length, 50);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM questions WHERE exam_id='exam'").get().n, 1);
  // Only retry failed rows; successful rows keep their stable identity.
  const id = result.outcomes.find(o => o.status === "created").questionId;
  const retry = (await request("/exams/exam/import", "POST", data)).data;
  assert.equal(retry.created, 50); assert.equal(retry.skipped, 1);
  assert.ok(retry.outcomes.some(o => o.questionId === id && o.status === "skipped"));
});

test("revision compare-and-set catches a race after reading the existing question", async t => {
  const { create, update, DB, db } = setup(t); const q = await create();
  const prepare = DB.prepare;
  DB.prepare = sql => {
    if (sql.startsWith("UPDATE questions SET")) db.prepare("UPDATE questions SET revision=revision+1, stem='Concurrent edit' WHERE id=?").run(q.id);
    return prepare(sql);
  };
  assert.equal((await update(q, { stem: "Lost update" })).status, 409);
  assert.equal(db.prepare("SELECT stem FROM questions WHERE id=?").get(q.id).stem, "Concurrent edit");
});

for (const name of ["reading", "code", "case-with-figure", "combination", ...(process.env.COMPONENT_SOURCE_FILES?.split(",") ?? [])]) test(`component ${name}: REST preview/import/storage/export and server grading preserve semantics`, async t => {
  const f = setup(t);
  const file = JSON.parse(readFileSync(name.startsWith("/") ? name : new URL(`../../../tests/fixtures/components/${name}.json`, import.meta.url), "utf8"));
  const preview = await f.request('/exams/exam/import/validate', 'POST', file);
  assert.equal(preview.data.valid, true, JSON.stringify(preview.data));
  const imported = await f.request('/exams/exam/import', 'POST', file);
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  assert.equal(imported.data.created, file.questions.length);
  const stored = (await f.request('/exams/exam/questions')).data.questions;
  assert.ok(stored.every(q => q.content && !JSON.stringify(q.content).includes('correctAnswers')));
  const exported = await f.request('/exams/exam/questions/export');
  assert.equal(exported.status, 200);
  assert.deepEqual(exported.data.file.questions.map(q => q.interaction), file.questions.map(q => q.interaction));
  assert.deepEqual(exported.data.file.assets, file.assets ?? []);
  assert.deepEqual(exported.data.file.stimuli, file.stimuli ?? []);
  const again = await f.request('/exams/exam/import', 'POST', exported.data.file);
  assert.equal(again.data.created, 0); assert.equal(again.data.skipped, stored.length);
  const attempt = await f.request('/exams/exam/attempts', 'POST', { mode: 'practice', questionIds: stored.map(q => q.id) });
  assert.equal(attempt.status, 201, JSON.stringify(attempt.data));
  for (const q of stored) {
    const graded = await f.request(`/attempts/${attempt.data.attemptId}/answers`, 'POST', { questionId: q.id, selectedAnswer: q.correctAnswers });
    assert.equal(graded.status, 200, JSON.stringify(graded.data)); assert.equal(graded.data.isCorrect, true);
  }
  const q = stored[0];
  const changed = structuredClone(q.content); changed.body[0].text += ' revised';
  assert.equal((await f.update(q, { stem: 'flattened replacement' })).status, 422);
  assert.equal((await f.request('/exams/exam/questions/export', 'GET', undefined, 'user')).status, 403);
});

test('component export requires stable external IDs and re-import preserves legacy row identities and review state', async t => {
  const { create, update, request, db } = setup(t);
  const legacy = await create({ needsReview: true });
  const identified = await create({ externalId: 'existing-id' });
  const before = db.prepare('SELECT * FROM questions ORDER BY id').all();
  const blocked = await request('/exams/exam/questions/export');
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /external ID/i);
  assert.equal(blocked.data.file, undefined);
  assert.deepEqual(db.prepare('SELECT * FROM questions ORDER BY id').all(), before);

  assert.equal((await update(legacy, { externalId: 'legacy-id' })).status, 200);
  const exported = await request('/exams/exam/questions/export');
  assert.equal(exported.status, 200, JSON.stringify(exported.data));
  assert.equal(exported.data.file.questions.find(q => q.externalId === 'legacy-id').needsReview, true);
  const preview = await request('/exams/exam/import/validate', 'POST', exported.data.file);
  assert.equal(preview.data.valid, true);
  assert.equal(preview.data.conflicts.length, 2);
  const conflictResolutions = preview.data.conflicts.map(({ questionId, expectedRevision, incomingToken }) => ({ questionId, expectedRevision, incomingToken, action: 'apply' }));
  const imported = await request('/exams/exam/import', 'POST', { ...exported.data.file, conflictResolutions });
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  assert.equal(imported.data.created, 0);
  assert.equal(imported.data.updated, 2);
  const stored = (await request('/exams/exam/questions')).data.questions;
  assert.deepEqual(stored.map(q => q.id).sort(), [legacy.id, identified.id].sort());
  assert.equal(stored.find(q => q.id === legacy.id).needsReview, true);
  const again = await request('/exams/exam/import', 'POST', (await request('/exams/exam/questions/export')).data.file);
  assert.equal(again.data.created, 0);
  assert.equal(again.data.skipped, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM questions').get().n, 2);
});

test('component re-import requires reviewed conflicts and preserves earlier grading after an ordering correction', async t => {
  const f = setup(t);
  const file = JSON.parse(readFileSync(new URL('../../../tests/fixtures/components/code.json', import.meta.url), 'utf8'));
  assert.equal((await f.request('/exams/exam/import', 'POST', file)).status, 201);
  const q = (await f.request('/exams/exam/questions')).data.questions[0];
  const attemptId = (await f.request('/exams/exam/attempts', 'POST', { mode: 'practice', questionIds: [q.id] })).data.attemptId;
  await f.request(`/attempts/${attemptId}/answers`, 'POST', { questionId: q.id, selectedAnswer: q.correctAnswers });
  await f.request(`/attempts/${attemptId}/complete`, 'POST');
  file.questions[0].scoring.correctAnswers.reverse();
  file.questions[0].body[0].text = 'Revised ordering task';
  const preview = await f.request('/exams/exam/import/validate', 'POST', file);
  assert.equal(preview.data.conflicts.length, 1);
  const conflict = preview.data.conflicts[0];
  assert.ok(conflict.differences.some(d => d.field === 'content'));
  assert.equal((await f.request('/exams/exam/import', 'POST', file)).data.skipped, 1);
  const applied = await f.request('/exams/exam/import', 'POST', { ...file, conflictResolutions: [{ questionId: q.id, expectedRevision: conflict.expectedRevision, incomingToken: conflict.incomingToken, action: 'apply' }] });
  assert.equal(applied.data.updated, 1, JSON.stringify(applied.data));
  const revised = (await f.request(`/exams/exam/questions/${q.id}`)).data.question;
  assert.equal(revised.answerRevision, q.answerRevision + 1);
  assert.deepEqual(revised.correctAnswers, file.questions[0].scoring.correctAnswers);
  const detail = (await f.request(`/attempts/${attemptId}/complete`, "POST")).data;
  assert.equal(detail.breakdown[0].isCorrect, true);
  assert.deepEqual(detail.breakdown[0].gradedAnswers, q.correctAnswers);
  assert.deepEqual(detail.breakdown[0].correctAnswers, revised.correctAnswers);
});

// Issue #15's data migration, exercised on its own: `setup` above applies the
// whole migration directory at once, which can never show that 0033 carries
// pre-existing tag state across. Here the questions are tagged and given import
// baselines FIRST, under the schema as it stood at 0032, and only then is 0033
// applied — and the result is fed to the real conflict classifier, because the
// columns looking right matters only insofar as the next import behaves.
test("0033 migrates legacy needs_review tag state onto the column and retires the tag", async t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const directory = new URL("../../../migrations/", import.meta.url);
  const names = readdirSync(directory).filter(n => n.endsWith(".sql")).sort();
  const migration = "0033_question_needs_review.sql";
  for (const name of names.filter(n => n < migration)) db.exec(readFileSync(new URL(name, directory), "utf8"));
  db.exec("INSERT INTO exams(id,slug,name,created_at) VALUES ('exam','test','Test exam','2026-09-09')");
  const options = [{ id: "A", text: "2" }, { id: "B", text: "3" }];
  // Exactly the shape payloadOf/canonical produced before this migration: no
  // needsReview key, and the review state spelled as one of the tag names.
  const legacyBaseline = (externalId, stem, tags) => JSON.stringify({
    externalId, type: "single_choice", stem, options, correctAnswers: ["A"],
    explanation: null, difficulty: null, tags, points: 1,
  });
  const question = (id, externalId, stem, baseline, baselineTagIds) => db.prepare(
    `INSERT INTO questions(id,exam_id,external_id,type,stem,options_json,correct_answers_json,created_at,updated_at,
      import_baseline_json,import_baseline_tag_ids_json)
     VALUES (?,?,?,'single_choice',?,?,'["A"]','2026-09-09','2026-09-09',?,?)`,
  ).run(id, "exam", externalId, stem, JSON.stringify(options), baseline, baselineTagIds);

  // Imported carrying the review tag, untouched since. Its next import must
  // stay an ordinary incoming change.
  question("tagged", "Q1", "Stem", legacyBaseline("Q1", "Stem", ["AWS", "Needs Review"]), '["t1","t2"]');
  // Imported carrying the tag, then genuinely edited locally afterwards.
  question("edited", "Q2", "Admin correction", legacyBaseline("Q2", "Stem", ["Needs Review"]), '["t1"]');
  // Imported CLEAN and tagged for review by hand afterwards — that really is a
  // local edit, and must keep reporting as one.
  question("tagged-later", "Q3", "Stem", legacyBaseline("Q3", "Stem", []), '[]');
  // A pre-0027 import: baseline payload but no id snapshot at all, so the tag
  // name inside it is the only evidence of what was imported.
  question("legacy-baseline", "Q4", "Stem", legacyBaseline("Q4", "Stem", ["#Needs   Review"]), null);
  // Never imported at all.
  question("hand-authored", "Q5", "Stem", null, null);

  // Whatever casing/spacing an admin happened to create the tag with resolves
  // to the same normalized identity 0026 keys the catalog on.
  db.prepare("INSERT INTO question_bank_tags(id,name,normalized_name,revision,created_at,updated_at) VALUES ('t1','Needs Review','needs review',1,'2026-09-09','2026-09-09')").run();
  db.prepare("INSERT INTO question_bank_tags(id,name,normalized_name,revision,created_at,updated_at) VALUES ('t2','AWS','aws',1,'2026-09-09','2026-09-09')").run();
  for (const [questionId, tagId] of [["tagged", "t1"], ["tagged", "t2"], ["edited", "t1"], ["tagged-later", "t1"],
    ["legacy-baseline", "t1"], ["hand-authored", "t2"]]) {
    db.prepare("INSERT INTO question_tag_links(question_id,tag_id) VALUES (?,?)").run(questionId, tagId);
  }

  db.exec(readFileSync(new URL(migration, directory), "utf8"));
  db.exec(readFileSync(new URL("0034_question_components.sql", directory), "utf8"));

  // node:sqlite hands back null-prototype rows; compare plain objects.
  const rows = (sql) => db.prepare(sql).all().map(row => ({ ...row }));
  assert.deepEqual(rows("SELECT id, needs_review FROM questions ORDER BY id"), [
    { id: "edited", needs_review: 1 }, { id: "hand-authored", needs_review: 0 }, { id: "legacy-baseline", needs_review: 1 },
    { id: "tagged", needs_review: 1 }, { id: "tagged-later", needs_review: 1 }]);
  // The legacy tag is gone everywhere; unrelated taxonomy is untouched.
  assert.deepEqual(rows("SELECT id FROM question_bank_tags ORDER BY id"), [{ id: "t2" }]);
  assert.deepEqual(rows("SELECT question_id, tag_id FROM question_tag_links ORDER BY question_id"),
    [{ question_id: "hand-authored", tag_id: "t2" }, { question_id: "tagged", tag_id: "t2" }]);
  // Scratch tables do not outlive the migration.
  assert.deepEqual(rows("SELECT name FROM sqlite_master WHERE substr(name, 1, 1) = '_'"), []);

  // The baselines now describe the same world the rows do: review state as a
  // field, and no reference to the retired tag in either snapshot.
  assert.deepEqual(rows(`SELECT id, json_extract(import_baseline_json,'$.needsReview') AS flag,
      json_extract(import_baseline_json,'$.tags') AS tags, import_baseline_tag_ids_json AS ids FROM questions ORDER BY id`), [
    { id: "edited", flag: 1, tags: "[]", ids: "[]" },
    { id: "hand-authored", flag: null, tags: null, ids: null },
    { id: "legacy-baseline", flag: 1, tags: "[]", ids: null },
    { id: "tagged", flag: 1, tags: '["AWS"]', ids: '["t2"]' },
    { id: "tagged-later", flag: 0, tags: "[]", ids: "[]" },
  ]);

  // What actually matters: what the next import reports. An untouched,
  // previously review-tagged question is an ordinary incoming change; only the
  // rows a human really did change are `locally_edited`.
  const DB = d1(db);
  const reasonFor = async (id, externalId) => {
    const row = await getQuestion(DB, "exam", id);
    const incoming = { externalId, type: "single_choice", stem: "Incoming", options, correctAnswers: ["A"],
      explanation: null, difficulty: null, tags: id === "tagged" ? ["AWS"] : [], points: 1 };
    return (await importConflict(DB, row, incoming, false)).reason;
  };
  assert.equal(await reasonFor("tagged", "Q1"), "incoming_changes");
  assert.equal(await reasonFor("legacy-baseline", "Q4"), "incoming_changes");
  assert.equal(await reasonFor("edited", "Q2"), "locally_edited");
  assert.equal(await reasonFor("tagged-later", "Q3"), "locally_edited");
  assert.equal(await reasonFor("hand-authored", "Q5"), "unknown_provenance");
});
