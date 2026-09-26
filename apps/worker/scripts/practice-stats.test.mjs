// Issue #40: a practice answer is graded and saved the moment it is checked,
// but every statistic used to count only attempts with completed_at, and a
// practice attempt is completed only by End session, Finish or an exam switch.
// After a reload, Statistics said "Answered 0" while the Wrong book listed the
// same answers. These drive the real routes and statistics on node:sqlite.
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
const [{ attemptsRouter, examAttemptsRouter }, stats, cache, sessions, sweep] = await Promise.all([
  bundle("../src/routes/attempts.ts"), bundle("../src/lib/learningStats.ts"), bundle("../src/lib/statsCache.ts"),
  bundle("../src/lib/practiceSessions.ts"), bundle("../src/scheduled/closeStalePracticeAttempts.ts"),
]);

function setup(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  db.exec(`INSERT INTO users (id,email,role,created_at) VALUES ('u','u@test','user','2026-09-09'), ('other','o@test','user','2026-09-09');
    INSERT INTO exams(id,slug,name,created_at) VALUES ('e','e','E','2026-09-09'), ('e2','e2','E2','2026-09-09')`);
  for (const [n, exam] of [[1, "e"], [2, "e"], [3, "e"], [4, "e2"]]) {
    db.prepare(`INSERT INTO questions (id, exam_id, sequence_number, type, stem, options_json, correct_answers_json, created_at, updated_at)
      VALUES (?, ?, ?, 'single_choice', 'S', '[{"id":"A","text":"a"},{"id":"B","text":"b"}]', '["A"]', '2026-09-09', '2026-09-09')`).run(`q${n}`, exam, n);
  }
  const kv = new Map(), kvWrites = [];
  const DB = { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { const r = db.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; } };
  }, async batch(statements) {
    db.exec("BEGIN");
    try { const out = []; for (const s of statements) out.push(await s.run()); db.exec("COMMIT"); return out; }
    catch (err) { db.exec("ROLLBACK"); throw err; }
  } };
  const KV = {
    async get(key, type) { const v = kv.get(key); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(key, value) { kvWrites.push(key); kv.set(key, value); },
    async delete(key) { kvWrites.push(`delete:${key}`); kv.delete(key); },
  };
  const env = { DB, KV };
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: "u", role: "user" }); await next(); });
  app.route("/exams/:examId/attempts", examAttemptsRouter);
  app.route("/attempts", attemptsRouter);
  const request = async (path, method, body) => {
    const response = await app.request(`https://test${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: response.status, data: await response.json() };
  };
  const startPractice = async (questionIds, examId = "e") => (await request(`/exams/${examId}/attempts`, "POST", { mode: "practice", questionIds })).data.attemptId;
  const answer = (attemptId, questionId, choice) => request(`/attempts/${attemptId}/answers`, "POST", { questionId, selectedAnswer: [choice] });
  const attemptRow = id => ({ ...db.prepare("SELECT completed_at, duration_seconds, total_questions, score FROM attempts WHERE id = ?").get(id) });
  return { db, env, kvWrites, request, startPractice, answer, attemptRow };
}

test("graded practice answers count in every statistic before the session is ended", async t => {
  const { db, env, startPractice, answer } = setup(t);
  const attempt = await startPractice(["q1", "q2", "q3"]);
  await answer(attempt, "q1", "A"); await answer(attempt, "q2", "B"); await answer(attempt, "q3", "B");
  // Nothing ends the session: this is the reload in the issue.
  const result = await stats.computeExamStats(env.DB, "u", "e");
  assert.equal(result.totalAttempted, 3);
  assert.equal(result.attemptedInBank, 3);
  assert.equal(result.totalAnswers, 3);
  assert.equal(result.totalCorrect, 1);
  assert.equal(result.overallAccuracyPct, 33);
  assert.equal(result.weeklyNewQuestions, 3);
  assert.equal(result.accuracyComparison.current.attempted, 3);
  assert.deepEqual(result.accuracyTrend.map(p => [p.attempted, p.correct]), [[3, 1]]);
  assert.equal(result.byDifficulty.reduce((n, d) => n + d.attempted, 0), 3);
  const lastAnswer = db.prepare("SELECT MAX(answered_at) AS at FROM attempt_answers").get().at;
  assert.equal(result.lastAttemptAt, lastAnswer, "the last activity is the last answer");
  const summary = await stats.computeExamStatsSummary(env.DB, "u", "e");
  assert.deepEqual([summary.totalAttempted, summary.overallAccuracyPct, summary.lastAttemptAt], [3, 33, lastAnswer]);
  const page = await stats.computeExamStatsPage(env.DB, "u", "e", { trendCap: 10, tagCap: 10, mockLimit: 5, mockOffset: 0 });
  assert.equal(page.totalAttempted, 3);
  const activity = await stats.computeStudyActivity(env.DB, "u", { examId: "e" });
  assert.equal(activity.days.length, 1);
  assert.deepEqual([activity.days[0].questionsAnswered, activity.days[0].sessionsCompleted, activity.days[0].durationSeconds], [3, 0, 0],
    "answers are counted; no session has closed yet, so there is no recorded time");
});

test("answers are dated by when they were given, not by when their session closed", async t => {
  const { db, env, startPractice, answer, request } = setup(t);
  const attempt = await startPractice(["q1", "q2"]);
  await answer(attempt, "q1", "A"); await answer(attempt, "q2", "A");
  db.prepare("UPDATE attempt_answers SET answered_at = ? WHERE question_id = 'q1'").run("2026-09-20T23:50:00.000Z");
  db.prepare("UPDATE attempt_answers SET answered_at = ? WHERE question_id = 'q2'").run("2026-09-21T00:10:00.000Z");
  await request(`/attempts/${attempt}/complete`, "POST");
  const result = await stats.computeExamStats(env.DB, "u", "e", new Date("2026-09-21T12:00:00Z"));
  assert.deepEqual(result.accuracyTrend.map(p => [p.date, p.attempted]), [["2026-09-20", 1], ["2026-09-21", 1]], "a session across midnight splits by answer");
});

test("the stats cache refreshes after a practice answer without a KV write per answer", async t => {
  const { env, kvWrites, startPractice, answer } = setup(t);
  const attempt = await startPractice(["q1", "q2"]);
  await answer(attempt, "q1", "A");
  assert.equal((await cache.getOrComputeExamStats(env, "u", "e")).totalAnswers, 1);
  assert.equal(kvWrites.length, 1, "computed once and cached");
  assert.equal((await cache.getOrComputeExamStats(env, "u", "e")).totalAnswers, 1);
  assert.equal(kvWrites.length, 1, "an unchanged marker is served from the cache");
  await answer(attempt, "q2", "B");
  assert.equal(kvWrites.length, 1, "answering writes nothing to KV");
  assert.equal((await cache.getOrComputeExamStats(env, "u", "e")).totalAnswers, 2, "the next visit sees the new answer");
  assert.equal(kvWrites.length, 2);
});

test("starting practice closes the same user's idle sessions for that exam, dated by their last answer", async t => {
  const { db, startPractice, answer, attemptRow } = setup(t);
  const idle = await startPractice(["q1", "q2"]);
  await answer(idle, "q1", "A"); await answer(idle, "q2", "B");
  db.prepare("UPDATE attempts SET started_at = ? WHERE id = ?").run("2026-09-20T10:00:00.000Z", idle);
  db.prepare("UPDATE attempt_answers SET answered_at = ? WHERE attempt_id = ? AND question_id = 'q1'").run("2026-09-20T10:05:00.000Z", idle);
  db.prepare("UPDATE attempt_answers SET answered_at = ? WHERE attempt_id = ? AND question_id = 'q2'").run("2026-09-20T10:12:30.000Z", idle);
  const recent = await startPractice(["q3"]);
  await answer(recent, "q3", "A");
  const otherExam = await startPractice(["q4"], "e2");
  db.prepare("UPDATE attempts SET started_at = ? WHERE id = ?").run("2026-09-20T10:00:00.000Z", otherExam);
  db.prepare("INSERT INTO attempts (id, user_id, exam_id, mode, started_at, total_questions, question_ids_json) VALUES ('mock', 'u', 'e', 'mock', '2026-09-20T10:00:00.000Z', 1, '[\"q1\"]')").run();

  await startPractice(["q1"]);
  assert.deepEqual(attemptRow(idle), { completed_at: "2026-09-20T10:12:30.000Z", duration_seconds: 750, total_questions: 2, score: 50 });
  assert.equal(attemptRow(recent).completed_at, null, "a session answered just now may still be open in another tab");
  assert.equal(attemptRow(otherExam).completed_at, null, "another exam's session is not this start's business");
  assert.equal(attemptRow("mock").completed_at, null, "mock attempts are never closed this way");
});

test("the daily sweep closes practice sessions idle for a day, including ones with no answers", async t => {
  const { db, startPractice, answer, attemptRow } = setup(t);
  const empty = await startPractice(["q1"]);
  const answered = await startPractice(["q2"]);
  await answer(answered, "q2", "A");
  // Backdated only now: starting `answered` would already have closed it.
  db.prepare("UPDATE attempts SET started_at = ? WHERE id = ?").run("2026-09-20T08:00:00.000Z", empty);
  db.prepare("UPDATE attempt_answers SET answered_at = ? WHERE attempt_id = ?").run("2026-09-21T07:00:00.000Z", answered);
  db.prepare("UPDATE attempts SET started_at = ? WHERE id = ?").run("2026-09-21T06:59:00.000Z", answered);
  const { closed } = await sweep.runStalePracticeClose({ DB: setupDB(db) }, () => Date.parse("2026-09-22T06:00:00.000Z"));
  assert.equal(closed, 1);
  assert.deepEqual(attemptRow(empty), { completed_at: "2026-09-20T08:00:00.000Z", duration_seconds: 0, total_questions: 0, score: 0 });
  assert.equal(attemptRow(answered).completed_at, null, "answered 23 hours ago: not idle for a day yet");
  assert.equal(await sessions.closeStalePracticeAttempts(setupDB(db), { idleSeconds: 60, now: new Date("2026-09-22T06:00:00.000Z") }), 1);
  assert.equal(attemptRow(answered).completed_at, "2026-09-21T07:00:00.000Z");
});

function setupDB(db) {
  return { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async run() { const r = db.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; } };
  } };
}
