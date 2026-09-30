// implementation — read-only attempt history queries for the User MCP. No REST
// equivalent exists for these today: routes/attempts.ts only supports
// starting/answering/completing an attempt, never listing past ones or
// re-fetching one's detail after the fact (its /:id/complete response is
// the only place a breakdown is ever built, and only once, at completion
// time). These functions are pure reads — they never write attempts,
// attempt_answers, or anything else.

import { isMockPassed, type AttemptMode, type AttemptBreakdownRow } from "@prepdeck/shared";
import { loadExamPassRule } from "./examManagement";
import { toAttempt, toAttemptBreakdown, loadAttemptBreakdown, type AttemptRow, type AttemptSummary } from "./attemptRecords";

export { toAttempt } from "./attemptRecords";

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

export interface AttemptDetail {
  attempt: AttemptSummary;
  breakdown: AttemptBreakdownRow[];
  breakdownNextOffset: number | null;
  passed: boolean | null;
}

// Scoped by `user_id = ?` directly in the WHERE clause (mismatch => null,
// same not-found-not-forbidden rationale as loadOwnAttempt in
// lib/attemptMutations.ts) — never throws on a wrong-owner id, callers translate
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

  const { results } = await loadAttemptBreakdown(db, attemptId, { limit: page.breakdownLimit + 1, offset: page.breakdownOffset });

  const rows = results ?? [];
  const hasMore = rows.length > page.breakdownLimit;
  const windowed = rows.slice(0, page.breakdownLimit);

  const breakdown = windowed.map(toAttemptBreakdown);

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
