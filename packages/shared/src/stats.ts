// DTOs for the Personal Statistics Dashboard API (docs/requirements/statistics-and-progress.md), shared
// between the Worker's responses and the web client.
//
// Calendar policy (implementation, decision 2): every day bucket in this file is a
// UTC calendar day, because `accuracyTrend` has always bucketed on
// `substr(completed_at, 1, 10)` and completed_at is stored as a UTC ISO
// string. Countdowns, week boundaries and window deltas therefore all use UTC
// too, so no two figures on the dashboard can disagree about which day an
// attempt landed on. Moving any of them to a local calendar means moving all
// of them, and that is coordinated API work, not a display choice.

import type { Difficulty } from "./types";

// FR-9.1: one bucket of the accuracy-over-time trend, keyed by the calendar
// day (UTC, "YYYY-MM-DD") on which the contributing attempts were completed.
export interface AccuracyTrendPoint {
  date: string;
  attempted: number;
  correct: number;
  accuracyPct: number;
}

export interface TagBreakdown {
  // Stable per-exam tag identifier (question_bank_tags.id). Null only on a
  // payload produced before implementation — see STATS_SCHEMA_VERSION — so
  // consumers key on `tagId ?? tag` rather than assuming it is present.
  tagId: string | null;
  tag: string;
  attempted: number;
  correct: number;
  accuracyPct: number;
}

export interface DifficultyBreakdown {
  difficulty: Difficulty | "unspecified";
  attempted: number;
  correct: number;
  accuracyPct: number;
}

export interface MockScoreHistoryEntry {
  attemptId: string;
  completedAt: string;
  score: number;
  totalQuestions: number;
  passed: boolean | null;
}

// One comparison window of answer EVENTS (not distinct questions), computed
// from summed correct/attempted rather than from an average of daily
// percentages — a day with three answers must not weigh as much as a day with
// ninety.
export interface AccuracyWindow {
  attempted: number;
  correct: number;
  accuracyPct: number;
}

// The "+5 pts" chip on the Accuracy card. `days` names the window explicitly
// so the UI never has to guess what the delta is against; `deltaPts` is null
// whenever either window has no answer events at all, which is different from
// a delta of zero.
export interface AccuracyComparison {
  days: number;
  current: AccuracyWindow | null;
  previous: AccuracyWindow | null;
  deltaPts: number | null;
}

// Bumped whenever ExamStatsResponse gains fields the dashboard reads. The KV
// cache key carries the same number (lib/statsCache.ts), so a payload cached
// by an older deployment is recomputed rather than served with fields missing.
export const STATS_SCHEMA_VERSION = 2;

export interface ExamStatsResponse {
  examId: string;
  // See STATS_SCHEMA_VERSION. Absent on pre-implementation cached payloads.
  schemaVersion?: number;
  // Distinct question ids answered in completed attempts, INCLUDING questions
  // since removed from the bank. Kept as-is for the User MCP's existing
  // contract; `attemptedInBank` is the figure coverage is drawn from.
  totalAttempted: number;
  // Distinct answered questions that still exist in the exam's current bank,
  // and the current bank's size. Coverage is attemptedInBank / bankSize, so a
  // deleted question can never push coverage above 100%.
  attemptedInBank: number;
  bankSize: number;
  // Answer EVENTS, not distinct questions: answering the same question three
  // times counts three times here and once in totalAttempted.
  totalAnswers: number;
  totalCorrect: number;
  overallAccuracyPct: number;
  // The exam's configured pass threshold, or null when the exam has none. The
  // dashboard omits every pass comparison when this is null rather than
  // assuming a value.
  passMarkPct: number | null;
  // Distinct questions answered for the FIRST time inside the trailing
  // `accuracyComparison.days` window (implementation, decision 3): re-answering a
  // question the user already knew does not add coverage, so it must not
  // inflate this either.
  weeklyNewQuestions: number;
  accuracyComparison: AccuracyComparison;
  accuracyTrend: AccuracyTrendPoint[];
  byTag: TagBreakdown[];
  byDifficulty: DifficultyBreakdown[];
  mockScoreHistory: MockScoreHistoryEntry[];
  // Highest-scoring completed mock, ties broken by the EARLIEST completion and
  // then by attempt id, so the card and the history list can never disagree
  // about which attempt "best" refers to.
  bestMock: MockScoreHistoryEntry | null;
  lastAttemptAt: string | null;
}

// FR-9.2: per-day study activity, for a calendar/heatmap view. `examId`
// filters to one exam; omitted, it covers every exam the user has attempted.
export interface StudyActivityDay {
  date: string;
  sessionsCompleted: number;
  questionsAnswered: number;
  // Summed `attempts.duration_seconds` for the completed sessions on this day
  // (implementation, decision 4: RECORDED session time, not measured engagement).
  // Null means "sessions happened but none of them recorded a duration" — an
  // unavailable figure, which the UI must not draw as a zero-height bar.
  durationSeconds: number | null;
  sessionsWithDuration: number;
}

export interface StudyActivityResponse {
  days: StudyActivityDay[];
  activeDayCount: number;
  averageSessionSeconds: number;
  // How many completed sessions in the requested range recorded a duration at
  // all, so the UI can say so instead of silently averaging over a subset.
  sessionsCompleted: number;
  sessionsWithDuration: number;
}
