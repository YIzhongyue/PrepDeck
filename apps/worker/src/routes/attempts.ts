// docs/requirements/practice-and-learning-modes.md (Practice Mode) / 3.4 (Mock Exam Mode) — attempt lifecycle.
//
// Practice grades one question at a time and locks it (FR-3.2: immediate
// feedback, no revising a graded question) — POST /:id/answers grades and
// persists in the same call. Mock never reveals correctness until submission
// (FR-4.4) — PUT /:id/answers/:questionId only stores an ungraded draft, and
// POST /:id/complete grades every question in the attempt at once. Storing
// mock's in-progress state in attempts.draft_answers_json (rather than
// attempt_answers rows, whose is_correct column is NOT NULL) is what makes
// resume-on-reload possible via GET /active.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { invalidateExamStats } from "../lib/statsCache";
import { loadExamPassRule } from "../lib/examManagement";
import { closeStalePracticeAttempts, PRACTICE_IDLE_ON_START_SECONDS } from "../lib/practiceSessions";
import {
  attemptDeadlineMs,
  hasAnswer,
  isAnswerCorrect,
  isMockPassed,
  isStringArray,
  MAX_ATTEMPT_QUESTIONS,
  MOCK_SUBMIT_GRACE_SECONDS,
  requiredCorrectFor,
  type ActiveAttemptResponse,
  type AttemptMode,
  type CompleteAttemptResponse,
  type SaveDraftAnswerRequest,
  type SaveFlagRequest,
  type StartAttemptRequest,
  type StartAttemptResponse,
  type SubmitPracticeAnswerRequest,
  type SubmitPracticeAnswerResponse,
} from "@prepdeck/shared";

interface AttemptRow {
  id: string;
  user_id: string;
  exam_id: string;
  mode: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  score: number | null;
  total_questions: number | null;
  question_ids_json: string;
  time_limit_seconds: number | null;
  draft_answers_json: string | null;
  draft_revision: number;
  flagged_json: string | null;
}

function wrongBookUpsert(db: D1Database, userId: string, questionId: string, now: string, answerId: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO wrong_question_book (user_id, question_id, wrong_count, last_wrong_at, mastered)
       SELECT ?, ?, 1, ?, 0 WHERE EXISTS (SELECT 1 FROM attempt_answers WHERE id = ?)
       ON CONFLICT(user_id, question_id) DO UPDATE SET wrong_count = wrong_count + 1, last_wrong_at = excluded.last_wrong_at, mastered = 0`
    )
    .bind(userId, questionId, now, answerId);
}

// A practice answer is graded and locked the moment it is written (FR-3.2:
// immediate feedback, no revising a graded question), so a repeat POST for the
// same question is either a client retrying after a response it never received
// or an attempt to revise a locked answer. Both deserve the same reply: the
// grading that was actually recorded. Replaying it makes the endpoint
// idempotent — a retry after a dropped response recovers the feedback instead
// of stranding the client on a question the server has already graded — while
// still refusing to let the stored answer be revised.
//
// Answers are replayed from `graded_answers_json`, the answer key this attempt
// was graded against, NOT the question's current key: a replay has to stay
// internally consistent with its own `isCorrect` even if the key has since
// moved. (Both graded columns are nullable — migrations/0015 added them — so
// rows written before then fall back to the question's current values.)
async function storedPracticeAnswer(
  db: D1Database, attemptId: string, questionId: string,
): Promise<SubmitPracticeAnswerResponse | null> {
  const row = await db
    .prepare(
      `SELECT aa.is_correct, aa.graded_answers_json, aa.answer_revision, q.correct_answers_json, q.explanation,
              q.answer_revision AS current_answer_revision, q.answer_revised_at
       FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id
       WHERE aa.attempt_id = ? AND aa.question_id = ?`
    )
    .bind(attemptId, questionId)
    .first<{
      is_correct: number; graded_answers_json: string | null; answer_revision: number | null;
      correct_answers_json: string; explanation: string | null; current_answer_revision: number; answer_revised_at: string | null;
    }>();
  if (!row) return null;
  return {
    isCorrect: row.is_correct === 1,
    correctAnswers: JSON.parse(row.graded_answers_json ?? row.correct_answers_json) as string[],
    explanation: row.explanation,
    answerRevision: row.answer_revision ?? row.current_answer_revision,
    answerRevisedAt: row.answer_revised_at,
  };
}

// FR-4.3: past the deadline plus its grace window, this attempt's answers are
// settled — a late write must not change what gets graded.
//
// This fast check avoids issuing a write that is already late. The UPDATE also
// checks D1's clock: time can pass while a request waits for the database even
// though the columns defining its deadline never change.
function isPastDeadline(attempt: AttemptRow, nowMs: number): boolean {
  const deadline = attemptDeadlineMs(attempt.started_at, attempt.time_limit_seconds);
  return deadline !== null && nowMs > deadline + MOCK_SUBMIT_GRACE_SECONDS * 1000;
}

function readMockDraft(attempt: AttemptRow): Record<string, string[]> {
  let stored: unknown;
  try { stored = JSON.parse(attempt.draft_answers_json ?? "{}"); }
  catch { return {}; }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const entries = stored as Record<string, unknown>;
  const questionIds: string[] = JSON.parse(attempt.question_ids_json);
  // Recovery and grading must agree. An invalid old selection can fill every
  // multiple-choice slot and prevent the learner from choosing a valid option.
  // Drop only that entry and retain valid answers to the other questions.
  return Object.fromEntries(questionIds.flatMap(id => {
    const selected = entries[id];
    return isStringArray(selected) ? [[id, selected]] : [];
  }));
}

async function loadOwnAttempt(db: D1Database, attemptId: string, userId: string): Promise<AttemptRow | null> {
  const attempt = await db.prepare("SELECT * FROM attempts WHERE id = ?").bind(attemptId).first<AttemptRow>();
  if (!attempt || attempt.user_id !== userId) return null;
  return attempt;
}

// Mounted at /api/exams/:examId/attempts
export const examAttemptsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

examAttemptsRouter.post("/", async (c) => {
  const examId = c.req.param("examId");
  const userId = c.get("user").id;

  const exam = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(examId).first();
  if (!exam) return c.json({ error: "Exam not found" }, 404);

  const body = await c.req.json<StartAttemptRequest>().catch(() => null);
  if (
    !body ||
    (body.mode !== "practice" && body.mode !== "mock") ||
    !Array.isArray(body.questionIds) ||
    body.questionIds.length === 0 || body.questionIds.some((id) => typeof id !== "string" || !id)
  ) {
    return c.json({ error: "mode and a non-empty questionIds array are required" }, 400);
  }
  // The limit is stored on the attempt and enforced against it for the rest of
  // its life (isPastDeadline), so a non-numeric or negative value here would
  // become a permanently broken deadline rather than a rejected request.
  if (body.timeLimitSeconds != null
    && (typeof body.timeLimitSeconds !== "number" || !Number.isFinite(body.timeLimitSeconds) || body.timeLimitSeconds <= 0)) {
    return c.json({ error: "timeLimitSeconds must be a positive number of seconds" }, 400);
  }

  const uniqueIds = Array.from(new Set(body.questionIds));
  // POST /:id/complete grades the whole attempt in one unchunkable D1 batch, so
  // the attempt's size is what bounds that batch — see MAX_ATTEMPT_QUESTIONS in
  // @prepdeck/shared. Enforced here, before the ownership lookup and while the
  // user has answered nothing, rather than discovered at submission.
  if (uniqueIds.length > MAX_ATTEMPT_QUESTIONS) {
    return c.json({ error: `An attempt may contain at most ${MAX_ATTEMPT_QUESTIONS} questions` }, 400);
  }
  const owned = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM questions WHERE exam_id = ? AND id IN (SELECT value FROM json_each(?))")
    .bind(examId, JSON.stringify(uniqueIds))
    .first<{ n: number }>();
  if (!owned || owned.n !== uniqueIds.length) {
    return c.json({ error: "One or more questionIds do not belong to this exam" }, 400);
  }

  // Starting practice means an earlier session for this exam that has sat idle
  // was abandoned (a reload, a closed tab): close it as a session now rather
  // than leave it open forever (issue #40). Idle ones only, so a session still
  // in use in another tab is left alone.
  if (body.mode === "practice") {
    await closeStalePracticeAttempts(c.env.DB, { idleSeconds: PRACTICE_IDLE_ON_START_SECONDS, userId, examId });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const timeLimitSeconds = body.mode === "mock" ? body.timeLimitSeconds ?? null : null;

  // Only mock exams get the single-active-attempt lock: mock has a resume flow
  // that depends on there being at most one open attempt to resume. Practice
  // has no resume concept, so an old open attempt (e.g. from a session the
  // user just navigated away from) must never block starting a new one.
  //
  // The lock lives in the INSERT's own WHERE rather than a preceding SELECT:
  // a read-then-write pair loses the race that two concurrent starts are
  // exactly what this exists to prevent, and the SELECT below is only reached
  // to name the winning attempt in the error, never to decide the outcome.
  const inserted = await c.env.DB.prepare(
    `INSERT INTO attempts (id, user_id, exam_id, mode, started_at, total_questions, question_ids_json, time_limit_seconds)
     SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ? != 'mock' OR NOT EXISTS (
       SELECT 1 FROM attempts WHERE user_id = ? AND exam_id = ? AND mode = 'mock' AND completed_at IS NULL
     )`
  )
    .bind(id, userId, examId, body.mode, now, uniqueIds.length, JSON.stringify(uniqueIds), timeLimitSeconds, body.mode, userId, examId)
    .run();
  if (!inserted.meta.changes) {
    const active = await c.env.DB.prepare("SELECT id FROM attempts WHERE user_id = ? AND exam_id = ? AND mode = 'mock' AND completed_at IS NULL")
      .bind(userId, examId).first<{ id: string }>();
    return c.json({ error: "An in-progress mock attempt already exists for this exam", attemptId: active?.id }, 409);
  }

  const response: StartAttemptResponse = { attemptId: id, mode: body.mode, startedAt: now, timeLimitSeconds };
  return c.json(response, 201);
});

// Mounted at /api/attempts
export const attemptsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

attemptsRouter.get("/active", async (c) => {
  const examId = c.req.query("examId");
  const mode = c.req.query("mode");
  if (!examId || (mode !== "practice" && mode !== "mock")) {
    return c.json({ error: "examId and mode query params are required" }, 400);
  }

  const attempt = await c.env.DB.prepare(
    "SELECT * FROM attempts WHERE user_id = ? AND exam_id = ? AND mode = ? AND completed_at IS NULL ORDER BY started_at DESC LIMIT 1"
  )
    .bind(c.get("user").id, examId, mode)
    .first<AttemptRow>();

  if (!attempt) return c.json({ attempt: null });

  const response: ActiveAttemptResponse = {
    attemptId: attempt.id,
    mode: attempt.mode as AttemptMode,
    examId: attempt.exam_id,
    questionIds: JSON.parse(attempt.question_ids_json),
    selectedAnswers: readMockDraft(attempt),
    flagged: attempt.flagged_json ? JSON.parse(attempt.flagged_json) : {},
    startedAt: attempt.started_at,
    timeLimitSeconds: attempt.time_limit_seconds,
  };
  return c.json({ attempt: response });
});

attemptsRouter.post("/:id/answers", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const attempt = await loadOwnAttempt(c.env.DB, id, userId);
  if (!attempt) return c.json({ error: "Attempt not found" }, 404);
  if (attempt.mode !== "practice") return c.json({ error: "This attempt is not in practice mode" }, 400);
  if (attempt.completed_at) return c.json({ error: "Attempt already completed" }, 409);

  const body = await c.req.json<SubmitPracticeAnswerRequest>().catch(() => null);
  if (!body || typeof body.questionId !== "string") {
    return c.json({ error: "questionId and selectedAnswer are required" }, 400);
  }
  // Array.isArray alone let [123] / [null] / [{}] through to the grader, which
  // calls .trim() on fill-in answers — an unhandled TypeError, i.e. a 500 on a
  // malformed request. Rejected here, before anything is written.
  if (!isStringArray(body.selectedAnswer)) {
    return c.json({ error: "selectedAnswer must be an array of strings" }, 400);
  }

  const questionIds: string[] = JSON.parse(attempt.question_ids_json);
  if (!questionIds.includes(body.questionId)) {
    return c.json({ error: "Question is not part of this attempt" }, 400);
  }

  const replay = await storedPracticeAnswer(c.env.DB, id, body.questionId);
  if (replay) return c.json(replay);

  const question = await c.env.DB.prepare("SELECT type, correct_answers_json, explanation, answer_revision, answer_revised_at FROM questions WHERE id = ?")
    .bind(body.questionId)
    .first<{ type: string; correct_answers_json: string; explanation: string | null; answer_revision: number; answer_revised_at: string | null }>();
  if (!question) return c.json({ error: "Question not found" }, 404);

  const correctAnswers = JSON.parse(question.correct_answers_json) as string[];
  const isCorrect = isAnswerCorrect(question.type, body.selectedAnswer, correctAnswers);
  const now = new Date().toISOString();
  const answerId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO attempt_answers (id, attempt_id, question_id, selected_answer_json, is_correct, time_spent_seconds, answered_at, answer_revision, graded_answers_json)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM attempts WHERE id = ? AND completed_at IS NULL)
       ON CONFLICT(attempt_id, question_id) DO NOTHING`
    ).bind(
      answerId,
      id,
      body.questionId,
      JSON.stringify(body.selectedAnswer),
      isCorrect ? 1 : 0,
      body.timeSpentSeconds ?? null,
      now, question.answer_revision, question.correct_answers_json, id
    ),
  ];
  // A question the user did not answer is not a question they got wrong (FR-5.1),
  // in practice exactly as in mock — this guard used to exist only on the mock
  // path, so the same empty submission landed in the Wrong Question Book or not
  // depending on which mode it arrived through.
  if (!isCorrect && hasAnswer(question.type, body.selectedAnswer)) {
    statements.push(wrongBookUpsert(c.env.DB, userId, body.questionId, now, answerId));
  }
  const [saved] = await c.env.DB.batch(statements);
  if (!saved!.meta.changes) {
    // Lost the race to a concurrent write of this same answer, or the attempt
    // was completed underneath us. Only the latter has nothing to report — and
    // note the wrong-book statement above is guarded on THIS request's own
    // answer id, so losing the race cannot have double-counted the question.
    const raced = await storedPracticeAnswer(c.env.DB, id, body.questionId);
    return raced ? c.json(raced) : c.json({ error: "Attempt already completed" }, 409);
  }

  const response: SubmitPracticeAnswerResponse = { isCorrect, correctAnswers, explanation: question.explanation, answerRevision: question.answer_revision, answerRevisedAt: question.answer_revised_at };
  return c.json(response);
});

// Mock draft and flag writes refused because the attempt was submitted
// elsewhere (another tab or device). `completed` tells the client to stop
// replaying its local drafts and fetch the result instead: POST /complete
// returns the finished attempt's result without regrading it.
const ALREADY_COMPLETED = { error: "Attempt already completed", completed: true } as const;

attemptsRouter.put("/:id/answers/:questionId", async (c) => {
  const id = c.req.param("id");
  const questionId = c.req.param("questionId");
  const attempt = await loadOwnAttempt(c.env.DB, id, c.get("user").id);
  if (!attempt) return c.json({ error: "Attempt not found" }, 404);
  if (attempt.mode !== "mock") return c.json({ error: "This attempt is not in mock mode" }, 400);
  if (attempt.completed_at) return c.json(ALREADY_COMPLETED, 409);

  const questionIds: string[] = JSON.parse(attempt.question_ids_json);
  if (!questionIds.includes(questionId)) return c.json({ error: "Question is not part of this attempt" }, 400);

  const body = await c.req.json<SaveDraftAnswerRequest>().catch(() => null);
  if (!body || !Array.isArray(body.selectedAnswer)) return c.json({ error: "selectedAnswer is required" }, 400);
  // Not merely "an array": a non-string element survives the draft write and
  // then throws inside grading at submission, leaving an attempt that cannot be
  // completed at all. The boundary is the only place this can be caught cheaply.
  if (!isStringArray(body.selectedAnswer)) {
    return c.json({ error: "selectedAnswer must be an array of strings" }, 400);
  }

  // `expired` is what tells the client to stop retrying and auto-submit; a bare
  // 409 is indistinguishable from the "already completed" case below, and the
  // client's retry copy ("it will be retried before submitting") would be a
  // promise it cannot keep.
  if (isPastDeadline(attempt, Date.now())) {
    return c.json({ error: "This mock exam has ended and no longer accepts answers", expired: true }, 409);
  }

  // draft_revision is the token POST /:id/complete guards its whole grading
  // batch on (migrations/0030) — every accepted draft write has to move it, or
  // a submission could grade a draft that changed underneath it.
  const saved = await c.env.DB.prepare(
    `UPDATE attempts SET draft_answers_json = json_patch(
       CASE WHEN json_valid(draft_answers_json) THEN
         CASE WHEN json_type(draft_answers_json) = 'object' THEN draft_answers_json ELSE '{}' END
       ELSE '{}' END, ?), draft_revision = draft_revision + 1
     WHERE id = ? AND completed_at IS NULL
       AND (time_limit_seconds IS NULL OR unixepoch(started_at, 'subsec') + time_limit_seconds + ? >= unixepoch('subsec'))`
  )
    .bind(JSON.stringify({ [questionId]: body.selectedAnswer }), id, MOCK_SUBMIT_GRACE_SECONDS).run();
  if (!saved.meta.changes) {
    const current = await loadOwnAttempt(c.env.DB, id, c.get("user").id);
    return current?.completed_at
      ? c.json(ALREADY_COMPLETED, 409)
      : c.json({ error: "This mock exam has ended and no longer accepts answers", expired: true }, 409);
  }

  return c.json({ saved: true });
});

attemptsRouter.put("/:id/flags/:questionId", async (c) => {
  const id = c.req.param("id");
  const questionId = c.req.param("questionId");
  const attempt = await loadOwnAttempt(c.env.DB, id, c.get("user").id);
  if (!attempt) return c.json({ error: "Attempt not found" }, 404);
  if (attempt.mode !== "mock") return c.json({ error: "This attempt is not in mock mode" }, 400);
  if (attempt.completed_at) return c.json(ALREADY_COMPLETED, 409);

  const questionIds: string[] = JSON.parse(attempt.question_ids_json);
  if (!questionIds.includes(questionId)) return c.json({ error: "Question is not part of this attempt" }, 400);

  const body = await c.req.json<SaveFlagRequest>().catch(() => null);
  if (!body || typeof body.flagged !== "boolean") return c.json({ error: "flagged is required" }, 400);

  // Deliberately does NOT bump draft_revision: flags are not graded, so a flag
  // toggled while a submission is in flight must not invalidate it. For the
  // same reason it is not subject to the deadline either — a flag cannot change
  // a result, so refusing one past the bell would cost the user a review marker
  // to protect nothing.
  const saved = await c.env.DB.prepare("UPDATE attempts SET flagged_json = json_patch(COALESCE(flagged_json, '{}'), ?) WHERE id = ? AND completed_at IS NULL")
    .bind(JSON.stringify({ [questionId]: body.flagged }), id).run();
  if (!saved.meta.changes) return c.json(ALREADY_COMPLETED, 409);

  return c.json({ saved: true });
});

attemptsRouter.post("/:id/complete", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const attempt = await loadOwnAttempt(c.env.DB, id, userId);
  if (!attempt) return c.json({ error: "Attempt not found" }, 404);

  if (!attempt.completed_at) {
    const questionIds: string[] = JSON.parse(attempt.question_ids_json);
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    let totalQuestions: number;

    if (attempt.mode === "mock") {
      // Mock never grades until now: score every question in the attempt
      // against its draft (ungraded) selection, in one shot.
      const { results: questionRows } = await c.env.DB.prepare(
        "SELECT id, type, correct_answers_json, answer_revision FROM questions WHERE id IN (SELECT value FROM json_each(?))"
      )
        .bind(JSON.stringify(questionIds))
        .all<{ id: string; type: string; correct_answers_json: string; answer_revision: number }>();
      const questionsById = new Map((questionRows ?? []).map((q) => [q.id, q]));

      const draft = readMockDraft(attempt);
      for (const qid of questionIds) {
        const q = questionsById.get(qid);
        if (!q) continue;
        const correctAnswers = JSON.parse(q.correct_answers_json) as string[];
        const selected = draft[qid] ?? [];
        const isCorrect = hasAnswer(q.type, selected) && isAnswerCorrect(q.type, selected, correctAnswers);
        const answerId = crypto.randomUUID();
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO attempt_answers (id, attempt_id, question_id, selected_answer_json, is_correct, time_spent_seconds, answered_at, answer_revision, graded_answers_json)
             SELECT ?, ?, ?, ?, ?, NULL, ?, ?, ? WHERE EXISTS (
               SELECT 1 FROM attempts WHERE id = ? AND completed_at IS NULL AND draft_revision = ?
             ) ON CONFLICT(attempt_id, question_id) DO NOTHING`
          ).bind(answerId, id, qid, JSON.stringify(selected), isCorrect ? 1 : 0, now, q.answer_revision, q.correct_answers_json, id, attempt.draft_revision)
        );
        if (!isCorrect && hasAnswer(q.type, selected)) statements.push(wrongBookUpsert(c.env.DB, userId, qid, now, answerId));
      }
      totalQuestions = questionIds.length;
    } else {
      // Practice questions are already graded and persisted one at a time by
      // POST /:id/answers (ending a session early just means fewer of them
      // exist) — completing only finalizes timing and the answered count.
      const { results: gradedRows } = await c.env.DB.prepare(
        "SELECT is_correct FROM attempt_answers WHERE attempt_id = ?"
      )
        .bind(id)
        .all<{ is_correct: number }>();
      totalQuestions = (gradedRows ?? []).length;
    }

    const startedMs = new Date(attempt.started_at).getTime();
    // Clamped to the limit the attempt was given: a timed mock that the user
    // left open overnight and submitted the next morning used to report the
    // whole night as time used, in the results screen and in every statistic
    // built on duration_seconds. Answers past the deadline are already refused,
    // so the extra wall-clock time bought nothing and should not be reported.
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedMs) / 1000));
    const durationSeconds = attempt.time_limit_seconds != null
      ? Math.min(elapsedSeconds, attempt.time_limit_seconds)
      : elapsedSeconds;

    // Finalize timing, counts and score in the grading transaction. Late
    // answers cannot sneak in after completion or be omitted from its score.
    //
    // draft_revision is 0 and never moves for practice (only mock writes
    // drafts), so the guard is a no-op there and costs nothing.
    const countSql = attempt.mode === "mock" ? "?" : "(SELECT COUNT(*) FROM attempt_answers WHERE attempt_id = ?)";
    const countArg = attempt.mode === "mock" ? totalQuestions : id;
    statements.push(c.env.DB.prepare(
      `UPDATE attempts SET completed_at = ?, duration_seconds = ?, total_questions = ${countSql},
       score = COALESCE(ROUND(100.0 * (SELECT SUM(is_correct) FROM attempt_answers WHERE attempt_id = ?) / NULLIF(${countSql}, 0)), 0)
       WHERE id = ? AND completed_at IS NULL AND draft_revision = ?`
    ).bind(now, durationSeconds, countArg, id, countArg, id, attempt.draft_revision));
    const results = await c.env.DB.batch(statements);
    if (!results[results.length - 1]!.meta.changes) {
      const current = await loadOwnAttempt(c.env.DB, id, userId);
      if (!current?.completed_at) return c.json({ error: "Answers changed during submission. Please submit again." }, 409);
    }

    // The Stats dashboard (routes/stats.ts) caches its computed response in
    // KV; drop it now so the numbers are correct the moment the user gets
    // there, rather than waiting out the cache's TTL.
    await invalidateExamStats(c.env, userId, attempt.exam_id);
  }

  const [finalAttempt, exam, breakdownRows] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM attempts WHERE id = ?").bind(id).first<AttemptRow>(),
    loadExamPassRule(c.env.DB, attempt.exam_id),
    c.env.DB.prepare(
      `SELECT aa.question_id, aa.selected_answer_json, aa.is_correct, q.correct_answers_json, aa.graded_answers_json, aa.answer_revision, q.answer_revision AS current_answer_revision, q.answer_revised_at
       FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id
       WHERE aa.attempt_id = ?`
    )
      .bind(id)
      .all<{ question_id: string; selected_answer_json: string; is_correct: number; correct_answers_json: string; graded_answers_json: string | null; answer_revision: number | null; current_answer_revision: number; answer_revised_at: string | null }>(),
  ]);

  const breakdown = (breakdownRows.results ?? []).map((r) => ({
    questionId: r.question_id,
    selectedAnswer: JSON.parse(r.selected_answer_json) as string[],
    correctAnswers: JSON.parse(r.correct_answers_json) as string[],
    gradedAnswers: r.graded_answers_json ? JSON.parse(r.graded_answers_json) as string[] : null,
    answerRevision: r.answer_revision,
    currentAnswerRevision: r.current_answer_revision,
    answerRevisedAt: r.answer_revised_at,
    isCorrect: r.is_correct === 1,
  }));

  const correctCount = breakdown.filter((b) => b.isCorrect).length;
  const score = finalAttempt?.score ?? 0;
  const totalQuestions = finalAttempt?.total_questions ?? breakdown.length;
  const passed = exam ? isMockPassed(exam, { correctCount, totalQuestions, score }) : null;

  const response: CompleteAttemptResponse = {
    attemptId: id,
    mode: (finalAttempt?.mode ?? attempt.mode) as AttemptMode,
    score,
    passed,
    requiredCorrect: requiredCorrectFor(exam?.officialFormat ?? null, totalQuestions),
    totalQuestions,
    correctCount,
    durationSeconds: finalAttempt?.duration_seconds ?? 0,
    breakdown,
  };
  return c.json(response);
});
