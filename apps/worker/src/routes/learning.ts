// docs/requirements/practice-and-learning-modes.md — Learning Mode (学习模式): a sequential, read-through study
// mode that (unlike Practice/Mock — see FR-3.4) reveals the correct answer
// immediately (FR-14.3), the current user's own past answer history for the
// question (FR-14.4), and — since it's a "review context" per FR-8.3/FR-11.6
// — reuses the existing annotations/notes/ai-explanations endpoints as-is
// (see index.ts). This file only adds the two things nothing else already
// provides: the full answer-key'd question + history (FR-14.4), and the
// per-user/per-exam resume position (FR-14.9).

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import type {
  AttemptMode,
  LearningHistoryEntry,
  LearningProgressResponse,
  LearningQuestionDetailResponse,
  SetLearningProgressRequest,
} from "@prepdeck/shared";

import { questionSelectColumns, toQuestion, type QuestionRow } from "../lib/questionManagement";
import { setLearningProgress } from "../lib/learningProgressMutation";
import { studyMutationStatus } from "../lib/studyMutationResult";

// Mounted at /api/questions/:questionId/learning-detail — FR-14.3/FR-14.4.
export const learningDetailRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

learningDetailRouter.get("/", async (c) => {
  const questionId = c.req.param("questionId");
  const userId = c.get("user").id;

  const questionRow = await c.env.DB.prepare(`SELECT ${questionSelectColumns()} FROM questions WHERE id = ?`)
    .bind(questionId)
    .first<QuestionRow>();
  if (!questionRow) return c.json({ error: "Question not found" }, 404);

  // FR-14.4: every past attempt_answer this user has recorded for this
  // question, from Practice or Mock (Learning Mode never creates its own —
  // FR-14.7). answered_at is NULL for rows written before that column
  // existed; fall back to the attempt's completed/started time so old data
  // still shows a reasonable timestamp instead of an empty one.
  const { results: historyRows } = await c.env.DB.prepare(
    `SELECT a.id AS attempt_id, a.mode, aa.selected_answer_json, aa.is_correct, aa.answer_revision, aa.graded_answers_json,
            COALESCE(aa.answered_at, a.completed_at, a.started_at) AS answered_at
     FROM attempt_answers aa
     JOIN attempts a ON a.id = aa.attempt_id
     WHERE a.user_id = ? AND aa.question_id = ?
     ORDER BY answered_at DESC`
  )
    .bind(userId, questionId)
    .all<{ attempt_id: string; mode: string; selected_answer_json: string; is_correct: number; answered_at: string; answer_revision: number | null; graded_answers_json: string | null }>();

  const history: LearningHistoryEntry[] = (historyRows ?? []).map((r) => ({
    attemptId: r.attempt_id,
    mode: r.mode as AttemptMode,
    selectedAnswer: JSON.parse(r.selected_answer_json),
    isCorrect: r.is_correct === 1,
    answeredAt: r.answered_at,
    answerRevision: r.answer_revision,
    gradedAnswers: r.graded_answers_json ? JSON.parse(r.graded_answers_json) : null,
  }));

  const response: LearningQuestionDetailResponse = { question: toQuestion(questionRow), history };
  return c.json(response);
});

interface ProgressRow {
  last_sequence_number: number;
}

// Mounted at /api/exams/:examId/learning/progress — FR-14.9.
export const learningProgressRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

learningProgressRouter.get("/", async (c) => {
  const examId = c.req.param("examId")!;
  const userId = c.get("user").id;

  const row = await c.env.DB.prepare("SELECT last_sequence_number FROM learning_progress WHERE user_id = ? AND exam_id = ?")
    .bind(userId, examId)
    .first<ProgressRow>();

  const response: LearningProgressResponse = { examId, lastSequenceNumber: row?.last_sequence_number ?? null };
  return c.json({ progress: response });
});

learningProgressRouter.put("/", async (c) => {
  const examId = c.req.param("examId")!;
  const userId = c.get("user").id;

  const body = await c.req.json<SetLearningProgressRequest>().catch(() => null);
  const result = await setLearningProgress(c.env.DB, userId, examId, body);
  return result.ok ? c.json(result.data) : c.json(result.error, studyMutationStatus(result.reason));
});
