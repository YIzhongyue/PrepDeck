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
const [{ questionsRouter }, { importsRouter }, { attemptsRouter, examAttemptsRouter }, { learningDetailRouter }, { questionTagsRouter }] = await Promise.all([
  bundle("../src/routes/questions.ts"), bundle("../src/routes/imports.ts"), bundle("../src/routes/attempts.ts"), bundle("../src/routes/learning.ts"), bundle("../src/routes/questionTags.ts")]);
const choice = { type: "single_choice", stem: "**Which** value is even?", options: [{ id: "A", text: "2" }, { id: "B", text: "3" }], correctAnswers: ["A"] };
function setup(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  db.exec("INSERT INTO users (id,email,role,created_at) VALUES ('admin','admin@test','admin','2026-09-09'); INSERT INTO exams(id,slug,name,created_at) VALUES ('exam','test','Test exam','2026-09-09')");
  const invalidations = [], pending = [];
  const DB = { prepare(sql) {
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
  assert.equal(invalidations.length, 4);
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
