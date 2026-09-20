// implementation — study-selection queries for the User MCP's
// get_practice_candidates / get_questions_for_review / get_recommended_questions
// tools.
//
// Deliberately NOT built on lib/dailyReviewSelection.ts's
// selectDailyReviewQuestions, which is correct for a best-effort daily email
// but wrong here for two reasons:
//   1. It loads the ENTIRE matching pool into JS before shuffling
//      (selectFromCandidates's `rows.all()` with no LIMIT) — unbounded
//      Worker memory for a large wrong-book/bookmark/unattempted set.
//   2. Its exclude-set is soft: `const pool = fresh.length >= limit ? fresh
//      : all;` — falls back to the full, unfiltered pool (bringing back
//      already-excluded ids) whenever fewer than `limit` fresh rows remain.
//      That's the right trade-off for "avoid repeating the last few days'
//      emails when possible"; it's the wrong one for
//      get_recommended_questions, which must return strictly disjoint ids
//      across its wrong -> bookmarked -> unattempted passes.
//
// Every query here instead does both the random sampling (`ORDER BY
// RANDOM() LIMIT ?`) and the exclusion in SQL, so both problems disappear at
// the source: bounded rows read, and exclusion is a hard `NOT IN` that never
// falls back.
//
// Reuses dailyReviewSelection.ts's DailyReviewQuestion shape/columns (never
// selects correct_answers_json/explanation) — a deliberate, SEPARATE
// decision from user_search_questions/user_get_question returning full
// answers: these are pre-practice candidate pools, and handing out the
// answer before practicing defeats their purpose (the same rationale
// dailyReviewSelection.ts's own header comment already states).

import {
  SELECT_COLUMNS, toDailyReviewQuestion,
  type DailyReviewQuestion, type QuestionRow as DailyReviewQuestionRow,
} from "./dailyReviewSelection";
import { normalizeTagKey } from "./questionBankTags";
export type { DailyReviewQuestion };

export interface CandidateFilters {
  examId?: string;
  type?: string;
  difficulty?: string;
  tag?: string;
  unattemptedOnly?: boolean;
  wrongOnly?: boolean;
  bookmarkedOnly?: boolean;
  excludeIds?: string[];
}

function baseConditions(userId: string, filters: CandidateFilters): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.examId) { conditions.push("q.exam_id = ?"); params.push(filters.examId); }
  if (filters.type) { conditions.push("q.type = ?"); params.push(filters.type); }
  if (filters.difficulty) { conditions.push("q.difficulty = ?"); params.push(filters.difficulty); }
  if (filters.tag) {
    conditions.push("EXISTS (SELECT 1 FROM question_tag_links l JOIN question_bank_tags t ON t.id = l.tag_id WHERE l.question_id = q.id AND t.normalized_name = ?)");
    params.push(normalizeTagKey(filters.tag));
  }
  if (filters.unattemptedOnly) {
    conditions.push(
      `q.id NOT IN (SELECT DISTINCT aa.question_id FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id WHERE a.user_id = ?)`,
    );
    params.push(userId);
  }
  if (filters.wrongOnly) {
    conditions.push(`q.id IN (SELECT question_id FROM wrong_question_book WHERE user_id = ? AND mastered = 0)`);
    params.push(userId);
  }
  if (filters.bookmarkedOnly) {
    conditions.push(`q.id IN (SELECT question_id FROM bookmarks WHERE user_id = ?)`);
    params.push(userId);
  }
  if (filters.excludeIds && filters.excludeIds.length > 0) {
    // A single JSON parameter, not one bound parameter per excluded id.
    // get_recommended_questions calls these functions with an exclude list
    // that grows with `limit` (up to 100) across its wrong -> bookmarked ->
    // unattempted passes; a `q.id NOT IN (?,?,?,...)` expansion could push a
    // single schema-valid request past D1's documented 100-bound-parameter
    // limit per statement (https://developers.cloudflare.com/d1/platform/limits/)
    // once combined with the other conditions below, failing a request that
    // should simply return the remaining candidates.
    conditions.push(`q.id NOT IN (SELECT value FROM json_each(?))`);
    params.push(JSON.stringify(filters.excludeIds));
  }
  return { conditions, params };
}

// get_practice_candidates: all supplied flags are ANDed — a question must
// satisfy every enabled restriction simultaneously (e.g.
// wrongOnly + bookmarkedOnly returns only questions that are both).
export async function selectQuestions(
  db: D1Database,
  userId: string,
  filters: CandidateFilters,
  limit: number,
): Promise<DailyReviewQuestion[]> {
  const { conditions, params } = baseConditions(userId, filters);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { results } = await db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM questions q JOIN exams e ON e.id = q.exam_id ${where} ORDER BY RANDOM() LIMIT ?`,
  ).bind(...params, limit).all<DailyReviewQuestionRow>();
  return (results ?? []).map(toDailyReviewQuestion);
}

export interface ReviewFilters {
  examId?: string;
  type?: string;
  difficulty?: string;
  tag?: string;
  source?: "wrong" | "bookmarked" | "both";
  excludeIds?: string[];
}

// get_questions_for_review: `source` drives an IN/OR condition (not
// AND-able flags) — "both" (the default) is questions that are EITHER
// wrong-booked (unmastered) OR bookmarked.
export async function selectQuestionsForReview(
  db: D1Database,
  userId: string,
  filters: ReviewFilters,
  limit: number,
): Promise<DailyReviewQuestion[]> {
  const { conditions, params } = baseConditions(userId, {
    examId: filters.examId, type: filters.type, difficulty: filters.difficulty, tag: filters.tag,
    excludeIds: filters.excludeIds,
  });
  const source = filters.source ?? "both";
  const wrongClause = `q.id IN (SELECT question_id FROM wrong_question_book WHERE user_id = ? AND mastered = 0)`;
  const bookmarkedClause = `q.id IN (SELECT question_id FROM bookmarks WHERE user_id = ?)`;
  if (source === "wrong") { conditions.push(wrongClause); params.push(userId); }
  else if (source === "bookmarked") { conditions.push(bookmarkedClause); params.push(userId); }
  else { conditions.push(`(${wrongClause} OR ${bookmarkedClause})`); params.push(userId, userId); }

  const { results } = await db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM questions q JOIN exams e ON e.id = q.exam_id WHERE ${conditions.join(" AND ")} ORDER BY RANDOM() LIMIT ?`,
  ).bind(...params, limit).all<DailyReviewQuestionRow>();
  return (results ?? []).map(toDailyReviewQuestion);
}
