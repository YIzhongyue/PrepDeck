// Issue #119 — per-user, per-question studied status: what marks a question
// studied, what may not undo a manual reset, and what the backfill infers.
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
const [{ questionsRouter }, { attemptsRouter, examAttemptsRouter }, { studyStatusRouter }, { learningDetailRouter }] = await Promise.all([
  bundle("../src/routes/questions.ts"), bundle("../src/routes/attempts.ts"), bundle("../src/routes/studyStatus.ts"), bundle("../src/routes/learning.ts")]);

const migrationsDir = new URL("../../../migrations/", import.meta.url);
const migrations = readdirSync(migrationsDir).filter(n => n.endsWith(".sql")).sort();
const STUDY_MIGRATION = "0046_question_study_status.sql";
const applyMigrations = (db, filter) => {
  for (const name of migrations.filter(filter)) db.exec(readFileSync(new URL(name, migrationsDir), "utf8"));
};

function wrap(db) {
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

function setup(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  applyMigrations(db, () => true);
  db.exec(`INSERT INTO users (id,email,role,created_at) VALUES ('admin','admin@test','admin','2026-09-09'), ('other','other@test','user','2026-09-09');
    INSERT INTO exams(id,slug,name,created_at) VALUES ('exam','test','Test exam','2026-09-09'), ('exam2','test2','Second exam','2026-09-09')`);
  const env = { DB: wrap(db), KV: { delete: async () => {}, get: async () => null, put: async () => {} } };
  let user = "admin";
  const app = new Hono();
  app.onError((err) => { throw new Error(err.message); });
  app.use("*", async (c, next) => { c.set("user", { id: user, role: user === "admin" ? "admin" : "user" }); await next(); });
  app.route("/exams/:examId/questions", questionsRouter);
  app.route("/exams/:examId/attempts", examAttemptsRouter);
  app.route("/exams/:examId/study-status", studyStatusRouter);
  app.route("/questions/:questionId/learning-detail", learningDetailRouter);
  app.route("/attempts", attemptsRouter);
  const request = async (path, method = "GET", body) => {
    const response = await app.request(`https://test${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env, { waitUntil() {}, passThroughOnException() {} });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  };
  const addQuestion = async (overrides = {}, examId = "exam") => {
    const previous = user; user = "admin";
    const response = await request(`/exams/${examId}/questions`, "POST", {
      type: "single_choice", stem: "Which value is even?",
      options: [{ id: "A", text: "2" }, { id: "B", text: "3" }], correctAnswers: ["A"], ...overrides,
    });
    user = previous;
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.question;
  };
  const start = async (mode, questionIds) => {
    const response = await request("/exams/exam/attempts", "POST", { mode, questionIds });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.attemptId;
  };
  const statuses = async (examId = "exam") => {
    const { status, data } = await request(`/exams/${examId}/study-status`);
    assert.equal(status, 200);
    return Object.fromEntries(data.statuses.map(s => [s.questionId, s.status]));
  };
  const view = (questionId, expectedRevision) => request(`/exams/exam/study-status/${questionId}/learning-view`, "POST", { expectedRevision });
  const setStatus = (questionId, status) => request(`/exams/exam/study-status/${questionId}`, "PUT", { status });
  return { db, request, addQuestion, start, statuses, view, setStatus, as: id => { user = id; } };
}

test("a Learning view marks only that question, and repeating it changes nothing", async t => {
  const { addQuestion, statuses, view } = setup(t);
  const [shown, other] = [await addQuestion(), await addQuestion()];
  assert.deepEqual(await statuses(), {}, "a question with no entry is unstudied");

  const first = await view(shown.id, 0);
  assert.equal(first.status, 200);
  assert.equal(first.data.applied, true);
  assert.deepEqual({ status: first.data.status.status, revision: first.data.status.revision }, { status: "studied", revision: 1 });

  const again = await view(shown.id, 1);
  assert.equal(again.data.applied, false, "already studied: idempotent");
  assert.equal(again.data.status.revision, 1, "a no-op does not move the revision");
  assert.deepEqual(await statuses(), { [shown.id]: "studied" });
  assert.equal((await statuses())[other.id], undefined);
});

test("a manual reset outlasts stale and retried visits, and a later visit may mark it again", async t => {
  const { addQuestion, statuses, view, setStatus } = setup(t);
  const question = await addQuestion();
  await view(question.id, 0);

  const reset = await setStatus(question.id, "unstudied");
  assert.equal(reset.status, 200);
  assert.deepEqual({ status: reset.data.status.status, revision: reset.data.status.revision }, { status: "unstudied", revision: 2 });

  // The visit that preceded the reset arriving late, or a retry of it.
  for (const expectedRevision of [0, 1]) {
    const stale = await view(question.id, expectedRevision);
    assert.equal(stale.data.applied, false);
    assert.equal(stale.data.status.status, "unstudied");
  }
  assert.deepEqual(await statuses(), { [question.id]: "unstudied" }, "the explicit unstudied entry is kept");

  const revisit = await view(question.id, reset.data.status.revision);
  assert.equal(revisit.data.applied, true);
  assert.deepEqual(await statuses(), { [question.id]: "studied" });
});

test("manual writes validate the status, the exam and the question's exam", async t => {
  const { addQuestion, setStatus, view, request } = setup(t);
  const question = await addQuestion();
  const elsewhere = await addQuestion({}, "exam2");
  assert.equal((await setStatus(question.id, "mastered")).status, 400);
  assert.equal((await view(question.id, -1)).status, 400);
  assert.equal((await view(question.id, "0")).status, 400);
  assert.equal((await setStatus(elsewhere.id, "studied")).status, 404, "a question from another exam");
  assert.equal((await request(`/exams/missing/study-status/${question.id}`, "PUT", { status: "studied" })).status, 404);
  assert.equal((await request("/exams/missing/study-status")).status, 404);
});

test("a Learning-only visit is studied but unattempted, and creates no attempt", async t => {
  const { db, addQuestion, view, request } = setup(t);
  const question = await addQuestion();
  await view(question.id, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempt_answers").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wrong_question_book").get().n, 0);
  const detail = await request(`/questions/${question.id}/learning-detail`);
  assert.deepEqual(detail.data.history, []);
});

test("a recorded Practice answer marks the question studied whether right or wrong, even after a reset", async t => {
  const { addQuestion, start, statuses, request, setStatus } = setup(t);
  const [right, wrong, blank] = [await addQuestion(), await addQuestion(), await addQuestion({ type: "fill_blank", options: undefined, correctAnswers: ["green"] })];
  await setStatus(wrong.id, "unstudied");
  const attempt = await start("practice", [right.id, wrong.id, blank.id]);

  const answered = await request(`/attempts/${attempt}/answers`, "POST", { questionId: right.id, selectedAnswer: ["A"] });
  assert.equal(answered.data.isCorrect, true);
  assert.equal(answered.data.studyStatus.status, "studied", "the REST response carries the new status");
  await request(`/attempts/${attempt}/answers`, "POST", { questionId: wrong.id, selectedAnswer: ["B"] });
  // A blank fill-in is a skipped question, not an answer.
  await request(`/attempts/${attempt}/answers`, "POST", { questionId: blank.id, selectedAnswer: ["  "] });

  assert.deepEqual(await statuses(), { [right.id]: "studied", [wrong.id]: "studied" });
});

test("replaying a Practice answer after a reset does not mark it again", async t => {
  const { addQuestion, start, statuses, request, setStatus } = setup(t);
  const question = await addQuestion();
  const attempt = await start("practice", [question.id]);
  await request(`/attempts/${attempt}/answers`, "POST", { questionId: question.id, selectedAnswer: ["B"] });
  await setStatus(question.id, "unstudied");

  const replay = await request(`/attempts/${attempt}/answers`, "POST", { questionId: question.id, selectedAnswer: ["B"] });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.studyStatus.status, "unstudied");
  assert.deepEqual(await statuses(), { [question.id]: "unstudied" });
});

test("a saved Mock draft marks its question; a cleared draft, a skipped question or a replayed draft does not", async t => {
  const { addQuestion, start, statuses, request, setStatus } = setup(t);
  const [answered, cleared, skipped] = [await addQuestion(), await addQuestion({ type: "fill_blank", options: undefined, correctAnswers: ["green"] }), await addQuestion()];
  const attempt = await start("mock", [answered.id, cleared.id, skipped.id]);
  assert.deepEqual(await statuses(), {}, "allocating a question to a mock is not studying it");

  const saved = await request(`/attempts/${attempt}/answers/${answered.id}`, "PUT", { selectedAnswer: ["B"] });
  assert.equal(saved.data.studyStatus.status, "studied");
  await request(`/attempts/${attempt}/answers/${cleared.id}`, "PUT", { selectedAnswer: [""] });
  assert.deepEqual(await statuses(), { [answered.id]: "studied" });

  await setStatus(answered.id, "unstudied");
  const replayed = await request(`/attempts/${attempt}/answers/${answered.id}`, "PUT", { selectedAnswer: ["B"] });
  assert.equal(replayed.data.studyStatus.status, "unstudied", "the same answer saved again is a retry");
  const changed = await request(`/attempts/${attempt}/answers/${answered.id}`, "PUT", { selectedAnswer: ["A"] });
  assert.equal(changed.data.studyStatus.status, "studied", "a different answer is a new one");

  // A reset during the attempt survives submission; the skipped and cleared
  // questions are graded incorrect but were never answered.
  await setStatus(answered.id, "unstudied");
  const completed = await request(`/attempts/${attempt}/complete`, "POST");
  assert.equal(completed.status, 200);
  assert.deepEqual(await statuses(), { [answered.id]: "unstudied" });
});

test("Mock completion reconciles answered drafts that were never marked", async t => {
  const { db, addQuestion, start, statuses, request } = setup(t);
  const [answered, skipped] = [await addQuestion(), await addQuestion()];
  const attempt = await start("mock", [answered.id, skipped.id]);
  // A draft saved before drafts marked anything.
  db.prepare("UPDATE attempts SET draft_answers_json = ? WHERE id = ?").run(JSON.stringify({ [answered.id]: ["B"], [skipped.id]: [] }), attempt);

  assert.equal((await request(`/attempts/${attempt}/complete`, "POST")).status, 200);
  assert.deepEqual(await statuses(), { [answered.id]: "studied" });
});

test("statuses are isolated between users and between exams", async t => {
  const { addQuestion, statuses, view, as } = setup(t);
  const [mine, otherExam] = [await addQuestion(), await addQuestion({}, "exam2")];
  await view(mine.id, 0);

  as("other");
  assert.deepEqual(await statuses(), {}, "another user sees none of mine");
  as("admin");
  assert.deepEqual(await statuses("exam2"), {}, "another exam lists none of this exam's");
  assert.equal((await statuses())[otherExam.id], undefined);
});

test("deleting an unanswered question drops its statuses instead of blocking the delete", async t => {
  const { db, addQuestion, view, request } = setup(t);
  db.exec("PRAGMA foreign_keys = ON");
  const question = await addQuestion();
  await view(question.id, 0);
  assert.equal((await request(`/exams/exam/questions/${question.id}`, "DELETE")).status, 204);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_question_study_status").get().n, 0);
});

test("the backfill covers genuine answers and open drafts, never skipped questions or the resume pointer", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  applyMigrations(db, name => name < STUDY_MIGRATION);
  db.exec(`
    INSERT INTO users (id,email,role,created_at) VALUES ('u','u@test','user','2026-01-01');
    INSERT INTO exams (id,slug,name,created_at) VALUES ('e','e','E','2026-01-01');
    INSERT INTO questions (id, exam_id, type, stem, options_json, correct_answers_json, created_at, updated_at, sequence_number) VALUES
      ('answered', 'e', 'single_choice', 's', '[{"id":"A","text":"a"}]', '["A"]', '2026-01-01', '2026-01-01', 1),
      ('skipped', 'e', 'single_choice', 's', '[{"id":"A","text":"a"}]', '["A"]', '2026-01-01', '2026-01-01', 2),
      ('blank', 'e', 'fill_blank', 's', NULL, '["x"]', '2026-01-01', '2026-01-01', 3),
      ('drafted', 'e', 'single_choice', 's', '[{"id":"A","text":"a"}]', '["A"]', '2026-01-01', '2026-01-01', 4),
      ('draft-blank', 'e', 'fill_blank', 's', NULL, '["x"]', '2026-01-01', '2026-01-01', 5),
      ('typed', 'e', 'fill_blank', 's', NULL, '["x"]', '2026-01-01', '2026-01-01', 6),
      ('passed', 'e', 'single_choice', 's', '[{"id":"A","text":"a"}]', '["A"]', '2026-01-01', '2026-01-01', 7);
    INSERT INTO attempts (id, user_id, exam_id, mode, started_at, completed_at, total_questions, question_ids_json) VALUES
      ('done', 'u', 'e', 'mock', '2026-02-01', '2026-02-01T01:00:00Z', 4, '["answered","skipped","blank","typed"]'),
      ('open', 'u', 'e', 'mock', '2026-03-01', NULL, 2, '["drafted","draft-blank"]');
    INSERT INTO attempt_answers (id, attempt_id, question_id, selected_answer_json, is_correct) VALUES
      ('a1', 'done', 'answered', '["A"]', 1), ('a2', 'done', 'skipped', '[]', 0),
      ('a3', 'done', 'blank', '["  "]', 0), ('a4', 'done', 'typed', '["nope"]', 0);
    UPDATE attempts SET draft_answers_json = '{"drafted":["A"],"draft-blank":[""],"stray":["A"]}' WHERE id = 'open';
    INSERT INTO learning_progress (user_id, exam_id, last_sequence_number, updated_at) VALUES ('u', 'e', 7, '2026-03-02');
  `);
  applyMigrations(db, name => name === STUDY_MIGRATION);

  const rows = db.prepare("SELECT question_id, status, source FROM user_question_study_status ORDER BY question_id").all().map(r => ({ ...r }));
  assert.deepEqual(rows, [
    { question_id: "answered", status: "studied", source: "backfill" },
    { question_id: "drafted", status: "studied", source: "backfill" },
    { question_id: "typed", status: "studied", source: "backfill" },
  ]);
  assert.equal(db.prepare("SELECT last_sequence_number AS n FROM learning_progress").get().n, 7, "the resume position is preserved");

  // Rerunning the backfill must not overwrite a reset made since.
  db.exec("UPDATE user_question_study_status SET status = 'unstudied', source = 'manual', revision = 2 WHERE question_id = 'answered'");
  const sql = readFileSync(new URL(STUDY_MIGRATION, migrationsDir), "utf8");
  db.exec(sql.slice(sql.indexOf("INSERT INTO user_question_study_status")));
  assert.equal(db.prepare("SELECT status FROM user_question_study_status WHERE question_id = 'answered'").get().status, "unstudied");
});
