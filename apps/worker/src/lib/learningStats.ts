// Extracted out of routes/stats.ts so the per-user stats computations can be
// shared verbatim between the REST dashboard (routes/stats.ts, KV-cached via
// lib/statsCache.ts) and the User MCP's read-only tools (mcp/adapter.ts), per
// implementation's "reuse existing application/service/query logic where
// practical". Every query here scopes to `attempts.user_id = userId`.
//
// Answer figures count GRADED answers (issue #40): a practice answer is graded
// and locked the moment it is checked, so it counts from then on, whether or
// not the session was ever ended; a mock's answers exist only once the mock is
// submitted (its drafts live in attempts.draft_answers_json, never here).
// Answers are dated by when they were answered, not by when their session
// closed. Sessions, their durations and mock scores still come from completed
// attempts.

import type {
  AccuracyTrendPoint,
  AccuracyWindow,
  DifficultyBreakdown,
  ExamStatsResponse,
  MockScoreHistoryEntry,
  StudyActivityDay,
  StudyActivityResponse,
  TagBreakdown,
} from "@prepdeck/shared";
import { STATS_SCHEMA_VERSION, effectivePassMarkPct, isMockPassed } from "@prepdeck/shared";
import { loadExamPassRule } from "./examManagement";

// The answers a statistic may count, for a query joining attempts `a`.
export const GRADED_ANSWER_SQL = "(a.mode = 'practice' OR a.completed_at IS NOT NULL)";
// When an answer was given. Rows written before answered_at existed (0009)
// fall back to their session's times.
export const ANSWERED_AT_SQL = "COALESCE(aa.answered_at, a.completed_at, a.started_at)";
// Latest study activity for one user and exam: a closed session or an answer.
const LAST_ACTIVITY_SQL = `SELECT MAX(at) AS last_at FROM (
  SELECT MAX(completed_at) AS at FROM attempts WHERE user_id = ? AND exam_id = ? AND completed_at IS NOT NULL
  UNION ALL
  SELECT MAX(${ANSWERED_AT_SQL}) AS at FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
  WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}
)`;

// Exported for reuse by mcp/adapter.ts's get_learning_overview, which
// computes its own per-exam accuracy percentages outside computeExamStats.
export function pct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

// UTC day boundaries for the trailing comparison windows (implementation,
// decision 2). `completed_at` is a UTC ISO-8601 string, so a lexical `>=`
// against another UTC ISO string is a chronological comparison.
export const ACCURACY_WINDOW_DAYS = 7;

function utcDayStart(at: Date, daysBack: number): string {
  const ms = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) - daysBack * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

export async function computeExamStats(db: D1Database, userId: string, examId: string, now: Date = new Date()): Promise<ExamStatsResponse | null> {
  const rule = await loadExamPassRule(db, examId);
  if (!rule) return null;
  const exam = { id: examId };

  // Current window: the last ACCURACY_WINDOW_DAYS UTC days, today included.
  // Previous window: the ACCURACY_WINDOW_DAYS days immediately before it.
  const currentWindowStart = utcDayStart(now, ACCURACY_WINDOW_DAYS - 1);
  const previousWindowStart = utcDayStart(now, ACCURACY_WINDOW_DAYS * 2 - 1);

  const [overall, bank, inBank, trendRows, tagRows, difficultyRows, mockRows, lastAttempt, windowRows, freshRow] = await Promise.all([
    db.prepare(
      `SELECT COUNT(DISTINCT aa.question_id) AS attempted_questions,
              COUNT(*) AS total_answers, COALESCE(SUM(aa.is_correct), 0) AS correct_answers
       FROM attempt_answers aa
       JOIN attempts a ON a.id = aa.attempt_id
       WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}`
    )
      .bind(userId, examId)
      .first<{ attempted_questions: number; total_answers: number; correct_answers: number }>(),

    // The coverage denominator, stated explicitly rather than inferred from
    // whatever the client happens to have cached.
    db.prepare("SELECT COUNT(*) AS bank_size FROM questions WHERE exam_id = ?")
      .bind(examId)
      .first<{ bank_size: number }>(),

    // Answered questions that STILL exist in the bank. Joining `questions`
    // drops answers to since-deleted questions, which is what keeps coverage
    // from exceeding 100% after a bank cleanup.
    db.prepare(
      `SELECT COUNT(DISTINCT aa.question_id) AS attempted_in_bank
       FROM attempt_answers aa
       JOIN attempts a ON a.id = aa.attempt_id
       JOIN questions q ON q.id = aa.question_id AND q.exam_id = a.exam_id
       WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}`
    )
      .bind(userId, examId)
      .first<{ attempted_in_bank: number }>(),

    db.prepare(
      `SELECT substr(${ANSWERED_AT_SQL}, 1, 10) AS day, COUNT(*) AS attempted, COALESCE(SUM(aa.is_correct), 0) AS correct
       FROM attempt_answers aa
       JOIN attempts a ON a.id = aa.attempt_id
       WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}
       GROUP BY day ORDER BY day ASC`
    )
      .bind(userId, examId)
      .all<{ day: string; attempted: number; correct: number }>(),

    db.prepare(
      `SELECT l.tag_id AS tag_id, t.name AS tag, COUNT(*) AS attempted, COALESCE(SUM(aa.is_correct), 0) AS correct
       FROM attempt_answers aa
       JOIN attempts a ON a.id = aa.attempt_id
       JOIN question_tag_links l ON l.question_id = aa.question_id
       JOIN question_bank_tags t ON t.id = l.tag_id
       WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}
       GROUP BY l.tag_id ORDER BY attempted DESC, tag ASC`
    )
      .bind(userId, examId)
      .all<{ tag_id: string; tag: string; attempted: number; correct: number }>(),

    db.prepare(
      `SELECT COALESCE(q.difficulty, 'unspecified') AS difficulty, COUNT(*) AS attempted, COALESCE(SUM(aa.is_correct), 0) AS correct
       FROM attempt_answers aa
       JOIN attempts a ON a.id = aa.attempt_id
       JOIN questions q ON q.id = aa.question_id
       WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}
       GROUP BY difficulty`
    )
      .bind(userId, examId)
      .all<{ difficulty: DifficultyBreakdown["difficulty"]; attempted: number; correct: number }>(),

    // `id ASC` gives attempts sharing a completed_at timestamp a deterministic
    // order, which is what makes the "best mock" tiebreak below reproducible.
    db.prepare(
      `SELECT id AS attempt_id, completed_at, score, total_questions,
              (SELECT COALESCE(SUM(is_correct), 0) FROM attempt_answers aa WHERE aa.attempt_id = attempts.id) AS correct_count
       FROM attempts
       WHERE user_id = ? AND exam_id = ? AND mode = 'mock' AND completed_at IS NOT NULL
       ORDER BY completed_at ASC, id ASC`
    )
      .bind(userId, examId)
      .all<{ attempt_id: string; completed_at: string; score: number; total_questions: number; correct_count: number }>(),

    db.prepare(LAST_ACTIVITY_SQL)
      .bind(userId, examId, userId, examId)
      .first<{ last_at: string | null }>(),

    // Both comparison windows in one pass, summed from correct/attempted —
    // NOT averaged over daily percentages, which would weigh a three-answer
    // day the same as a ninety-answer one.
    db.prepare(
      `SELECT CASE WHEN ${ANSWERED_AT_SQL} >= ? THEN 'current' ELSE 'previous' END AS bucket,
              COUNT(*) AS attempted, COALESCE(SUM(aa.is_correct), 0) AS correct
       FROM attempt_answers aa
       JOIN attempts a ON a.id = aa.attempt_id
       WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL} AND ${ANSWERED_AT_SQL} >= ?
       GROUP BY bucket`
    )
      .bind(currentWindowStart, userId, examId, previousWindowStart)
      .all<{ bucket: "current" | "previous"; attempted: number; correct: number }>(),

    // Questions answered for the FIRST time inside the current window
    // (decision 3). Re-answering a known question adds no coverage, so it
    // must not count as a new question here either.
    db.prepare(
      `SELECT COUNT(*) AS fresh FROM (
         SELECT aa.question_id AS question_id, MIN(${ANSWERED_AT_SQL}) AS first_at
         FROM attempt_answers aa
         JOIN attempts a ON a.id = aa.attempt_id
         WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}
         GROUP BY aa.question_id
       ) WHERE first_at >= ?`
    )
      .bind(userId, examId, currentWindowStart)
      .first<{ fresh: number }>(),
  ]);

  const accuracyTrend: AccuracyTrendPoint[] = (trendRows.results ?? []).map((r) => ({
    date: r.day,
    attempted: r.attempted,
    correct: r.correct,
    accuracyPct: pct(r.correct, r.attempted),
  }));

  const byTag: TagBreakdown[] = (tagRows.results ?? []).map((r) => ({
    tagId: r.tag_id,
    tag: r.tag,
    attempted: r.attempted,
    correct: r.correct,
    accuracyPct: pct(r.correct, r.attempted),
  }));

  const byDifficulty: DifficultyBreakdown[] = (difficultyRows.results ?? []).map((r) => ({
    difficulty: r.difficulty,
    attempted: r.attempted,
    correct: r.correct,
    accuracyPct: pct(r.correct, r.attempted),
  }));

  const mockScoreHistory: MockScoreHistoryEntry[] = (mockRows.results ?? []).map((r) => ({
    attemptId: r.attempt_id,
    completedAt: r.completed_at,
    score: r.score,
    totalQuestions: r.total_questions,
    passed: isMockPassed(rule, { correctCount: r.correct_count, totalQuestions: r.total_questions, score: r.score }),
  }));

  const windowFor = (bucket: "current" | "previous"): AccuracyWindow | null => {
    const row = (windowRows.results ?? []).find((r) => r.bucket === bucket);
    if (!row || row.attempted === 0) return null;
    return { attempted: row.attempted, correct: row.correct, accuracyPct: pct(row.correct, row.attempted) };
  };
  const current = windowFor("current");
  const previous = windowFor("previous");

  const totalAnswers = overall?.total_answers ?? 0;
  const totalCorrect = overall?.correct_answers ?? 0;

  return {
    examId: exam.id,
    schemaVersion: STATS_SCHEMA_VERSION,
    totalAttempted: overall?.attempted_questions ?? 0,
    attemptedInBank: inBank?.attempted_in_bank ?? 0,
    bankSize: bank?.bank_size ?? 0,
    totalAnswers,
    totalCorrect,
    overallAccuracyPct: pct(totalCorrect, totalAnswers),
    passMarkPct: effectivePassMarkPct(rule),
    weeklyNewQuestions: freshRow?.fresh ?? 0,
    accuracyComparison: {
      days: ACCURACY_WINDOW_DAYS,
      current,
      previous,
      // Null unless BOTH windows have answers: "no previous activity" is not
      // a delta of zero, and must not be drawn as one.
      deltaPts: current && previous ? current.accuracyPct - previous.accuracyPct : null,
    },
    accuracyTrend,
    byTag,
    byDifficulty,
    mockScoreHistory,
    bestMock: bestMockOf(mockScoreHistory),
    lastAttemptAt: lastAttempt?.last_at ?? null,
  };
}

// Highest score wins; ties go to the EARLIEST completion, then the lowest
// attempt id. `mockScoreHistory` is already ordered (completed_at, id) ascending,
// so a strict `>` keeps the first of any tied run.
function bestMockOf(history: readonly MockScoreHistoryEntry[]): MockScoreHistoryEntry | null {
  let best: MockScoreHistoryEntry | null = null;
  for (const entry of history) if (!best || entry.score > best.score) best = entry;
  return best;
}

export interface ExamStatsSummary {
  examId: string;
  totalAttempted: number;
  overallAccuracyPct: number;
  lastAttemptAt: string | null;
}

// Lightweight summary-only read (no trend/tag/mock-history queries) for
// callers that only need these three headline figures — e.g. the User MCP's
// get_exam_progress tool, which previously ran (and KV-cached, via
// getOrComputeExamStats) the FULL computeExamStats just to read three fields
// off it, growing with the user's entire history for no reason.
export async function computeExamStatsSummary(db: D1Database, userId: string, examId: string): Promise<ExamStatsSummary | null> {
  const exam = await db.prepare("SELECT id FROM exams WHERE id = ?").bind(examId).first<{ id: string }>();
  if (!exam) return null;
  const [overall, lastAttempt] = await Promise.all([
    db.prepare(
      `SELECT COUNT(DISTINCT aa.question_id) AS attempted_questions, COUNT(*) AS total_answers, COALESCE(SUM(aa.is_correct), 0) AS correct_answers
       FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
       WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}`,
    ).bind(userId, examId).first<{ attempted_questions: number; total_answers: number; correct_answers: number }>(),
    db.prepare(LAST_ACTIVITY_SQL)
      .bind(userId, examId, userId, examId).first<{ last_at: string | null }>(),
  ]);
  return {
    examId: exam.id,
    totalAttempted: overall?.attempted_questions ?? 0,
    overallAccuracyPct: pct(overall?.correct_answers ?? 0, overall?.total_answers ?? 0),
    lastAttemptAt: lastAttempt?.last_at ?? null,
  };
}

export interface ExamStatsBoundedPage {
  examId: string;
  totalAttempted: number;
  overallAccuracyPct: number;
  lastAttemptAt: string | null;
  accuracyTrend: AccuracyTrendPoint[];
  accuracyTrendTruncated: boolean;
  byTag: TagBreakdown[];
  byTagTruncated: boolean;
  byDifficulty: DifficultyBreakdown[];
  // Up to mockLimit + 1 rows, ascending by completedAt then id — the
  // adapter windows this the same way every other list tool does
  // (conventions.ts's pageResult()), rather than this function doing it.
  mockScoreHistoryRows: MockScoreHistoryEntry[];
}

// SQL-bounded sibling of computeExamStats, for the User MCP's
// get_learning_stats tool: every history array is capped/paginated INSIDE
// the query — LIMIT applied before rows leave D1 — rather than fetched in
// full and sliced in the Worker afterward, so a `limit: 1` request never
// materializes a user's entire mock-attempt/trend/tag history. Deliberately
// NOT KV-cached (unlike computeExamStats/getOrComputeExamStats): a cache key
// would need to vary per limit/offset/trendCap/tagCap combination, defeating
// the point of caching, and every query here is already a cheap, bounded read.
//
// accuracyTrend is windowed to the LATEST `trendCap` days (queried DESC,
// then reversed back to ascending order for output) — capping the ASC-order
// full history at its head, as an earlier version of this function did,
// would silently and permanently hide the newest activity once a user
// crossed the cap.
export async function computeExamStatsPage(
  db: D1Database, userId: string, examId: string,
  opts: { trendCap: number; tagCap: number; mockLimit: number; mockOffset: number },
): Promise<ExamStatsBoundedPage | null> {
  const rule = await loadExamPassRule(db, examId);
  if (!rule) return null;
  const exam = { id: examId };

  const [overall, lastAttempt, trendRows, tagRows, difficultyRows, mockRows] = await Promise.all([
    db.prepare(
      `SELECT COUNT(DISTINCT aa.question_id) AS attempted_questions, COUNT(*) AS total_answers, COALESCE(SUM(aa.is_correct), 0) AS correct_answers
       FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
       WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}`,
    ).bind(userId, examId).first<{ attempted_questions: number; total_answers: number; correct_answers: number }>(),

    db.prepare(LAST_ACTIVITY_SQL)
      .bind(userId, examId, userId, examId).first<{ last_at: string | null }>(),

    // Latest trendCap+1 days, newest first — reversed to ascending below.
    db.prepare(
      `SELECT substr(${ANSWERED_AT_SQL}, 1, 10) AS day, COUNT(*) AS attempted, COALESCE(SUM(aa.is_correct), 0) AS correct
       FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
       WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}
       GROUP BY day ORDER BY day DESC LIMIT ?`,
    ).bind(userId, examId, opts.trendCap + 1).all<{ day: string; attempted: number; correct: number }>(),

    // Top tagCap+1 tags by attempted count; `tag ASC` breaks ties deterministically.
    db.prepare(
      `SELECT l.tag_id AS tag_id, t.name AS tag, COUNT(*) AS attempted, COALESCE(SUM(aa.is_correct), 0) AS correct
       FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
       JOIN question_tag_links l ON l.question_id = aa.question_id
       JOIN question_bank_tags t ON t.id = l.tag_id
       WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}
       GROUP BY l.tag_id ORDER BY attempted DESC, tag ASC LIMIT ?`,
    ).bind(userId, examId, opts.tagCap + 1).all<{ tag_id: string; tag: string; attempted: number; correct: number }>(),

    // At most 4 rows (easy/medium/hard/unspecified) — inherently bounded, no cap needed.
    db.prepare(
      `SELECT COALESCE(q.difficulty, 'unspecified') AS difficulty, COUNT(*) AS attempted, COALESCE(SUM(aa.is_correct), 0) AS correct
       FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id JOIN questions q ON q.id = aa.question_id
       WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL} GROUP BY difficulty`,
    ).bind(userId, examId).all<{ difficulty: DifficultyBreakdown["difficulty"]; attempted: number; correct: number }>(),

    // `id ASC` tiebreak for attempts sharing a completed_at timestamp.
    db.prepare(
      `SELECT id AS attempt_id, completed_at, score, total_questions,
              (SELECT COALESCE(SUM(is_correct), 0) FROM attempt_answers aa WHERE aa.attempt_id = attempts.id) AS correct_count
       FROM attempts WHERE user_id = ? AND exam_id = ? AND mode = 'mock' AND completed_at IS NOT NULL
       ORDER BY completed_at ASC, id ASC LIMIT ? OFFSET ?`,
    ).bind(userId, examId, opts.mockLimit + 1, opts.mockOffset).all<{ attempt_id: string; completed_at: string; score: number; total_questions: number; correct_count: number }>(),
  ]);

  const trendAll = trendRows.results ?? [];
  const accuracyTrendTruncated = trendAll.length > opts.trendCap;
  const accuracyTrend: AccuracyTrendPoint[] = trendAll.slice(0, opts.trendCap).reverse().map((r) => ({
    date: r.day, attempted: r.attempted, correct: r.correct, accuracyPct: pct(r.correct, r.attempted),
  }));

  const tagAll = tagRows.results ?? [];
  const byTagTruncated = tagAll.length > opts.tagCap;
  const byTag: TagBreakdown[] = tagAll.slice(0, opts.tagCap).map((r) => ({
    tagId: r.tag_id, tag: r.tag, attempted: r.attempted, correct: r.correct, accuracyPct: pct(r.correct, r.attempted),
  }));

  const byDifficulty: DifficultyBreakdown[] = (difficultyRows.results ?? []).map((r) => ({
    difficulty: r.difficulty, attempted: r.attempted, correct: r.correct, accuracyPct: pct(r.correct, r.attempted),
  }));

  const mockScoreHistoryRows: MockScoreHistoryEntry[] = (mockRows.results ?? []).map((r) => ({
    attemptId: r.attempt_id, completedAt: r.completed_at, score: r.score, totalQuestions: r.total_questions,
    passed: isMockPassed(rule, { correctCount: r.correct_count, totalQuestions: r.total_questions, score: r.score }),
  }));

  return {
    examId: exam.id,
    totalAttempted: overall?.attempted_questions ?? 0,
    overallAccuracyPct: pct(overall?.correct_answers ?? 0, overall?.total_answers ?? 0),
    lastAttemptAt: lastAttempt?.last_at ?? null,
    accuracyTrend, accuracyTrendTruncated,
    byTag, byTagTruncated,
    byDifficulty,
    mockScoreHistoryRows,
  };
}

export async function computeStudyActivity(
  db: D1Database,
  userId: string,
  opts: { examId?: string | null; days?: number } = {},
): Promise<StudyActivityResponse> {
  const examId = opts.examId ?? null;
  const days = Math.min(365, Math.max(7, opts.days ?? 84));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // implementation — the per-day rows now carry RECORDED session duration as well
  // as session/question counts, because the Study time card measures against
  // a weekly goal and an average over the range cannot be split back into
  // days. `duration_seconds` is nullable (older attempts, and any completion
  // path that never set it), so the sum is reported alongside the number of
  // sessions that actually contributed to it: a day with sessions but no
  // recorded duration is UNAVAILABLE, not zero, and the DTO keeps the two
  // apart (see packages/shared/src/stats.ts and buildStudyWeek).
  const [dayRows, answerRows, avgRow] = await Promise.all([
    db.prepare(
      `SELECT substr(completed_at, 1, 10) AS day, COUNT(*) AS sessions,
              SUM(duration_seconds) AS duration_seconds,
              SUM(CASE WHEN duration_seconds IS NOT NULL THEN 1 ELSE 0 END) AS sessions_with_duration
       FROM attempts
       WHERE user_id = ? AND completed_at IS NOT NULL AND completed_at >= ?
             AND (? IS NULL OR exam_id = ?)
       GROUP BY day ORDER BY day ASC`
    )
      .bind(userId, since, examId, examId)
      .all<{ day: string; sessions: number; duration_seconds: number | null; sessions_with_duration: number }>(),

    // Questions answered, by the day each answer was given (issue #40): a
    // practice session that was never ended still counts its answers, and one
    // that ran past midnight counts each on its own day.
    db.prepare(
      `SELECT substr(${ANSWERED_AT_SQL}, 1, 10) AS day, COUNT(*) AS questions
       FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
       WHERE a.user_id = ? AND ${GRADED_ANSWER_SQL} AND ${ANSWERED_AT_SQL} >= ?
             AND (? IS NULL OR a.exam_id = ?)
       GROUP BY day`
    )
      .bind(userId, since, examId, examId)
      .all<{ day: string; questions: number }>(),

    // Unchanged contract: the mean is over every completed session that
    // recorded a duration, across the user's whole history for this exam —
    // deliberately NOT restricted to `since`, which is what the existing
    // dashboard footer has always shown.
    db.prepare(
      `SELECT AVG(duration_seconds) AS avg_seconds
       FROM attempts
       WHERE user_id = ? AND completed_at IS NOT NULL AND duration_seconds IS NOT NULL
             AND (? IS NULL OR exam_id = ?)`
    )
      .bind(userId, examId, examId)
      .first<{ avg_seconds: number | null }>(),
  ]);

  let sessionsCompleted = 0;
  let sessionsWithDuration = 0;
  const sessionsByDay = new Map((dayRows.results ?? []).map((r) => [r.day, r]));
  const answersByDay = new Map((answerRows.results ?? []).map((r) => [r.day, r.questions]));
  // A day is active if a session closed on it or a question was answered on it.
  const activeDays = [...new Set([...sessionsByDay.keys(), ...answersByDay.keys()])].sort();
  const days_: StudyActivityDay[] = activeDays.map((day) => {
    const r = sessionsByDay.get(day);
    const sessions = r?.sessions ?? 0;
    const withDuration = r?.sessions_with_duration ?? 0;
    sessionsCompleted += sessions;
    sessionsWithDuration += withDuration;
    return {
      date: day,
      sessionsCompleted: sessions,
      questionsAnswered: answersByDay.get(day) ?? 0,
      // No closed session is zero recorded time; sessions without a recorded
      // duration are unavailable, not zero.
      durationSeconds: sessions === 0 ? 0 : withDuration > 0 ? (r?.duration_seconds ?? 0) : null,
      sessionsWithDuration: withDuration,
    };
  });

  return {
    days: days_,
    activeDayCount: days_.length,
    averageSessionSeconds: Math.round(avgRow?.avg_seconds ?? 0),
    sessionsCompleted,
    sessionsWithDuration,
  };
}
