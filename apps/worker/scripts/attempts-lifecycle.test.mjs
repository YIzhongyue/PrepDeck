// Attempt lifecycle: what counts as an answer, what the deadline means, and
// what the draft endpoints accept. These three had no coverage at all, which is
// how the Wrong Question Book came to disagree with itself between practice and
// mock, how a mock's time limit came to be enforced only by the browser, and
// how a malformed draft could leave an attempt permanently unsubmittable.
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
const [{ questionsRouter }, { attemptsRouter, examAttemptsRouter }] = await Promise.all([
  bundle("../src/routes/questions.ts"), bundle("../src/routes/attempts.ts")]);

function setup(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  db.exec("INSERT INTO users (id,email,role,created_at) VALUES ('admin','admin@test','admin','2026-09-09'); INSERT INTO exams(id,slug,name,created_at) VALUES ('exam','test','Test exam','2026-09-09')");
  const pending = [];
  let beforeRun;
  const DB = { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { if (beforeRun) await beforeRun(sql); const r = db.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; } };
  }, async batch(statements) {
    db.exec("BEGIN");
    try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec("COMMIT"); return result; }
    catch (err) { db.exec("ROLLBACK"); throw err; }
  } };
  const env = { DB, KV: { delete: async () => {} } };
  const app = new Hono();
  // Surface a 500 as a thrown error: an unhandled exception in grading is
  // exactly the failure mode these tests exist to prevent.
  app.onError((err) => { throw new Error(err.message); });
  app.use("*", async (c, next) => { c.set("user", { id: "admin", role: "admin" }); await next(); });
  app.route("/exams/:examId/questions", questionsRouter);
  app.route("/exams/:examId/attempts", examAttemptsRouter);
  app.route("/attempts", attemptsRouter);
  const request = async (path, method = "GET", body) => {
    const response = await app.request(`https://test${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env, { waitUntil: p => pending.push(p), passThroughOnException() {} });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  };
  const addQuestion = async (overrides) => {
    const response = await request("/exams/exam/questions", "POST", {
      type: "single_choice", stem: "Which value is even?",
      options: [{ id: "A", text: "2" }, { id: "B", text: "3" }], correctAnswers: ["A"], ...overrides,
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.question;
  };
  const fillBlank = () => addQuestion({ type: "fill_blank", options: undefined, correctAnswers: ["green"] });
  const start = async (mode, questionIds, timeLimitSeconds) => {
    const response = await request("/exams/exam/attempts", "POST", { mode, questionIds, timeLimitSeconds });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.attemptId;
  };
  // The deadline is derived from immutable columns, so backdating the row is a
  // faithful stand-in for time passing — and does not make the suite sleep.
  const backdate = (attemptId, seconds) =>
    db.prepare("UPDATE attempts SET started_at = ? WHERE id = ?")
      .run(new Date(Date.now() - seconds * 1000).toISOString(), attemptId);
  // node:sqlite hands back null-prototype rows; deepEqual wants plain objects.
  const wrongBook = () => db.prepare("SELECT question_id, wrong_count FROM wrong_question_book ORDER BY question_id").all().map(row => ({ ...row }));
  const draftOf = (attemptId) => JSON.parse(db.prepare("SELECT draft_answers_json FROM attempts WHERE id = ?").get(attemptId).draft_answers_json ?? "{}");
  return { db, request, addQuestion, fillBlank, start, backdate, wrongBook, draftOf,
    beforeRun: hook => { beforeRun = hook; } };
}

function clock(t, db) {
  const startedAt = Date.parse("2026-09-19T12:00:00.123Z");
  t.mock.timers.enable({ apis: ["Date"], now: startedAt });
  // Replace only the clock source; the guarded UPDATE still executes in SQLite.
  db.function("unixepoch", { varargs: true }, (...args) => args[0] === "subsec" ? Date.now() / 1000 : Date.parse(args[0]) / 1000);
  return offset => t.mock.timers.setTime(startedAt + offset);
}

test("an unanswered mock question is graded incorrect but never filed as a wrong answer", async t => {
  const { request, addQuestion, start, wrongBook } = setup(t);
  const [missed, skipped] = [await addQuestion(), await addQuestion()];
  const attempt = await start("mock", [missed.id, skipped.id]);
  await request(`/attempts/${attempt}/answers/${missed.id}`, "PUT", { selectedAnswer: ["B"] });

  const { data } = await request(`/attempts/${attempt}/complete`, "POST");
  assert.deepEqual(data.breakdown.map(r => r.isCorrect), [false, false], "both count against the score");
  assert.deepEqual(wrongBook().map(r => r.question_id), [missed.id], "only the answered miss is reviewable");
});

test("a fill-in the user typed into and then cleared is not an answer, in either mode", async t => {
  const { request, fillBlank, start, wrongBook } = setup(t);
  const question = await fillBlank();

  const mock = await start("mock", [question.id]);
  await request(`/attempts/${mock}/answers/${question.id}`, "PUT", { selectedAnswer: [""] });
  const completed = await request(`/attempts/${mock}/complete`, "POST");
  assert.equal(completed.data.breakdown[0].isCorrect, false);
  assert.deepEqual(wrongBook(), [], "an empty box is a skipped question, not a wrong answer");

  // Practice used to have no such guard at all, so the same empty submission
  // was filed or not depending only on which mode it arrived through.
  const practice = await start("practice", [question.id]);
  const answered = await request(`/attempts/${practice}/answers`, "POST", { questionId: question.id, selectedAnswer: ["   "] });
  assert.equal(answered.data.isCorrect, false);
  assert.deepEqual(wrongBook(), []);
});

test("a real wrong answer is still filed, and answering it again bumps the count", async t => {
  const { request, addQuestion, start, wrongBook } = setup(t);
  const question = await addQuestion();
  for (const _ of [0, 1]) {
    const attempt = await start("practice", [question.id]);
    await request(`/attempts/${attempt}/answers`, "POST", { questionId: question.id, selectedAnswer: ["B"] });
    await request(`/attempts/${attempt}/complete`, "POST");
  }
  assert.deepEqual(wrongBook(), [{ question_id: question.id, wrong_count: 2 }]);
});

test("draft and practice answers must be arrays of strings, and a rejected write changes nothing", async t => {
  const { request, fillBlank, start, draftOf } = setup(t);
  const question = await fillBlank();
  const mock = await start("mock", [question.id]);
  await request(`/attempts/${mock}/answers/${question.id}`, "PUT", { selectedAnswer: ["green"] });

  for (const selectedAnswer of [[123], [null], [{}], [["green"]], ["ok", 1]]) {
    const rejected = await request(`/attempts/${mock}/answers/${question.id}`, "PUT", { selectedAnswer });
    assert.equal(rejected.status, 400, JSON.stringify(selectedAnswer));
    assert.deepEqual(draftOf(mock), { [question.id]: ["green"] }, "a rejected write must not disturb the saved draft");
  }

  const practice = await start("practice", [question.id]);
  const badPractice = await request(`/attempts/${practice}/answers`, "POST", { questionId: question.id, selectedAnswer: [123] });
  assert.equal(badPractice.status, 400);
});

test("a draft written before the element check existed still completes, scored as unanswered", async t => {
  const { db, request, fillBlank, start } = setup(t);
  const question = await fillBlank();
  const attempt = await start("mock", [question.id]);
  // Exactly what an older client could leave behind: the route can no longer
  // write this, so the only way in is straight past it.
  db.prepare("UPDATE attempts SET draft_answers_json = ? WHERE id = ?").run(JSON.stringify({ [question.id]: [123] }), attempt);

  const { status, data } = await request(`/attempts/${attempt}/complete`, "POST");
  assert.equal(status, 200, "a poisoned draft must not make the attempt unsubmittable");
  assert.equal(data.breakdown[0].isCorrect, false);
  assert.deepEqual(data.breakdown[0].selectedAnswer, [], "the unusable value is dropped, not graded");
});

test("resuming a historical invalid selection frees its slots and retains other valid answers", async t => {
  const { db, request, addQuestion, fillBlank, start } = setup(t);
  const multiple = await addQuestion({ type: "multiple_choice", correctAnswers: ["A", "B"] });
  const valid = await fillBlank();
  const attempt = await start("mock", [multiple.id, valid.id]);
  db.prepare("UPDATE attempts SET draft_answers_json = ? WHERE id = ?")
    .run(JSON.stringify({ [multiple.id]: [123, {}], [valid.id]: ["green"], stale: ["A"] }), attempt);

  const active = await request("/attempts/active?examId=exam&mode=mock");
  assert.equal(active.status, 200);
  assert.deepEqual(active.data.attempt.selectedAnswers, { [valid.id]: ["green"] });
  assert.equal((await request(`/attempts/${attempt}/answers/${multiple.id}`, "PUT", { selectedAnswer: ["A", "B"] })).status, 200);
  const completed = await request(`/attempts/${attempt}/complete`, "POST");
  assert.equal(completed.data.score, 100, "repairing one entry preserves the other saved answer");
});

test("corrupt or non-object historical drafts can resume, be repaired, and complete", async t => {
  const { db, request, fillBlank, start, draftOf } = setup(t);
  const question = await fillBlank();
  for (const raw of ["not json", "null", "[]", "123", '"text"']) {
    const attempt = await start("mock", [question.id]);
    db.prepare("UPDATE attempts SET draft_answers_json = ? WHERE id = ?").run(raw, attempt);
    assert.deepEqual((await request("/attempts/active?examId=exam&mode=mock")).data.attempt.selectedAnswers, {});
    assert.equal((await request(`/attempts/${attempt}/answers/${question.id}`, "PUT", { selectedAnswer: ["green"] })).status, 200);
    assert.deepEqual(draftOf(attempt), { [question.id]: ["green"] });
    db.prepare("UPDATE attempts SET draft_answers_json = ? WHERE id = ?").run(raw, attempt);
    const completed = await request(`/attempts/${attempt}/complete`, "POST");
    assert.equal(completed.status, 200);
    assert.deepEqual(completed.data.breakdown[0].selectedAnswer, []);
    assert.equal(completed.data.score, 0);
  }
});

test("a mock stops accepting answers once its deadline plus grace has passed", async t => {
  const { request, fillBlank, start, backdate, draftOf } = setup(t);
  const question = await fillBlank();
  const attempt = await start("mock", [question.id], 60);
  backdate(attempt, 60 + 30 + 5);

  const late = await request(`/attempts/${attempt}/answers/${question.id}`, "PUT", { selectedAnswer: ["green"] });
  assert.equal(late.status, 409);
  assert.equal(late.data.expired, true, "the client needs to tell this apart from a completed attempt");
  assert.deepEqual(draftOf(attempt), {}, "nothing was written");

  const { data } = await request(`/attempts/${attempt}/complete`, "POST");
  assert.equal(data.score, 0, "a late answer cannot change the result");
  assert.equal(data.breakdown[0].isCorrect, false);
});

test("the grace window keeps an answer made just before the bell", async t => {
  const { request, fillBlank, start, backdate } = setup(t);
  const question = await fillBlank();
  const attempt = await start("mock", [question.id], 60);
  backdate(attempt, 60 + 5);

  const saved = await request(`/attempts/${attempt}/answers/${question.id}`, "PUT", { selectedAnswer: ["green"] });
  assert.equal(saved.status, 200, "a queued write flushed at submission time is still in time");
  const { data } = await request(`/attempts/${attempt}/complete`, "POST");
  assert.equal(data.score, 100);
});

test("the full 30-second grace window includes its exact final boundary", async t => {
  const { db, request, fillBlank, start } = setup(t);
  const time = clock(t, db);
  const question = await fillBlank();
  const attempt = await start("mock", [question.id], 60);
  time(90_000);
  assert.equal((await request(`/attempts/${attempt}/answers/${question.id}`, "PUT", { selectedAnswer: ["green"] })).status, 200);
  time(90_001);
  const late = await request(`/attempts/${attempt}/answers/${question.id}`, "PUT", { selectedAnswer: ["wrong"] });
  assert.equal(late.status, 409);
  assert.equal(late.data.expired, true);
  assert.equal((await request(`/attempts/${attempt}/complete`, "POST")).data.score, 100);
});

test("a draft queued inside grace cannot write after grace ends in D1", async t => {
  const { db, request, fillBlank, start, draftOf, beforeRun } = setup(t);
  const time = clock(t, db);
  const question = await fillBlank();
  const attempt = await start("mock", [question.id], 60);
  await request(`/attempts/${attempt}/answers/${question.id}`, "PUT", { selectedAnswer: ["green"] });
  time(89_999);
  beforeRun(sql => { if (sql.startsWith("UPDATE attempts SET draft_answers_json")) time(90_001); });
  const late = await request(`/attempts/${attempt}/answers/${question.id}`, "PUT", { selectedAnswer: ["wrong"] });
  assert.equal(late.status, 409);
  assert.equal(late.data.expired, true, "the client must discard this permanent failure before submitting");
  assert.deepEqual(draftOf(attempt), { [question.id]: ["green"] });
  assert.equal(db.prepare("SELECT draft_revision FROM attempts WHERE id=?").get(attempt).draft_revision, 1);
  const completed = await request(`/attempts/${attempt}/complete`, "POST");
  assert.equal(completed.data.score, 100);
  assert.equal(completed.data.durationSeconds, 60);
  const afterCompletion = await request(`/attempts/${attempt}/answers/${question.id}`, "PUT", { selectedAnswer: ["wrong"] });
  assert.equal(afterCompletion.status, 409);
  assert.notEqual(afterCompletion.data.expired, true, "completion stays distinct from expiry");
});

test("an untimed attempt has no deadline, and flags are never refused by one", async t => {
  const { request, addQuestion, start, backdate } = setup(t);
  const question = await addQuestion();
  const untimed = await start("mock", [question.id]);
  backdate(untimed, 86400);
  assert.equal((await request(`/attempts/${untimed}/answers/${question.id}`, "PUT", { selectedAnswer: ["A"] })).status, 200);

  const timed = await start("practice", [question.id]);
  assert.equal((await request(`/attempts/${timed}/complete`, "POST")).status, 200);
});

test("time used is reported against the limit, not against how long the tab stayed open", async t => {
  const { request, addQuestion, start, backdate } = setup(t);
  const question = await addQuestion();
  const attempt = await start("mock", [question.id], 120);
  backdate(attempt, 86400);

  const { data } = await request(`/attempts/${attempt}/complete`, "POST");
  assert.equal(data.durationSeconds, 120, "an overnight submission must not report the night as time used");
});

test("a time limit that is not a positive number is refused at the start, not stored", async t => {
  const { request, addQuestion } = setup(t);
  const question = await addQuestion();
  // NaN and Infinity are unreachable here: JSON.stringify turns both into null,
  // which the route reads as "no limit" — correctly, since that is all a JSON
  // body can say. What a client CAN send is a string, a zero or a negative.
  for (const timeLimitSeconds of ["600", 0, -1, -0.5]) {
    const { status } = await request("/exams/exam/attempts", "POST", { mode: "mock", questionIds: [question.id], timeLimitSeconds });
    assert.equal(status, 400, String(timeLimitSeconds));
  }
});

// Issue #39: an answer is validated against the question it answers, on both the
// practice endpoint and the mock draft endpoint, before anything is written.
const { normalizeImportFile } = await bundle("../../../packages/shared/src/question-components.ts");
const componentRows = name => normalizeImportFile(JSON.parse(readFileSync(new URL(`../../../tests/fixtures/components/${name}.json`, import.meta.url), "utf8"))).questions;
const answerRows = db => db.prepare("SELECT question_id, selected_answer_json, time_spent_seconds, typeof(time_spent_seconds) AS kind FROM attempt_answers ORDER BY question_id").all().map(row => ({ ...row }));

test("several guesses in one fill-in submission are refused, not graded correct", async t => {
  const { db, request, fillBlank, start } = setup(t);
  const question = await fillBlank();
  const practice = await start("practice", [question.id]);
  const guesses = await request(`/attempts/${practice}/answers`, "POST", { questionId: question.id, selectedAnswer: ["red", "blue", "green", "purple", "orange"] });
  assert.equal(guesses.status, 400, JSON.stringify(guesses.data));
  assert.match(guesses.data.error, /single value/);
  assert.deepEqual(answerRows(db), [], "nothing was written");
  const single = await request(`/attempts/${practice}/answers`, "POST", { questionId: question.id, selectedAnswer: ["green"] });
  assert.equal(single.data.isCorrect, true);
});

test("choice answers must name the question's own options, once each, and one for single choice", async t => {
  const { db, request, addQuestion, start, draftOf } = setup(t);
  const single = await addQuestion();
  const multiple = await addQuestion({ type: "multiple_choice", options: [{ id: "A", text: "2" }, { id: "B", text: "4" }, { id: "C", text: "5" }], correctAnswers: ["A", "B"] });
  const trueFalse = await addQuestion({ type: "true_false", options: [{ id: "true", text: "True" }, { id: "false", text: "False" }], correctAnswers: ["true"] });
  const practice = await start("practice", [single.id, multiple.id, trueFalse.id]);
  const refused = [
    [single, ["A", "A"]], [single, ["A", "B"]], [single, ["Z"]],
    [multiple, ["Z"]], [multiple, ["A", "A"]], [multiple, ["A", "B", "Z"]],
    [trueFalse, ["true", "false"]], [trueFalse, ["yes"]],
  ];
  for (const [question, selectedAnswer] of refused) {
    const response = await request(`/attempts/${practice}/answers`, "POST", { questionId: question.id, selectedAnswer });
    assert.equal(response.status, 400, `${question.type} ${JSON.stringify(selectedAnswer)}`);
  }
  assert.deepEqual(answerRows(db), [], "a refused answer writes nothing and files nothing");

  const mock = await start("mock", [single.id, multiple.id]);
  assert.equal((await request(`/attempts/${mock}/answers/${multiple.id}`, "PUT", { selectedAnswer: ["A", "B"] })).status, 200);
  for (const selectedAnswer of [["Z"], ["A", "A"], ["A", "B", "C", "Z"]]) {
    assert.equal((await request(`/attempts/${mock}/answers/${multiple.id}`, "PUT", { selectedAnswer })).status, 400, JSON.stringify(selectedAnswer));
  }
  assert.equal((await request(`/attempts/${mock}/answers/${single.id}`, "PUT", { selectedAnswer: ["A", "B"] })).status, 400);
  assert.deepEqual(draftOf(mock), { [multiple.id]: ["A", "B"] }, "a refused draft leaves the saved one alone");
  // Clearing an answer is still an answer the draft endpoint takes.
  assert.equal((await request(`/attempts/${mock}/answers/${multiple.id}`, "PUT", { selectedAnswer: [] })).status, 200);
  assert.equal((await request(`/attempts/${practice}/answers`, "POST", { questionId: multiple.id, selectedAnswer: ["B", "A"] })).data.isCorrect, true);
});

test("an ordering draft may be half-arranged; a matching answer must be known, canonical pairs", async t => {
  const { request, addQuestion, start, draftOf } = setup(t);
  const [ordering] = componentRows("code");
  const [matching] = componentRows("case-with-figure");
  const order = await addQuestion(ordering);
  const match = await addQuestion(matching);
  const mock = await start("mock", [order.id, match.id]);
  const put = (question, selectedAnswer) => request(`/attempts/${mock}/answers/${question.id}`, "PUT", { selectedAnswer });

  // Blanks and repeats are how a learner gets from nothing to an order.
  for (const selectedAnswer of [["read", "", ""], ["read", "read", "print"], ["read", "sum", "print"], []]) {
    assert.equal((await put(order, selectedAnswer)).status, 200, JSON.stringify(selectedAnswer));
  }
  for (const selectedAnswer of [["read", "sum"], ["read", "sum", "print", "read"], ["read", "sum", "nope"]]) {
    assert.equal((await put(order, selectedAnswer)).status, 400, JSON.stringify(selectedAnswer));
  }
  assert.equal((await put(match, ['["low","before"]'])).status, 200, "a partial match is a draft");
  for (const selectedAnswer of [['["low","nope"]'], ['["nope","before"]'], ['["low", "before"]'], ['["low","before"]', '["low","after"]'], ["low"]]) {
    assert.equal((await put(match, selectedAnswer)).status, 400, JSON.stringify(selectedAnswer));
  }
  assert.deepEqual(draftOf(mock)[match.id], ['["low","before"]']);
  assert.equal((await put(match, ['["high","after"]', '["low","before"]'])).status, 200);
  const { data } = await request(`/attempts/${mock}/complete`, "POST");
  assert.deepEqual(data.breakdown.map(row => row.isCorrect), [false, true], "the empty ordering is unanswered, the full match correct");
});

test("answers have size limits, refused with 400 before they reach the database", async t => {
  const { request, fillBlank, addQuestion, start, draftOf } = setup(t);
  const blank = await fillBlank();
  const multiple = await addQuestion({ type: "multiple_choice", correctAnswers: ["A", "B"] });
  const practice = await start("practice", [blank.id]);
  const long = await request(`/attempts/${practice}/answers`, "POST", { questionId: blank.id, selectedAnswer: ["x".repeat(1001)] });
  assert.equal(long.status, 400);
  assert.match(long.data.error, /1000 characters/);
  const mock = await start("mock", [multiple.id]);
  const many = await request(`/attempts/${mock}/answers/${multiple.id}`, "PUT", { selectedAnswer: Array.from({ length: 51 }, (_, i) => `id-${i}`) });
  assert.equal(many.status, 400);
  assert.match(many.data.error, /at most 50 values/);
  assert.deepEqual(draftOf(mock), {});
});

test("timeSpentSeconds is absent or whole seconds within a day", async t => {
  const { db, request, addQuestion, start } = setup(t);
  const questions = [await addQuestion(), await addQuestion(), await addQuestion()];
  const practice = await start("practice", questions.map(q => q.id));
  for (const timeSpentSeconds of [-99999, "lots", 1e300, 1.5, 86401, true]) {
    const response = await request(`/attempts/${practice}/answers`, "POST", { questionId: questions[0].id, selectedAnswer: ["A"], timeSpentSeconds });
    assert.equal(response.status, 400, JSON.stringify(timeSpentSeconds));
  }
  assert.deepEqual(answerRows(db), []);
  assert.equal((await request(`/attempts/${practice}/answers`, "POST", { questionId: questions[0].id, selectedAnswer: ["A"], timeSpentSeconds: 42 })).status, 200);
  assert.equal((await request(`/attempts/${practice}/answers`, "POST", { questionId: questions[1].id, selectedAnswer: ["A"], timeSpentSeconds: null })).status, 200);
  assert.equal((await request(`/attempts/${practice}/answers`, "POST", { questionId: questions[2].id, selectedAnswer: ["A"] })).status, 200);
  const stored = Object.fromEntries(answerRows(db).map(row => [row.question_id, [row.time_spent_seconds, row.kind]]));
  assert.deepEqual(stored, { [questions[0].id]: [42, "integer"], [questions[1].id]: [null, "null"], [questions[2].id]: [null, "null"] });
});

test("a mock with a draft saved before validation still submits; the draft is graded as unanswered", async t => {
  const { db, request, fillBlank, addQuestion, start, wrongBook } = setup(t);
  const blank = await fillBlank();
  const single = await addQuestion();
  const attempt = await start("mock", [blank.id, single.id]);
  // What an older server accepted: several fill-in guesses, one of them right,
  // and an option the question does not have.
  db.prepare("UPDATE attempts SET draft_answers_json = ? WHERE id = ?")
    .run(JSON.stringify({ [blank.id]: ["red", "green"], [single.id]: ["Z"] }), attempt);
  const { status, data } = await request(`/attempts/${attempt}/complete`, "POST");
  assert.equal(status, 200, "an invalid draft entry must not make the attempt unsubmittable");
  assert.deepEqual(data.breakdown.map(row => [row.isCorrect, row.selectedAnswer]), [[false, []], [false, []]]);
  assert.deepEqual(wrongBook(), [], "an unusable draft is not a wrong answer to file");
});

test("a replayed practice answer still recovers its feedback after the question changed", async t => {
  const { db, request, addQuestion, start } = setup(t);
  const question = await addQuestion({ options: [{ id: "A", text: "2" }, { id: "B", text: "3" }, { id: "C", text: "4" }] });
  const practice = await start("practice", [question.id]);
  const first = await request(`/attempts/${practice}/answers`, "POST", { questionId: question.id, selectedAnswer: ["C"] });
  assert.equal(first.status, 200);
  // Option C is edited away after it was answered; the retry of that same
  // answer must replay the recorded grading, not be refused as unknown.
  db.prepare("UPDATE questions SET options_json = ? WHERE id = ?").run(JSON.stringify([{ id: "A", text: "2" }, { id: "B", text: "3" }]), question.id);
  const replay = await request(`/attempts/${practice}/answers`, "POST", { questionId: question.id, selectedAnswer: ["C"] });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.isCorrect, first.data.isCorrect);
});

test("migration 0036 clears only time_spent_seconds values the API would now refuse", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const directory = new URL("../../../migrations/", import.meta.url);
  const names = readdirSync(directory).filter(n => n.endsWith(".sql")).sort();
  const cleanup = names.find(n => n.startsWith("0036_"));
  for (const name of names.filter(n => n < cleanup)) db.exec(readFileSync(new URL(name, directory), "utf8"));
  db.exec(`INSERT INTO users (id,email,role,created_at) VALUES ('u','u@test','user','2026-09-09');
    INSERT INTO exams(id,slug,name,created_at) VALUES ('e','e','E','2026-09-09');
    INSERT INTO questions (id, exam_id, sequence_number, type, stem, correct_answers_json, created_at, updated_at) VALUES ('q','e',1,'fill_blank','S','["x"]','2026-09-09','2026-09-09')`);
  const values = [["ok", 42], ["zero", 0], ["day", 86400], ["none", null], ["text", "lots"], ["real", 1e300], ["negative", -99999], ["late", 86401]];
  for (const [id, value] of values) {
    // One attempt per row: an attempt answers each question at most once.
    db.prepare("INSERT INTO attempts (id, user_id, exam_id, mode, started_at, total_questions, question_ids_json) VALUES (?, 'u', 'e', 'practice', '2026-09-09', 1, '[\"q\"]')").run(`a-${id}`);
    db.prepare("INSERT INTO attempt_answers (id, attempt_id, question_id, selected_answer_json, is_correct, time_spent_seconds, answered_at) VALUES (?, ?, 'q', '[\"x\"]', 1, ?, '2026-09-09')")
      .run(id, `a-${id}`, value);
  }
  db.exec(readFileSync(new URL(cleanup, directory), "utf8"));
  const after = Object.fromEntries(db.prepare("SELECT id, time_spent_seconds FROM attempt_answers").all().map(row => [row.id, row.time_spent_seconds]));
  assert.deepEqual(after, { ok: 42, zero: 0, day: 86400, none: null, text: null, real: null, negative: null, late: null });
});
