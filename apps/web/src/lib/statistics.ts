// implementation — every derivation and every piece of formatting the Statistics
// screen needs, in one place, so the components under components/statistics/
// are presentation only and the numbers can be unit-tested without a browser.
//
// The arithmetic itself lives in @prepdeck/shared (readiness, focus-tag
// ranking, the study week, the countdown) so the REST dashboard and the User
// MCP cannot drift apart. What is here is the wiring: which client state feeds
// which shared function, and how an unavailable figure is worded.

import type {
  AccuracyTrendPoint, ExamStatsResponse, ExamStudyPreferencesResponse,
  FocusTag, FocusTagAccuracy, MockScoreHistoryEntry, ReadinessResult, StudyActivityResponse, StudyWeek,
} from "@prepdeck/shared";
import {
  ACCURACY_TREND_ACTIVE_DAYS, buildStudyWeek, computeReadiness, daysUntil,
  isoWeekStartKey, latestActiveDays, rankFocusTags,
} from "@prepdeck/shared";
import type { Question, WrongEntry } from "../types";
import { needsFocusedPractice } from "./practiceEligibility";

export interface StatisticsSources {
  stats: ExamStatsResponse | null;
  activity: StudyActivityResponse | null;
  preferences: ExamStudyPreferencesResponse | null;
  catalog: Question[];
  attempted: Record<string, boolean>;
  wrong: Record<string, WrongEntry>;
  mastered: Record<string, boolean>;
  now: Date;
}

export interface CoverageModel {
  seen: number;
  total: number;
  /** Clamped to 0-100: a since-deleted question must never push this past full. */
  pct: number;
}

export interface CountdownModel {
  targetDate: string;
  daysLeft: number;
  /** True once the exam date is in the past. */
  passed: boolean;
}

export interface AnsweredMetric {
  questions: number;
  bankSize: number;
  unseen: number;
  /** First-time questions inside the stats API's comparison window. */
  newThisWeek: number;
  windowDays: number;
  coveragePct: number;
}

export interface AccuracyMetric {
  accuracyPct: number;
  answerEvents: number;
  deltaPts: number | null;
  windowDays: number;
  passMarkPct: number | null;
}

export interface WrongBookMetric {
  /** Unmastered wrong-book entries that still exist in the current bank. */
  saved: number;
  /** Of those, how many have been missed more than once. */
  repeated: number;
  /** Of those, how many were last missed inside the trailing week. */
  recent: number;
  /** Up to 20 entries, most-missed first, for the severity strip. */
  strip: { id: string; misses: number }[];
}

export interface BestMockMetric {
  best: MockScoreHistoryEntry | null;
  attempts: number;
  /** Chronological scores for the mini-bars, newest last, capped at 8. */
  recent: MockScoreHistoryEntry[];
  passMarkPct: number | null;
}

export interface TrendModel {
  points: AccuracyTrendPoint[];
  /** How many active days the chart actually shows — never a hardcoded 11. */
  activeDays: number;
  requestedDays: number;
  latestPct: number | null;
  passMarkPct: number | null;
  /** Y-axis bounds that always contain the pass line when there is one. */
  domain: [number, number];
}

export interface StatisticsModel {
  coverage: CoverageModel;
  readiness: ReadinessResult;
  passMarkPct: number | null;
  countdown: CountdownModel | null;
  weeklyGoalMinutes: number | null;
  answered: AnsweredMetric;
  accuracy: AccuracyMetric;
  wrongBook: WrongBookMetric;
  bestMock: BestMockMetric;
  trend: TrendModel;
  week: StudyWeek;
  focus: FocusTag[];
  /** Tags worth practising together behind "Practice weak tags". */
  weakTags: string[];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const WRONG_STRIP_MAX = 20;
export const WEAK_TAG_ACTION_LIMIT = 3;
export const FOCUS_PREVIEW_ROWS = 3;
export const MOCK_MINI_BARS = 8;

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Questions eligible for a tag's practice action: never seen, or still in the
 *  unmastered wrong book. Mirrors rankFocusTags' own definition of eligible. */
export function eligibleQuestionIdsForTags(sources: StatisticsSources, tags: readonly string[]): string[] {
  const wanted = new Set(tags);
  return sources.catalog
    .filter((q) => {
      if (wanted.size && !q.tags.some((t) => wanted.has(t))) return false;
      return needsFocusedPractice(q.id, sources);
    })
    .map((q) => q.id);
}

export function buildStatisticsModel(sources: StatisticsSources): StatisticsModel {
  const { stats, activity, preferences, catalog, now } = sources;

  // The bank size is the server's figure when it is available: it is the same
  // denominator the readiness sample is drawn from, and it reconciles
  // questions that were deleted after the client cached its catalog. The
  // catalog length is the fallback for a failed stats request only.
  const bankSize = stats ? stats.bankSize : catalog.length;
  const seen = stats ? Math.min(stats.attemptedInBank, bankSize) : 0;
  const coverage: CoverageModel = { seen, total: bankSize, pct: bankSize > 0 ? clampPct((seen / bankSize) * 100) : 0 };

  const readiness = computeReadiness({
    bankSize,
    attemptedInBank: seen,
    answerEvents: stats?.totalAnswers ?? 0,
    byDifficulty: stats?.byDifficulty ?? [],
  });

  const passMarkPct = stats?.passMarkPct ?? null;

  let countdown: CountdownModel | null = null;
  if (preferences?.targetDate) {
    const daysLeft = daysUntil(preferences.targetDate, now);
    if (daysLeft != null) countdown = { targetDate: preferences.targetDate, daysLeft, passed: daysLeft < 0 };
  }

  const windowDays = stats?.accuracyComparison.days ?? 7;
  const answered: AnsweredMetric = {
    questions: seen,
    bankSize,
    unseen: Math.max(0, bankSize - seen),
    newThisWeek: stats?.weeklyNewQuestions ?? 0,
    windowDays,
    coveragePct: coverage.pct,
  };

  const accuracy: AccuracyMetric = {
    accuracyPct: stats?.overallAccuracyPct ?? 0,
    answerEvents: stats?.totalAnswers ?? 0,
    deltaPts: stats?.accuracyComparison.deltaPts ?? null,
    windowDays,
    passMarkPct,
  };

  // The wrong book is client state, not part of the stats payload: it is
  // already exam-scoped and already narrowed to the current catalog, which is
  // the same set the wrong-answer screen and a "practice these" action use.
  const recentCutoff = new Date(now.getTime() - WEEK_MS).toISOString();
  const bankIds = new Set(catalog.map((q) => q.id));
  const wrongEntries = Object.entries(sources.wrong)
    .filter(([id]) => bankIds.has(id) && !sources.mastered[id])
    .map(([id, entry]) => ({ id, misses: entry.c, at: entry.at }));
  const wrongBook: WrongBookMetric = {
    saved: wrongEntries.length,
    repeated: wrongEntries.filter((e) => e.misses > 1).length,
    recent: wrongEntries.filter((e) => e.at >= recentCutoff).length,
    strip: wrongEntries
      .slice()
      .sort((a, b) => b.misses - a.misses || a.id.localeCompare(b.id))
      .slice(0, WRONG_STRIP_MAX)
      .map((e) => ({ id: e.id, misses: e.misses })),
  };

  const history = stats?.mockScoreHistory ?? [];
  const bestMock: BestMockMetric = {
    best: stats?.bestMock ?? null,
    attempts: history.length,
    recent: history.slice(Math.max(0, history.length - MOCK_MINI_BARS)),
    passMarkPct,
  };

  const points = latestActiveDays(stats?.accuracyTrend ?? []);
  const trendValues = points.map((p) => p.accuracyPct);
  const anchors = passMarkPct == null ? trendValues : [...trendValues, passMarkPct];
  const lo = anchors.length ? Math.max(0, Math.min(...anchors) - 8) : 0;
  const hi = anchors.length ? Math.min(100, Math.max(...anchors) + 8) : 100;
  const trend: TrendModel = {
    points,
    activeDays: points.length,
    requestedDays: ACCURACY_TREND_ACTIVE_DAYS,
    latestPct: points.length ? points[points.length - 1]!.accuracyPct : null,
    passMarkPct,
    domain: [Math.floor(lo), Math.ceil(Math.max(hi, lo + 1))],
  };

  const week = buildStudyWeek(activity?.days ?? [], isoWeekStartKey(now));

  const accuracyByTag = new Map<string, FocusTagAccuracy>(
    (stats?.byTag ?? []).map((t) => [t.tag, { attempted: t.attempted, correct: t.correct, accuracyPct: t.accuracyPct }]),
  );
  const tagIdsByTag = new Map<string, string>(
    (stats?.byTag ?? []).flatMap((t) => (t.tagId ? [[t.tag, t.tagId] as [string, string]] : [])),
  );
  const attemptedIds = new Set(Object.keys(sources.attempted).filter((id) => sources.attempted[id]));
  const wrongIds = new Set(wrongEntries.map((e) => e.id));
  const focus = rankFocusTags(
    {
      questions: catalog.map((q) => ({ id: q.id, tags: q.tags, difficulty: q.diff })),
      attemptedIds,
      wrongIds,
      accuracyByTag,
      tagIdsByTag,
    },
    { passMarkPct },
  );

  // "Practice weak tags" only offers tags that are both measurably behind and
  // actually practisable; an empty result disables the action rather than
  // silently starting an unfiltered session.
  const weakTags = focus
    .filter((t) => t.hasEvidence && t.priority > 0 && t.eligibleCount > 0)
    .slice(0, WEAK_TAG_ACTION_LIMIT)
    .map((t) => t.tag);

  return {
    coverage, readiness, passMarkPct, countdown,
    weeklyGoalMinutes: preferences?.weeklyGoalMinutes ?? null,
    answered, accuracy, wrongBook, bestMock, trend, week, focus, weakTags,
  };
}

/* --- Formatting ---------------------------------------------------------- */

/** "1h 10m", "45m", "—" for nothing studied, "?" for an unavailable figure. */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "?";
  if (seconds <= 0) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatSignedPoints(deltaPts: number): string {
  return `${deltaPts > 0 ? "+" : deltaPts < 0 ? "−" : "±"}${Math.abs(deltaPts)} pts`;
}

/** The one sentence under the readiness ring. Deliberately makes no claim
 *  about how many questions would close a gap: no such relationship has been
 *  validated here (implementation, decision 1). */
export function readinessNarrative(model: StatisticsModel, examName: string | null): string {
  const { readiness, passMarkPct, coverage } = model;
  if (!readiness.available) {
    switch (readiness.reason) {
      case "no-bank":
        return "This exam has no questions yet, so there is nothing to measure.";
      case "no-attempts":
        return "Answer some questions and a readiness estimate will appear here.";
      default:
        return `Readiness needs at least ${readiness.sample.minAnsweredQuestions} answered questions; `
          + `you are at ${readiness.sample.answeredQuestions}. Until then this shows bank coverage only.`;
    }
  }
  const subject = examName ?? "this exam";
  if (passMarkPct == null) {
    return `Difficulty-weighted estimate across the ${coverage.pct}% of ${subject} you have seen. `
      + "This exam has no pass mark set, so there is no line to compare against.";
  }
  const gap = readiness.scorePct - passMarkPct;
  if (gap >= 0) {
    return `You are ${gap} point${gap === 1 ? "" : "s"} above the ${passMarkPct}% pass line. `
      + "Keep the weak tags below from slipping.";
  }
  return `You are ${-gap} point${gap === -1 ? "" : "s"} below the ${passMarkPct}% pass line. `
    + "The weak tags below are where the distance is.";
}
