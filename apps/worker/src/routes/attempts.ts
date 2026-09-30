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
import {
  startAttempt, submitPracticeAnswer, completeAttempt, loadOwnAttempt, readMockDraft,
  isPastDeadline, answerable, invalidAnswer, ANSWERABLE_COLUMNS,
  type AttemptRow, type AnswerableRow,
} from "../lib/attemptMutations";
import { studyMutationStatus } from "../lib/studyMutationResult";
import {
  answerProblem, answerSizeProblem, isStringArray, MOCK_SUBMIT_GRACE_SECONDS,
  type ActiveAttemptResponse, type AttemptMode, type SaveDraftAnswerRequest,
  type SaveFlagRequest, type StartAttemptRequest, type SubmitPracticeAnswerRequest,
} from "@prepdeck/shared";

// Mounted at /api/exams/:examId/attempts
export const examAttemptsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

examAttemptsRouter.post("/", async (c) => {
  const result = await startAttempt(c.env, c.get("user").id, c.req.param("examId")!, await c.req.json<StartAttemptRequest>().catch(() => null));
  return result.ok ? c.json(result.data, 201) : c.json(result.error, studyMutationStatus(result.reason));
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
  const result = await submitPracticeAnswer(c.env, c.get("user").id, c.req.param("id"), await c.req.json<SubmitPracticeAnswerRequest>().catch(() => null));
  return result.ok ? c.json(result.data) : c.json(result.error, studyMutationStatus(result.reason));
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
  // Checked before the write: the draft is merged into one attempts row with
  // json_patch, so an unbounded value would grow that row without limit.
  const tooLarge = answerSizeProblem(body.selectedAnswer);
  if (tooLarge) return c.json(invalidAnswer(tooLarge), 400);

  // `expired` is what tells the client to stop retrying and auto-submit; a bare
  // 409 is indistinguishable from the "already completed" case below, and the
  // client's retry copy ("it will be retried before submitting") would be a
  // promise it cannot keep.
  if (isPastDeadline(attempt, Date.now())) {
    return c.json({ error: "This mock exam has ended and no longer accepts answers", expired: true }, 409);
  }

  const question = await c.env.DB.prepare(`SELECT ${ANSWERABLE_COLUMNS} FROM questions WHERE id = ?`)
    .bind(questionId)
    .first<AnswerableRow>();
  if (!question) return c.json({ error: "Question not found" }, 404);
  const problem = answerProblem(answerable(question), body.selectedAnswer);
  if (problem) return c.json(invalidAnswer(problem), 400);

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
  const result = await completeAttempt(c.env, c.get("user").id, c.req.param("id"));
  return result.ok ? c.json(result.data) : c.json(result.error, studyMutationStatus(result.reason));
});
