// implementation — paginated, browsable bookmark listing for the User MCP.
// routes/bookmarks.ts is toggle-only today ("Browsing a 'My Bookmarks' page
// is section 3.6 and out of scope here" — its own header comment), so this
// has no REST equivalent to reuse.

import { questionSelectColumns, toQuestion, type QuestionRow } from "./questionManagement";
import type { Question } from "@prepdeck/shared";

export interface BookmarkedQuestionEntry {
  question: Question;
  createdAt: string;
}

interface BookmarkedQuestionRow extends QuestionRow {
  bookmarked_at: string;
}

// Secondary sort key `question_id` so pagination is stable when two
// bookmarks share the same created_at timestamp.
export async function listBookmarkedQuestions(
  db: D1Database,
  userId: string,
  opts: { examId?: string; limit: number; offset: number },
): Promise<BookmarkedQuestionEntry[]> {
  const conditions = ["b.user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.examId) { conditions.push("q.exam_id = ?"); params.push(opts.examId); }
  const { results } = await db.prepare(
    `SELECT ${questionSelectColumns("q")}, b.created_at AS bookmarked_at
     FROM bookmarks b
     JOIN questions q ON q.id = b.question_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY b.created_at DESC, b.question_id ASC
     LIMIT ? OFFSET ?`,
  ).bind(...params, opts.limit + 1, opts.offset).all<BookmarkedQuestionRow>();
  return (results ?? []).map((row) => ({
    question: toQuestion(row),
    createdAt: row.bookmarked_at,
  }));
}
