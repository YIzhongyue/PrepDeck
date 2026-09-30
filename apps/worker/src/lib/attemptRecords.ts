// Shared stored rows and projections for attempt history and completion.
import type { Attempt, AttemptMode, AttemptBreakdownRow } from "@prepdeck/shared";

export interface AttemptRow {
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

export type AttemptSummary = Attempt & { questionIds: string[] };

export function toAttempt(row: AttemptRow): AttemptSummary {
  return {
    id: row.id,
    userId: row.user_id,
    examId: row.exam_id,
    mode: row.mode as AttemptMode,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationSeconds: row.duration_seconds,
    score: row.score,
    totalQuestions: row.total_questions,
    questionIds: JSON.parse(row.question_ids_json) as string[],
  };
}

export interface BreakdownDbRow {
  question_id: string;
  selected_answer_json: string;
  is_correct: number;
  correct_answers_json: string;
  graded_answers_json: string | null;
  answer_revision: number | null;
  current_answer_revision: number;
  answer_revised_at: string | null;
}

export function toAttemptBreakdown(r: BreakdownDbRow): AttemptBreakdownRow {
  return {
    questionId: r.question_id,
    selectedAnswer: JSON.parse(r.selected_answer_json) as string[],
    correctAnswers: JSON.parse(r.correct_answers_json) as string[],
    isCorrect: r.is_correct === 1,
    gradedAnswers: r.graded_answers_json ? (JSON.parse(r.graded_answers_json) as string[]) : null,
    answerRevision: r.answer_revision,
    currentAnswerRevision: r.current_answer_revision,
    answerRevisedAt: r.answer_revised_at,
  };
}

export async function loadAttemptBreakdown(db: D1Database, attemptId: string, page?: { limit: number; offset: number }) {
  // Ordered by the question's own sequence within the exam (not
  // answered_at), with question_id as a stable tiebreak — a deterministic,
  // browsable page order independent of answer timing.
  return db.prepare(
    `SELECT aa.question_id, aa.selected_answer_json, aa.is_correct, q.correct_answers_json,
            aa.graded_answers_json, aa.answer_revision, q.answer_revision AS current_answer_revision, q.answer_revised_at
     FROM attempt_answers aa
     JOIN questions q ON q.id = aa.question_id
     WHERE aa.attempt_id = ?
     ORDER BY q.sequence_number ASC, aa.question_id ASC
     ${page ? "LIMIT ? OFFSET ?" : ""}`,
  ).bind(attemptId, ...(page ? [page.limit, page.offset] : [])).all<BreakdownDbRow>();
}
