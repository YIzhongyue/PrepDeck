// implementation — question selection for the daily review email. Modeled on the
// existing wrong-book/bookmark/unattempted queries in routes/practice.ts,
// routes/attempts.ts and routes/wrongBook.ts, but server-side and scoped
// across all exams rather than one examId.
//
// Deliberately never selects correct_answers_json or explanation: the email
// must not expose answers by default (implementation), so leaking one would be an
// immediately-visible query/type error rather than a silent rendering bug.

import type { DailyEmailSource, QuestionOption, QuestionContentModel } from "@prepdeck/shared";
import { tagsJsonExpr } from "./questionManagement";

export interface DailyReviewQuestion {
  id: string;
  examId: string;
  examName: string;
  examSlug: string;
  externalId: string | null;
  sequenceNumber: number;
  type: string;
  stem: string;
  options: QuestionOption[] | null;
  content?: QuestionContentModel;
  tags: string[];
}

export interface QuestionRow {
  id: string;
  exam_id: string;
  exam_name: string;
  exam_slug: string;
  external_id: string | null;
  sequence_number: number;
  type: string;
  stem: string;
  options_json: string | null;
  content_json?: string | null;
  tags_json: string | null;
}

// Exported for reuse by lib/practiceSelection.ts (implementation's User MCP
// study-selection tools), which needs the exact same answer-less projection
// but a different (SQL-side-bounded, strictly-excluding) selection strategy
// — see that file's header comment for why it doesn't reuse
// selectDailyReviewQuestions itself.
export const SELECT_COLUMNS =
  `q.id, q.exam_id, e.name AS exam_name, e.slug AS exam_slug, q.external_id, q.sequence_number, q.type, q.stem, q.options_json, q.content_json, ${tagsJsonExpr("q")} AS tags_json`;

export function toDailyReviewQuestion(row: QuestionRow): DailyReviewQuestion {
  return {
    id: row.id,
    examId: row.exam_id,
    examName: row.exam_name,
    examSlug: row.exam_slug,
    externalId: row.external_id,
    sequenceNumber: row.sequence_number,
    type: row.type,
    stem: row.stem,
    options: row.options_json ? JSON.parse(row.options_json) : null,
    ...(row.content_json ? { content: JSON.parse(row.content_json) } : {}),
    tags: row.tags_json ? JSON.parse(row.tags_json) : []
  };
}

// The last few days' question ids for this user, most recent delivery
// first — used both to keep selection varied and (by the caller) to check
// whether today's delivery has already been claimed.
export async function recentlySentQuestionIds(db: D1Database, userId: string, lookbackDeliveries = 3): Promise<Set<string>> {
  const rows = await db
    .prepare("SELECT question_ids_json FROM daily_review_email_deliveries WHERE user_id = ? ORDER BY local_date DESC LIMIT ?")
    .bind(userId, lookbackDeliveries)
    .all<{ question_ids_json: string }>();
  const ids = new Set<string>();
  for (const row of rows.results ?? []) {
    for (const id of JSON.parse(row.question_ids_json) as string[]) ids.add(id);
  }
  return ids;
}

async function selectWrong(db: D1Database, userId: string, limit: number, exclude: Set<string>): Promise<DailyReviewQuestion[]> {
  return selectFromCandidates(
    db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM wrong_question_book w
       JOIN questions q ON q.id = w.question_id
       JOIN exams e ON e.id = q.exam_id
       WHERE w.user_id = ? AND w.mastered = 0`
    ).bind(userId),
    limit,
    exclude
  );
}

async function selectBookmarks(db: D1Database, userId: string, limit: number, exclude: Set<string>): Promise<DailyReviewQuestion[]> {
  return selectFromCandidates(
    db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM bookmarks b
       JOIN questions q ON q.id = b.question_id
       JOIN exams e ON e.id = q.exam_id
       WHERE b.user_id = ?`
    ).bind(userId),
    limit,
    exclude
  );
}

async function selectUnattempted(db: D1Database, userId: string, limit: number, exclude: Set<string>): Promise<DailyReviewQuestion[]> {
  return selectFromCandidates(
    db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM questions q
       JOIN exams e ON e.id = q.exam_id
       WHERE q.id NOT IN (
         SELECT DISTINCT aa.question_id FROM attempt_answers aa
         JOIN attempts a ON a.id = aa.attempt_id
         WHERE a.user_id = ?
       )`
    ).bind(userId),
    limit,
    exclude
  );
}

// Fetches the full eligible pool for the source (D1 has no huge tables here,
// and "eligible" sets are inherently small — wrong book / bookmarks / an
// exam's question bank), then does the recent-repeat exclusion and random
// sampling in JS so a too-aggressive exclusion never returns fewer than
// `limit` questions when a larger eligible pool exists.
async function selectFromCandidates(
  statement: ReturnType<D1Database["prepare"]>,
  limit: number,
  exclude: Set<string>
): Promise<DailyReviewQuestion[]> {
  const rows = await statement.all<QuestionRow>();
  const all = (rows.results ?? []).map(toDailyReviewQuestion);
  const fresh = all.filter((q) => !exclude.has(q.id));
  const pool = fresh.length >= limit ? fresh : all;
  return shuffle(pool).slice(0, limit);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

export async function selectDailyReviewQuestions(
  db: D1Database,
  userId: string,
  source: DailyEmailSource,
  limit: number,
  exclude: Set<string> = new Set()
): Promise<DailyReviewQuestion[]> {
  switch (source) {
    case "wrong":
      return selectWrong(db, userId, limit, exclude);
    case "bm":
      return selectBookmarks(db, userId, limit, exclude);
    case "new":
      return selectUnattempted(db, userId, limit, exclude);
  }
}
