// implementation — the aggregates behind the Statistics screen. These cover the
// cases the issue calls out explicitly: repeated answers, deleted-bank
// questions, questions carrying several tags, week boundaries, insufficient
// evidence, and the difference between "zero" and "unavailable".

import assert from "node:assert/strict";
import test from "node:test";
import type { DifficultyBreakdown, StudyActivityDay } from "./stats.ts";
import {
  buildStudyWeek, computeReadiness, daysUntil, isoWeekStartKey, latestActiveDays,
  rankFocusTags, READINESS_MIN_ANSWERED_QUESTIONS, READINESS_MIN_ANSWER_EVENTS,
  type FocusTagAccuracy, type FocusTagQuestion,
} from "./statistics.ts";
import { isValidTargetDate, isValidWeeklyGoalMinutes } from "./examPreferences.ts";

/* --- Readiness ----------------------------------------------------------- */

const difficulty = (rows: [DifficultyBreakdown["difficulty"], number, number][]): DifficultyBreakdown[] =>
  rows.map(([d, attempted, correct]) => ({
    difficulty: d, attempted, correct, accuracyPct: attempted ? Math.round((correct / attempted) * 100) : 0,
  }));

test("readiness: withheld until both sample floors are met", () => {
  const justUnder = computeReadiness({
    bankSize: 400,
    attemptedInBank: READINESS_MIN_ANSWERED_QUESTIONS - 1,
    answerEvents: 200,
    byDifficulty: difficulty([["medium", 200, 150]]),
  });
  assert.equal(justUnder.available, false);
  assert.equal(justUnder.available === false && justUnder.reason, "insufficient-sample");
  // Coverage is still reported: it is a fact, it just is not readiness.
  assert.equal(justUnder.coveragePct, 7);

  const fewEvents = computeReadiness({
    bankSize: 400, attemptedInBank: 40, answerEvents: READINESS_MIN_ANSWER_EVENTS - 1,
    byDifficulty: difficulty([["medium", 39, 30]]),
  });
  assert.equal(fewEvents.available, false);
});

test("readiness: no attempts is not zero accuracy", () => {
  const none = computeReadiness({ bankSize: 100, attemptedInBank: 0, answerEvents: 0, byDifficulty: [] });
  assert.equal(none.available, false);
  assert.equal(none.available === false && none.reason, "no-attempts");
});

test("readiness: an empty bank reports no-bank rather than dividing by zero", () => {
  const none = computeReadiness({ bankSize: 0, attemptedInBank: 0, answerEvents: 0, byDifficulty: [] });
  assert.equal(none.available === false && none.reason, "no-bank");
  assert.equal(none.coveragePct, 0);
});

test("readiness: hard questions carry more weight than easy ones", () => {
  const base = { bankSize: 100, attemptedInBank: 100, answerEvents: 100 };
  const strongOnHard = computeReadiness({ ...base, byDifficulty: difficulty([["easy", 50, 25], ["hard", 50, 50]]) });
  const strongOnEasy = computeReadiness({ ...base, byDifficulty: difficulty([["easy", 50, 50], ["hard", 50, 25]]) });
  assert.equal(strongOnHard.available, true);
  assert.equal(strongOnEasy.available, true);
  assert.ok(
    strongOnHard.available && strongOnEasy.available && strongOnHard.scorePct > strongOnEasy.scorePct,
    "the same raw accuracy should score higher when the correct answers are the hard ones",
  );
});

test("readiness: full coverage collapses to the weighted accuracy itself", () => {
  const result = computeReadiness({
    bankSize: 60, attemptedInBank: 60, answerEvents: 120,
    byDifficulty: difficulty([["medium", 120, 90]]),
  });
  assert.equal(result.available, true);
  assert.equal(result.available && result.scorePct, 75);
  assert.equal(result.coveragePct, 100);
});

test("readiness: unseen questions discount the score but do not zero it", () => {
  const half = computeReadiness({
    bankSize: 120, attemptedInBank: 60, answerEvents: 120,
    byDifficulty: difficulty([["medium", 120, 120]]),
  });
  // 100% weighted accuracy x (0.5 + 0.5 x 0.75) = 87.5 -> 88.
  assert.equal(half.available && half.scorePct, 88);
});

test("readiness: coverage is clamped when answers outlive their questions", () => {
  // attemptedInBank can never exceed bankSize, but guard the arithmetic anyway.
  const result = computeReadiness({
    bankSize: 50, attemptedInBank: 80, answerEvents: 200,
    byDifficulty: difficulty([["medium", 200, 100]]),
  });
  assert.equal(result.coveragePct, 100);
  assert.ok(result.available && result.scorePct <= 100);
});

/* --- Focus tags ---------------------------------------------------------- */

const q = (id: string, tags: string[], difficulty: FocusTagQuestion["difficulty"] = null): FocusTagQuestion =>
  ({ id, tags, difficulty });
const acc = (attempted: number, correct: number): FocusTagAccuracy =>
  ({ attempted, correct, accuracyPct: Math.round((correct / attempted) * 100) });

test("focus tags: a multi-tag question counts once for each of its tags", () => {
  const ranked = rankFocusTags({
    questions: [q("a", ["Networking", "Security"], "hard")],
    attemptedIds: new Set(),
    wrongIds: new Set(),
    accuracyByTag: new Map(),
  }, { passMarkPct: 75 });
  assert.equal(ranked.length, 2);
  for (const row of ranked) {
    assert.equal(row.bankCount, 1);
    assert.equal(row.unseenCount, 1);
    assert.equal(row.eligibleCount, 1);
    assert.equal(row.difficulty.hard, 1);
  }
});

test("focus tags: eligible is unseen plus unmastered-wrong, deduplicated", () => {
  const ranked = rankFocusTags({
    questions: [q("seen-ok", ["T"]), q("seen-wrong", ["T"]), q("unseen", ["T"])],
    attemptedIds: new Set(["seen-ok", "seen-wrong"]),
    wrongIds: new Set(["seen-wrong"]),
    accuracyByTag: new Map([["T", acc(10, 6)]]),
  }, { passMarkPct: 75 });
  const row = ranked[0]!;
  assert.equal(row.bankCount, 3);
  assert.equal(row.unseenCount, 1);
  assert.equal(row.wrongCount, 1);
  // "seen-wrong" is wrong but not unseen; "unseen" is unseen but not wrong.
  assert.equal(row.eligibleCount, 2);
});

test("focus tags: a question deleted from the bank leaves every count alone", () => {
  // The user answered "gone", which is no longer in `questions`; its accuracy
  // row survives in the stats payload. Counts must come from the bank only.
  const ranked = rankFocusTags({
    questions: [q("still-here", ["T"])],
    attemptedIds: new Set(["gone", "still-here"]),
    wrongIds: new Set(["gone"]),
    accuracyByTag: new Map([["T", acc(20, 10)]]),
  }, { passMarkPct: 75 });
  const row = ranked[0]!;
  assert.equal(row.bankCount, 1);
  assert.equal(row.wrongCount, 0);
  assert.equal(row.unseenCount, 0);
  assert.equal(row.eligibleCount, 0);
  // Accuracy still reflects every answer, including the deleted question's.
  assert.equal(row.accuracyPct, 50);
});

test("focus tags: below the evidence floor a tag is listed but never called weakest", () => {
  const ranked = rankFocusTags({
    questions: [q("a", ["Thin"]), q("b", ["Thick"]), q("c", ["Thick"])],
    attemptedIds: new Set(["a", "b"]),
    wrongIds: new Set(),
    accuracyByTag: new Map([["Thin", acc(2, 0)], ["Thick", acc(30, 20)]]),
  }, { passMarkPct: 75 });
  const thin = ranked.find((r) => r.tag === "Thin")!;
  const thick = ranked.find((r) => r.tag === "Thick")!;
  assert.equal(thin.status, "needs-evidence");
  assert.equal(thin.hasEvidence, false);
  // 0% over two answers must not outrank 67% over thirty.
  assert.ok(ranked.indexOf(thick) < ranked.indexOf(thin));
  assert.equal(thick.status, "weakest");
});

test("focus tags: no tag is weakest when every measured tag clears the line", () => {
  const ranked = rankFocusTags({
    questions: [q("a", ["A"]), q("b", ["B"])],
    attemptedIds: new Set(["a", "b"]),
    wrongIds: new Set(),
    accuracyByTag: new Map([["A", acc(20, 20)], ["B", acc(20, 20)]]),
  }, { passMarkPct: 75 });
  assert.deepEqual(ranked.map((r) => r.status), ["on-track", "on-track"]);
});

test("focus tags: without a pass mark nothing is labelled below the line", () => {
  const ranked = rankFocusTags({
    questions: [q("a", ["A"])],
    attemptedIds: new Set(["a"]),
    wrongIds: new Set(),
    accuracyByTag: new Map([["A", acc(20, 10)]]),
  }, { passMarkPct: null });
  assert.equal(ranked[0]!.status, "weakest");
  assert.ok(ranked.every((r) => r.status !== "below-line"));
});

test("focus tags: ranking is deterministic for identical inputs", () => {
  const input = () => ({
    questions: [q("a", ["Alpha"], "hard"), q("b", ["Beta"], "easy"), q("c", ["Gamma"])],
    attemptedIds: new Set<string>(),
    wrongIds: new Set<string>(),
    accuracyByTag: new Map([["Alpha", acc(10, 6)], ["Beta", acc(10, 6)], ["Gamma", acc(10, 6)]]),
  });
  const first = rankFocusTags(input(), { passMarkPct: 75 }).map((r) => r.tag);
  const second = rankFocusTags(input(), { passMarkPct: 75 }).map((r) => r.tag);
  assert.deepEqual(first, second);
  // Same accuracy, so the hard tag leads and the rest fall back to name order.
  assert.deepEqual(first, ["Alpha", "Beta", "Gamma"]);
});

test("focus tags: difficulty label describes the eligible questions", () => {
  const ranked = rankFocusTags({
    questions: [q("a", ["T"], "hard"), q("b", ["T"], "hard"), q("c", ["T"], "easy")],
    attemptedIds: new Set(),
    wrongIds: new Set(),
    accuracyByTag: new Map(),
  }, { passMarkPct: null });
  assert.equal(ranked[0]!.difficultyLabel, "mostly hard");
});

/* --- Study week ---------------------------------------------------------- */

const day = (date: string, sessions: number, questions: number, duration: number | null, withDuration: number): StudyActivityDay =>
  ({ date, sessionsCompleted: sessions, questionsAnswered: questions, durationSeconds: duration, sessionsWithDuration: withDuration });

test("study week: starts on Monday in UTC", () => {
  // 2026-09-20 is a Sunday; its ISO week began on Monday the 14th.
  assert.equal(isoWeekStartKey(new Date("2026-09-20T23:59:00Z")), "2026-09-14");
  assert.equal(isoWeekStartKey(new Date("2026-09-14T00:00:00Z")), "2026-09-14");
  assert.equal(isoWeekStartKey(new Date("2026-09-21T00:00:00Z")), "2026-09-21");
});

test("study week: always seven days, and days outside the week are excluded", () => {
  const week = buildStudyWeek(
    [day("2026-09-13", 3, 30, 3600, 3), day("2026-09-16", 1, 10, 1800, 1), day("2026-09-21", 5, 50, 9000, 5)],
    "2026-09-14",
  );
  assert.equal(week.days.length, 7);
  assert.deepEqual(week.days.map((d) => d.weekday), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  // Only Wednesday's session is inside the week.
  assert.equal(week.sessionsCompleted, 1);
  assert.equal(week.totalDurationSeconds, 1800);
  assert.equal(week.activeDayCount, 1);
});

test("study week: no sessions is zero, sessions without durations is unavailable", () => {
  const week = buildStudyWeek(
    [day("2026-09-15", 2, 20, null, 0), day("2026-09-16", 1, 10, 1200, 1)],
    "2026-09-14",
  );
  const monday = week.days[0]!;
  const tuesday = week.days[1]!;
  const wednesday = week.days[2]!;
  assert.equal(monday.durationSeconds, 0, "a day with no sessions studied for zero seconds");
  assert.equal(tuesday.durationSeconds, null, "a day whose sessions recorded nothing is unavailable, not zero");
  assert.equal(wednesday.durationSeconds, 1200);
  assert.equal(week.sessionsMissingDuration, 2);
  // The average is over sessions that recorded a duration, never over all.
  assert.equal(week.averageSessionSeconds, 1200);
  assert.equal(week.longestDay?.weekday, "Wed");
});

test("study week: a week whose every session lacks a duration reports null, not zero", () => {
  const week = buildStudyWeek([day("2026-09-15", 4, 40, null, 0)], "2026-09-14");
  assert.equal(week.totalDurationSeconds, null);
  assert.equal(week.averageSessionSeconds, null);
  assert.equal(week.longestDay, null);
  assert.equal(week.sessionsCompleted, 4);
});

test("study week: an empty activity payload is a quiet week, not a broken one", () => {
  const week = buildStudyWeek([], "2026-09-14");
  assert.equal(week.days.length, 7);
  assert.equal(week.totalDurationSeconds, 0);
  assert.equal(week.sessionsCompleted, 0);
  assert.equal(week.averageSessionSeconds, null);
});

/* --- Trend window and countdown ------------------------------------------ */

const trendPoint = (date: string, attempted: number, correct: number) =>
  ({ date, attempted, correct, accuracyPct: Math.round((correct / attempted) * 100) });

test("trend: takes the LATEST active days, and copes with none or one", () => {
  const points = Array.from({ length: 20 }, (_, i) => trendPoint(`2026-09-${String(i + 1).padStart(2, "0")}`, 10, i));
  const latest = latestActiveDays(points, 11);
  assert.equal(latest.length, 11);
  assert.equal(latest[latest.length - 1]!.date, "2026-09-20");
  assert.equal(latestActiveDays([], 11).length, 0);
  assert.equal(latestActiveDays([points[0]!], 11).length, 1);
});

test("countdown: whole UTC days, and negative once the date has passed", () => {
  const today = new Date("2026-09-20T18:00:00Z");
  assert.equal(daysUntil("2026-10-27", today), 37);
  assert.equal(daysUntil("2026-09-20", today), 0);
  assert.equal(daysUntil("2026-09-19", today), -1);
  assert.equal(daysUntil("not-a-date", today), null);
});

/* --- Preferences validation ---------------------------------------------- */

test("preferences: only real calendar days and in-range goals are accepted", () => {
  assert.equal(isValidTargetDate("2026-10-27"), true);
  assert.equal(isValidTargetDate("2026-02-31"), false);
  assert.equal(isValidTargetDate("27/10/2026"), false);
  assert.equal(isValidTargetDate(null), false);

  assert.equal(isValidWeeklyGoalMinutes(480), true);
  assert.equal(isValidWeeklyGoalMinutes(0), false);
  assert.equal(isValidWeeklyGoalMinutes(60.5), false);
  assert.equal(isValidWeeklyGoalMinutes(10081), false);
});
