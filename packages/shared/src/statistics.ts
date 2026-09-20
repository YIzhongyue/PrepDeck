// implementation — the derivations behind the Statistics screen, kept here rather
// than in the web app so the REST dashboard, the User MCP and any future
// server-side consumer compute them the same way. Everything in this file is
// a pure function over plain data: no fetching, no formatting, no React.
//
// Three figures on that screen are easy to conflate and are deliberately kept
// distinct throughout:
//
//   coverage   — how much of the bank has been seen at all.
//   accuracy   — how often answered questions were answered correctly.
//   readiness  — a difficulty-weighted projection, defined and versioned
//                below, that is only reported once there is enough evidence.
//
// The pass threshold is a fourth, separate thing: it comes from the exam
// (`passMarkPct`) and is never invented when the exam does not define one.

import type { AccuracyTrendPoint, DifficultyBreakdown, StudyActivityDay } from "./stats";
import type { Difficulty } from "./types";

// Every day bucket here is a UTC calendar day — see the header of stats.ts.
export const STATISTICS_CALENDAR = "UTC";

export function pctOf(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

/* -------------------------------------------------------------------------
   Readiness — method v1
   ------------------------------------------------------------------------- */

// Bumped whenever the formula below changes, so a score can always be traced
// to the method that produced it. Surfaced in the UI's explanation text.
export const READINESS_METHOD_VERSION = 1;

// Harder questions count for more, easier ones for less, relative to a
// medium question. "unspecified" is treated as medium rather than dropped:
// excluding it would silently change the denominator for banks that do not
// tag difficulty at all.
export const READINESS_DIFFICULTY_WEIGHTS: Record<Difficulty | "unspecified", number> = {
  easy: 0.8,
  medium: 1,
  hard: 1.3,
  unspecified: 1,
};

// Sample sufficiency. Below either floor the score is withheld entirely: a
// user who has answered four questions has no measurable readiness, and
// showing one anyway is the failure mode this guard exists to prevent.
export const READINESS_MIN_ANSWERED_QUESTIONS = 30;
export const READINESS_MIN_ANSWER_EVENTS = 40;

// The share of demonstrated accuracy credited to the part of the bank the
// user has never seen. Unseen questions are unknown, not wrong (a 0 here
// would make readiness collapse into coverage), and not known either (a 1
// would make coverage irrelevant).
export const READINESS_UNSEEN_CREDIT = 0.75;

export type ReadinessUnavailableReason =
  | "no-bank"              // the exam has no questions
  | "no-attempts"          // nothing answered yet
  | "insufficient-sample"; // answered, but below the floors above

export interface ReadinessInput {
  bankSize: number;
  attemptedInBank: number;
  answerEvents: number;
  byDifficulty: readonly DifficultyBreakdown[];
}

export interface ReadinessSample {
  answeredQuestions: number;
  answerEvents: number;
  minAnsweredQuestions: number;
  minAnswerEvents: number;
}

export type ReadinessResult =
  | {
      available: true;
      version: number;
      /** 0-100. readiness = weightedAccuracy x (coverage + (1 - coverage) x UNSEEN_CREDIT). */
      scorePct: number;
      weightedAccuracyPct: number;
      coveragePct: number;
      sample: ReadinessSample;
    }
  | {
      available: false;
      version: number;
      reason: ReadinessUnavailableReason;
      coveragePct: number;
      sample: ReadinessSample;
    };

/**
 * Readiness v1.
 *
 *   weightedAccuracy = Σ(w_d · correct_d) / Σ(w_d · attempted_d)   over answer events
 *   coverage         = attemptedInBank / bankSize
 *   readiness        = weightedAccuracy · (coverage + (1 − coverage) · UNSEEN_CREDIT)
 *
 * Deliberately NOT a prediction of a future exam score, and deliberately not
 * accompanied by a "practising N questions closes the gap" claim: no such
 * relationship has been validated against outcomes here, so the UI states the
 * distance to the pass line and stops there.
 */
export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const bankSize = Math.max(0, input.bankSize);
  const answeredQuestions = Math.max(0, Math.min(input.attemptedInBank, bankSize));
  const answerEvents = Math.max(0, input.answerEvents);
  const coveragePct = bankSize > 0 ? pctOf(answeredQuestions, bankSize) : 0;
  const sample: ReadinessSample = {
    answeredQuestions,
    answerEvents,
    minAnsweredQuestions: READINESS_MIN_ANSWERED_QUESTIONS,
    minAnswerEvents: READINESS_MIN_ANSWER_EVENTS,
  };
  const unavailable = (reason: ReadinessUnavailableReason): ReadinessResult => ({
    available: false, version: READINESS_METHOD_VERSION, reason, coveragePct, sample,
  });

  if (bankSize === 0) return unavailable("no-bank");
  if (answerEvents === 0) return unavailable("no-attempts");
  if (answeredQuestions < READINESS_MIN_ANSWERED_QUESTIONS || answerEvents < READINESS_MIN_ANSWER_EVENTS) {
    return unavailable("insufficient-sample");
  }

  let weightedCorrect = 0;
  let weightedAttempted = 0;
  for (const row of input.byDifficulty) {
    const weight = READINESS_DIFFICULTY_WEIGHTS[row.difficulty] ?? 1;
    weightedCorrect += weight * row.correct;
    weightedAttempted += weight * row.attempted;
  }
  // byDifficulty joins `questions`, so rows for since-deleted questions drop
  // out of it while answerEvents still counts them. Falling back keeps the
  // ratio defined instead of dividing by zero.
  if (weightedAttempted <= 0) return unavailable("insufficient-sample");

  const weightedAccuracy = weightedCorrect / weightedAttempted;
  const coverage = answeredQuestions / bankSize;
  const score = weightedAccuracy * (coverage + (1 - coverage) * READINESS_UNSEEN_CREDIT);

  return {
    available: true,
    version: READINESS_METHOD_VERSION,
    scorePct: Math.max(0, Math.min(100, Math.round(score * 100))),
    weightedAccuracyPct: Math.round(weightedAccuracy * 100),
    coveragePct,
    sample,
  };
}

/* -------------------------------------------------------------------------
   Focus tags — "Where to focus"
   ------------------------------------------------------------------------- */

// A tag needs at least this many answer events before its accuracy is treated
// as evidence of anything. Below it the tag is still listed, labelled
// "needs more practice", and ranked after every tag that does have evidence.
export const FOCUS_TAG_MIN_ANSWERS = 5;

// Extra ranking weight at 100% hard questions; scaled by the tag's actual
// hard share. A tag whose remaining work is hard is worth more attention than
// an equally weak tag whose remaining work is easy.
export const FOCUS_TAG_HARD_WEIGHT = 0.3;

export interface FocusTagQuestion {
  id: string;
  tags: readonly string[];
  difficulty: Difficulty | null;
}

export interface FocusTagAccuracy {
  attempted: number;
  correct: number;
  accuracyPct: number;
}

export interface FocusTagInput {
  /** The exam's CURRENT bank. Questions removed from it are absent here, which
   *  is what keeps unseen/wrong counts reconciled with what can be practised. */
  questions: readonly FocusTagQuestion[];
  /** Distinct question ids the user has answered at least once. */
  attemptedIds: ReadonlySet<string>;
  /** Unmastered wrong-book entries, already narrowed to the current bank. */
  wrongIds: ReadonlySet<string>;
  /** Per-tag accuracy from the stats API, keyed by tag name. */
  accuracyByTag: ReadonlyMap<string, FocusTagAccuracy>;
  /** Stable tag ids from the stats API, keyed by tag name, where known. */
  tagIdsByTag?: ReadonlyMap<string, string>;
}

export type FocusTagStatus = "weakest" | "below-line" | "on-track" | "needs-evidence";

export interface FocusTagDifficultyMix {
  easy: number;
  medium: number;
  hard: number;
  unspecified: number;
}

export type FocusTagDifficultyLabel = "mostly hard" | "medium-heavy" | "mostly easy" | "mixed";

export interface FocusTag {
  tag: string;
  tagId: string | null;
  /** Questions carrying this tag in the current bank. */
  bankCount: number;
  attempted: number;
  correct: number;
  /** Null when the tag has no answer events at all — NOT 0%. */
  accuracyPct: number | null;
  hasEvidence: boolean;
  /** Distinct current-bank questions never answered. */
  unseenCount: number;
  /** Distinct current-bank questions in the unmastered wrong book. */
  wrongCount: number;
  /** Questions this tag's practice action would actually draw from: unseen
   *  plus wrong, deduplicated. This is the number the row's button labels. */
  eligibleCount: number;
  /** Difficulty composition of the eligible questions, not of the whole tag. */
  difficulty: FocusTagDifficultyMix;
  difficultyLabel: FocusTagDifficultyLabel | null;
  status: FocusTagStatus;
  priority: number;
}

function difficultyLabelFor(mix: FocusTagDifficultyMix): FocusTagDifficultyLabel | null {
  const known = mix.easy + mix.medium + mix.hard;
  if (known === 0) return null;
  if (mix.hard / known >= 0.5) return "mostly hard";
  if (mix.medium / known >= 0.5) return "medium-heavy";
  if (mix.easy / known >= 0.5) return "mostly easy";
  return "mixed";
}

/**
 * Ranks every tag in the current bank by how much attention it needs.
 *
 *   gap      = max(0, target − accuracy)           target = passMarkPct ?? 100
 *   hardness = 1 + HARD_WEIGHT · (hard share of the tag's eligible questions)
 *   priority = gap · hardness
 *
 * A question carrying several tags contributes to each of them, so the
 * per-tag counts deliberately do not sum to the bank size.
 *
 * Order: tags with evidence first, by descending priority; then lower
 * accuracy, then more eligible questions, then tag name — so the list is
 * stable across reloads and identical for two users with identical data.
 * Tags without evidence sort last among themselves by eligible count, then
 * name: they are shown, but never presented as a measured weakness.
 */
export function rankFocusTags(input: FocusTagInput, opts: { passMarkPct: number | null }): FocusTag[] {
  const target = opts.passMarkPct ?? 100;
  const rows = new Map<string, FocusTag>();

  for (const question of input.questions) {
    const seen = input.attemptedIds.has(question.id);
    const wrong = input.wrongIds.has(question.id);
    const eligible = !seen || wrong;
    for (const tag of new Set(question.tags)) {
      let row = rows.get(tag);
      if (!row) {
        row = {
          tag,
          tagId: input.tagIdsByTag?.get(tag) ?? null,
          bankCount: 0, attempted: 0, correct: 0, accuracyPct: null, hasEvidence: false,
          unseenCount: 0, wrongCount: 0, eligibleCount: 0,
          difficulty: { easy: 0, medium: 0, hard: 0, unspecified: 0 },
          difficultyLabel: null, status: "needs-evidence", priority: 0,
        };
        rows.set(tag, row);
      }
      row.bankCount += 1;
      if (!seen) row.unseenCount += 1;
      if (wrong) row.wrongCount += 1;
      if (eligible) {
        row.eligibleCount += 1;
        row.difficulty[question.difficulty ?? "unspecified"] += 1;
      }
    }
  }

  const ranked = [...rows.values()];
  for (const row of ranked) {
    const accuracy = input.accuracyByTag.get(row.tag);
    if (accuracy) {
      row.attempted = accuracy.attempted;
      row.correct = accuracy.correct;
      row.accuracyPct = accuracy.attempted > 0 ? accuracy.accuracyPct : null;
    }
    row.hasEvidence = row.attempted >= FOCUS_TAG_MIN_ANSWERS && row.accuracyPct != null;
    row.difficultyLabel = difficultyLabelFor(row.difficulty);

    if (!row.hasEvidence) {
      row.status = "needs-evidence";
      row.priority = 0;
      continue;
    }
    const known = row.difficulty.easy + row.difficulty.medium + row.difficulty.hard;
    const hardShare = known > 0 ? row.difficulty.hard / known : 0;
    const gap = Math.max(0, target - row.accuracyPct!);
    row.priority = gap * (1 + FOCUS_TAG_HARD_WEIGHT * hardShare);
    row.status = opts.passMarkPct == null ? "on-track" : row.accuracyPct! < opts.passMarkPct ? "below-line" : "on-track";
  }

  ranked.sort((a, b) => {
    if (a.hasEvidence !== b.hasEvidence) return a.hasEvidence ? -1 : 1;
    if (a.hasEvidence) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if ((a.accuracyPct ?? 0) !== (b.accuracyPct ?? 0)) return (a.accuracyPct ?? 0) - (b.accuracyPct ?? 0);
    }
    if (b.eligibleCount !== a.eligibleCount) return b.eligibleCount - a.eligibleCount;
    return a.tag.localeCompare(b.tag);
  });

  // "Weakest" is a superlative, so exactly one row may carry it, and only when
  // it is actually behind: a top-ranked tag at 100% is not a weak spot.
  const first = ranked[0];
  if (first && first.hasEvidence && first.priority > 0) first.status = "weakest";
  return ranked;
}

/* -------------------------------------------------------------------------
   Study week
   ------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function toUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `date`, as a UTC "YYYY-MM-DD" key. */
export function isoWeekStartKey(date: Date): string {
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const isoWeekday = (new Date(utc).getUTCDay() + 6) % 7; // Monday = 0
  return toUtcDateKey(new Date(utc - isoWeekday * DAY_MS));
}

export interface StudyWeekDay {
  date: string;
  weekday: (typeof WEEKDAY_LABELS)[number];
  sessionsCompleted: number;
  questionsAnswered: number;
  /** Seconds of RECORDED session time. 0 = nothing studied that day; null =
   *  sessions happened but none recorded a duration, which is not zero. */
  durationSeconds: number | null;
  sessionsWithDuration: number;
}

export interface StudyWeek {
  weekStart: string;
  days: StudyWeekDay[];
  /** Null only when every session in the week is missing its duration. */
  totalDurationSeconds: number | null;
  sessionsCompleted: number;
  sessionsWithDuration: number;
  sessionsMissingDuration: number;
  /** Mean over sessions that RECORDED a duration, never over all sessions. */
  averageSessionSeconds: number | null;
  longestDay: { date: string; weekday: string; durationSeconds: number } | null;
  activeDayCount: number;
}

/** Builds the Mon-Sun view of one week from the activity DTO's day rows. */
export function buildStudyWeek(days: readonly StudyActivityDay[], weekStart: string): StudyWeek {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const start = Date.parse(`${weekStart}T00:00:00Z`);
  const out: StudyWeekDay[] = [];
  let sessionsCompleted = 0;
  let sessionsWithDuration = 0;
  let durationTotal = 0;
  let activeDayCount = 0;
  let longestDay: StudyWeek["longestDay"] = null;

  for (let i = 0; i < 7; i++) {
    const date = toUtcDateKey(new Date(start + i * DAY_MS));
    const weekday = WEEKDAY_LABELS[i]!;
    const row = byDate.get(date);
    if (!row) {
      out.push({ date, weekday, sessionsCompleted: 0, questionsAnswered: 0, durationSeconds: 0, sessionsWithDuration: 0 });
      continue;
    }
    sessionsCompleted += row.sessionsCompleted;
    sessionsWithDuration += row.sessionsWithDuration;
    if (row.sessionsCompleted > 0) activeDayCount += 1;
    const durationSeconds = row.sessionsCompleted === 0
      ? 0
      : row.sessionsWithDuration === 0 ? null : (row.durationSeconds ?? 0);
    if (durationSeconds != null && durationSeconds > 0) {
      durationTotal += durationSeconds;
      if (!longestDay || durationSeconds > longestDay.durationSeconds) longestDay = { date, weekday, durationSeconds };
    }
    out.push({
      date, weekday,
      sessionsCompleted: row.sessionsCompleted,
      questionsAnswered: row.questionsAnswered,
      durationSeconds,
      sessionsWithDuration: row.sessionsWithDuration,
    });
  }

  return {
    weekStart,
    days: out,
    totalDurationSeconds: sessionsCompleted > 0 && sessionsWithDuration === 0 ? null : durationTotal,
    sessionsCompleted,
    sessionsWithDuration,
    sessionsMissingDuration: Math.max(0, sessionsCompleted - sessionsWithDuration),
    averageSessionSeconds: sessionsWithDuration > 0 ? Math.round(durationTotal / sessionsWithDuration) : null,
    longestDay,
    activeDayCount,
  };
}

/* -------------------------------------------------------------------------
   Trend window and countdown
   ------------------------------------------------------------------------- */

// The concept shows "Last 11 active days". Active days, not calendar days:
// the trend only has buckets for days with completed answers.
export const ACCURACY_TREND_ACTIVE_DAYS = 11;

export function latestActiveDays(trend: readonly AccuracyTrendPoint[], count = ACCURACY_TREND_ACTIVE_DAYS): AccuracyTrendPoint[] {
  if (count <= 0) return [];
  return trend.slice(Math.max(0, trend.length - count));
}

/** Whole UTC days from `today` to `targetDate`. Negative once the date passes. */
export function daysUntil(targetDate: string, today: Date): number | null {
  const target = Date.parse(`${targetDate}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const from = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - from) / DAY_MS);
}
