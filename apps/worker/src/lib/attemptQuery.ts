// implementation — read-only attempt history queries for the User MCP. No REST
// equivalent exists for these today: routes/attempts.ts only supports
// starting/answering/completing an attempt, never listing past ones or
// re-fetching one's detail after the fact (its /:id/complete response is
// the only place a breakdown is ever built, and only once, at completion
// time). These functions are pure reads — they never write attempts,
// attempt_answers, or anything else.

import { isMockPassed, type Attempt, type AttemptMode } from "@prepdeck/shared";
import { loadExamPassRule } from "./examManagement";

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
  flagged_json: string | null;
}

export function toAttempt(row: AttemptRow): Attempt {
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
  };
}

// Secondary sort key `id` (like listExams's `e.id` tiebreak in
// examManagement.ts) so pagination is stable when two attempts share the
// same started_at timestamp.
export async function listAttempts(
  db: D1Database,
  userId: string,
  opts: { examId?: string; mode?: AttemptMode; completedOnly?: boolean; limit: number; offset: number },
): Promise<AttemptRow[]> {
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.examId) { conditions.push("exam_id = ?"); params.push(opts.examId); }
  if (opts.mode) { conditions.push("mode = ?"); params.push(opts.mode); }
  if (opts.completedOnly) conditions.push("completed_at IS NOT NULL");
  const { results } = await db.prepare(
    `SELECT * FROM attempts WHERE ${conditions.join(" AND ")} ORDER BY started_at DESC, id ASC LIMIT ? OFFSET ?`,
  ).bind(...params, opts.limit + 1, opts.offset).all<AttemptRow>();
  return results ?? [];
}

export interface AttemptBreakdownRow {
  questionId: string;
  selectedAnswer: string[];
  correctAnswers: string[];
  isCorrect: boolean;
  gradedAnswers: string[] | null;
  answerRevision: number | null;
  currentAnswerRevision: number;
  answerRevisedAt: string | null;
}

interface BreakdownDbRow {
  question_id: string;
  selected_answer_json: string;
  is_correct: number;
  correct_answers_json: string;
  graded_answers_json: string | null;
  answer_revision: number | null;
  current_answer_revision: number;
  answer_revised_at: string | null;
}

export interface AttemptDetail {
  attempt: Attempt;
  breakdown: AttemptBreakdownRow[];
  breakdownNextOffset: number | null;
  passed: boolean | null;
}

// Scoped by `user_id = ?` directly in the WHERE clause (mismatch => null,
// same not-found-not-forbidden rationale as loadOwnAttempt in
// routes/attempts.ts) — never throws on a wrong-owner id, callers translate
// null to McpApplicationError("not_found") so existence isn't leaked.
export async function getAttemptDetail(
  db: D1Database,
  userId: string,
  attemptId: string,
  page: { breakdownLimit: number; breakdownOffset: number },
): Promise<AttemptDetail | null> {
  const row = await db.prepare("SELECT * FROM attempts WHERE id = ? AND user_id = ?")
    .bind(attemptId, userId).first<AttemptRow>();
  if (!row) return null;

  const [rule, correct] = await Promise.all([
    loadExamPassRule(db, row.exam_id),
    db.prepare("SELECT COALESCE(SUM(is_correct), 0) AS n FROM attempt_answers WHERE attempt_id = ?").bind(attemptId).first<{ n: number }>(),
  ]);

  // Ordered by the question's own sequence within the exam (not
  // answered_at), with question_id as a stable tiebreak — a deterministic,
  // browsable page order independent of answer timing.
  const { results } = await db.prepare(
    `SELECT aa.question_id, aa.selected_answer_json, aa.is_correct, q.correct_answers_json,
            aa.graded_answers_json, aa.answer_revision, q.answer_revision AS current_answer_revision, q.answer_revised_at
     FROM attempt_answers aa
     JOIN questions q ON q.id = aa.question_id
     WHERE aa.attempt_id = ?
     ORDER BY q.sequence_number ASC, aa.question_id ASC
     LIMIT ? OFFSET ?`,
  ).bind(attemptId, page.breakdownLimit + 1, page.breakdownOffset).all<BreakdownDbRow>();

  const rows = results ?? [];
  const hasMore = rows.length > page.breakdownLimit;
  const windowed = rows.slice(0, page.breakdownLimit);

  const breakdown: AttemptBreakdownRow[] = windowed.map((r) => ({
    questionId: r.question_id,
    selectedAnswer: JSON.parse(r.selected_answer_json) as string[],
    correctAnswers: JSON.parse(r.correct_answers_json) as string[],
    isCorrect: r.is_correct === 1,
    gradedAnswers: r.graded_answers_json ? (JSON.parse(r.graded_answers_json) as string[]) : null,
    answerRevision: r.answer_revision,
    currentAnswerRevision: r.current_answer_revision,
    answerRevisedAt: r.answer_revised_at,
  }));

  // Recomputed live against the exam's CURRENT pass rule (official format, else
  // pass_mark_pct) — not a stored historical snapshot (attempts has no
  // `passed` column; REST's own /complete handler computes this the same way).
  // If the exam's pass rule changes later, this reflects the new value.
  const passed = row.score != null && rule
    ? isMockPassed(rule, { correctCount: correct?.n ?? 0, totalQuestions: row.total_questions ?? 0, score: row.score })
    : null;

  return {
    attempt: toAttempt(row),
    breakdown,
    breakdownNextOffset: hasMore ? page.breakdownOffset + page.breakdownLimit : null,
    passed,
  };
}
