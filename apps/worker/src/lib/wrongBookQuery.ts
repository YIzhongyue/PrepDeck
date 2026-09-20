// implementation — paginated, browsable Wrong Question Book listing for the User
// MCP. No REST equivalent exists today: routes/wrongBook.ts only toggles
// `mastered` (see its own header comment), and routes/practice.ts /
// lib/dailyReviewSelection.ts only ever need the unpaginated in-exam set or
// a randomized sample, never a stable page-able list.

import { questionSelectColumns, toQuestion, type QuestionRow } from "./questionManagement";
import type { Question } from "@prepdeck/shared";

export interface WrongQuestionEntry {
  question: Question;
  wrongCount: number;
  lastWrongAt: string;
  mastered: boolean;
}

interface WrongQuestionRow extends QuestionRow {
  wrong_count: number;
  last_wrong_at: string;
  mastered: number;
}

// Secondary sort key `question_id` so pagination is stable when two entries
// share the same last_wrong_at timestamp.
export async function listWrongQuestions(
  db: D1Database,
  userId: string,
  opts: { examId?: string; includeMastered?: boolean; limit: number; offset: number },
): Promise<WrongQuestionEntry[]> {
  const conditions = ["w.user_id = ?"];
  const params: unknown[] = [userId];
  if (!opts.includeMastered) conditions.push("w.mastered = 0");
  if (opts.examId) { conditions.push("q.exam_id = ?"); params.push(opts.examId); }
  const { results } = await db.prepare(
    `SELECT ${questionSelectColumns("q")}, w.wrong_count, w.last_wrong_at, w.mastered
     FROM wrong_question_book w
     JOIN questions q ON q.id = w.question_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY w.last_wrong_at DESC, w.question_id ASC
     LIMIT ? OFFSET ?`,
  ).bind(...params, opts.limit + 1, opts.offset).all<WrongQuestionRow>();
  return (results ?? []).map((row) => ({
    question: toQuestion(row),
    wrongCount: row.wrong_count,
    lastWrongAt: row.last_wrong_at,
    mastered: row.mastered === 1,
  }));
}
