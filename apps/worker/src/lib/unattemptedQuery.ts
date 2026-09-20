// implementation — deterministic, paginated unattempted-question listing for the
// User MCP. This is deliberately separate from
// lib/dailyReviewSelection.ts's selectUnattempted, which is randomized and
// unpaginated by design (built for a one-shot email pick, not a browsable
// list) — see practiceSelection.ts's header comment for why that function
// isn't reused for MCP tools either.

import { questionSelectColumns, toQuestion, type QuestionRow } from "./questionManagement";
import type { Question } from "@prepdeck/shared";

// Ordered by the exam's own sequence, with `id` as a stable tiebreak.
export async function listUnattemptedQuestions(
  db: D1Database,
  userId: string,
  examId: string,
  opts: { limit: number; offset: number },
): Promise<Question[]> {
  const { results } = await db.prepare(
    `SELECT ${questionSelectColumns("q")} FROM questions q
     WHERE q.exam_id = ?
       AND q.id NOT IN (
         SELECT DISTINCT aa.question_id FROM attempt_answers aa
         JOIN attempts a ON a.id = aa.attempt_id
         WHERE a.user_id = ?
       )
     ORDER BY q.sequence_number ASC, q.id ASC
     LIMIT ? OFFSET ?`,
  ).bind(examId, userId, opts.limit + 1, opts.offset).all<QuestionRow>();
  return (results ?? []).map(toQuestion);
}
