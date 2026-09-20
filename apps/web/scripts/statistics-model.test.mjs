// implementation — the Statistics screen's view model: which client state feeds
// which shared computation, and how an unavailable figure is worded. The
// arithmetic itself is covered in packages/shared/src/statistics.test.ts.
//
// Bundled rather than transformed: lib/statistics.ts imports @prepdeck/shared.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const web = fileURLToPath(new URL('../', import.meta.url));
const { outputFiles } = await build({
  entryPoints: [resolve(web, 'src/lib/statistics.ts')],
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  alias: { '@': resolve(web, 'src') },
});
const {
  buildStatisticsModel, eligibleQuestionIdsForTags, formatDuration, formatSignedPoints, readinessNarrative,
} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);

const NOW = new Date('2026-09-20T12:00:00Z');

const question = (id, tags, diff = null) => ({
  id, externalId: null, sequenceNumber: 1, type: 'single_choice', chooseCount: null, tags, diff, stem: '', options: null,
});

const statsPayload = (over = {}) => ({
  examId: 'exam', schemaVersion: 2,
  totalAttempted: 3, attemptedInBank: 3, bankSize: 6,
  totalAnswers: 9, totalCorrect: 6, overallAccuracyPct: 67,
  passMarkPct: 75, weeklyNewQuestions: 2,
  accuracyComparison: {
    days: 7,
    current: { attempted: 5, correct: 4, accuracyPct: 80 },
    previous: { attempted: 4, correct: 3, accuracyPct: 75 },
    deltaPts: 5,
  },
  accuracyTrend: [
    { date: '2026-09-18', attempted: 4, correct: 2, accuracyPct: 50 },
    { date: '2026-09-19', attempted: 4, correct: 3, accuracyPct: 75 },
    { date: '2026-09-20', attempted: 5, correct: 4, accuracyPct: 80 },
  ],
  byTag: [
    { tagId: 't-net', tag: 'Networking', attempted: 20, correct: 10, accuracyPct: 50 },
    { tagId: 't-cost', tag: 'Cost', attempted: 20, correct: 18, accuracyPct: 90 },
  ],
  byDifficulty: [{ difficulty: 'medium', attempted: 9, correct: 6, accuracyPct: 67 }],
  mockScoreHistory: [
    { attemptId: 'm1', completedAt: '2026-09-10T10:00:00Z', score: 60, totalQuestions: 65, passed: false },
    { attemptId: 'm2', completedAt: '2026-09-15T10:00:00Z', score: 82, totalQuestions: 65, passed: true },
  ],
  bestMock: { attemptId: 'm2', completedAt: '2026-09-15T10:00:00Z', score: 82, totalQuestions: 65, passed: true },
  lastAttemptAt: '2026-09-20T09:00:00Z',
  ...over,
});

const sources = (over = {}) => ({
  stats: statsPayload(),
  activity: {
    days: [
      { date: '2026-09-16', sessionsCompleted: 2, questionsAnswered: 20, durationSeconds: 3120, sessionsWithDuration: 2 },
      { date: '2026-09-19', sessionsCompleted: 1, questionsAnswered: 10, durationSeconds: null, sessionsWithDuration: 0 },
    ],
    activeDayCount: 2, averageSessionSeconds: 1560, sessionsCompleted: 3, sessionsWithDuration: 2,
  },
  preferences: { examId: 'exam', targetDate: '2026-10-27', weeklyGoalMinutes: 480 },
  catalog: [
    question('n1', ['Networking'], 'hard'),
    question('n2', ['Networking'], 'hard'),
    question('n3', ['Networking', 'Cost'], 'medium'),
    question('c1', ['Cost'], 'easy'),
    question('c2', ['Cost'], 'medium'),
    question('u1', ['Security'], null),
  ],
  attempted: { n1: true, n2: true, c1: true },
  wrong: { n1: { c: 3, at: '2026-09-19T10:00:00Z' }, c1: { c: 1, at: '2026-08-01T10:00:00Z' } },
  mastered: {},
  now: NOW,
  ...over,
});

test('coverage comes from the server bank size and stays distinct from readiness', () => {
  const model = buildStatisticsModel(sources());
  assert.equal(model.coverage.seen, 3);
  assert.equal(model.coverage.total, 6);
  assert.equal(model.coverage.pct, 50);
  // Nine answers over three questions is below the evidence floor, so
  // readiness is withheld and the ring falls back to coverage.
  assert.equal(model.readiness.available, false);
  assert.equal(model.readiness.reason, 'insufficient-sample');
  assert.equal(model.passMarkPct, 75);
});

test('answer events and distinct questions are reported separately', () => {
  const model = buildStatisticsModel(sources());
  assert.equal(model.answered.questions, 3, 'the Answered card counts distinct questions');
  assert.equal(model.accuracy.answerEvents, 9, 'accuracy is weighted by answer events');
  assert.equal(model.answered.newThisWeek, 2, 'repeated answers do not add coverage');
  assert.equal(model.answered.unseen, 3);
});

test('a bank that shrank below what was answered never reports over 100% coverage', () => {
  const model = buildStatisticsModel(sources({
    stats: statsPayload({ attemptedInBank: 9, bankSize: 6 }),
  }));
  assert.equal(model.coverage.pct, 100);
  assert.equal(model.answered.unseen, 0);
});

test('the wrong book counts only unmastered entries that are still in the bank', () => {
  const model = buildStatisticsModel(sources({
    wrong: {
      n1: { c: 3, at: '2026-09-19T10:00:00Z' },
      c1: { c: 1, at: '2026-08-01T10:00:00Z' },
      deleted: { c: 5, at: '2026-09-19T10:00:00Z' },
    },
    mastered: { c1: true },
  }));
  assert.equal(model.wrongBook.saved, 1, 'mastered and deleted entries drop out');
  assert.equal(model.wrongBook.repeated, 1);
  assert.equal(model.wrongBook.recent, 1);
  assert.deepEqual(model.wrongBook.strip.map((e) => e.id), ['n1']);
});

test('the trend domain always contains the pass line', () => {
  const model = buildStatisticsModel(sources({
    stats: statsPayload({
      passMarkPct: 95,
      accuracyTrend: [{ date: '2026-09-20', attempted: 4, correct: 1, accuracyPct: 25 }],
    }),
  }));
  const [lo, hi] = model.trend.domain;
  assert.ok(lo <= 25 && hi >= 95, `domain ${lo}-${hi} should contain both 25% and the 95% pass line`);
  assert.equal(model.trend.activeDays, 1);
  assert.equal(model.trend.latestPct, 25);
});

test('an exam with no pass mark drops every pass comparison', () => {
  // Sample-sufficient on purpose: the narrative's pass-line branch is only
  // reached once readiness is actually available.
  const model = buildStatisticsModel(sources({
    stats: statsPayload({
      passMarkPct: null, attemptedInBank: 60, bankSize: 120, totalAnswers: 200,
      byDifficulty: [{ difficulty: 'medium', attempted: 200, correct: 150, accuracyPct: 75 }],
    }),
  }));
  assert.equal(model.readiness.available, true);
  assert.equal(model.passMarkPct, null);
  assert.equal(model.trend.passMarkPct, null);
  assert.ok(model.bestMock.recent.every((m) => m.passed === true || m.passed === false || m.passed === null));
  assert.ok(model.focus.every((t) => t.status !== 'below-line'));
  assert.match(readinessNarrative(model, 'Cloud Pro'), /no pass mark/i);
});

test('weak-tag actions only offer tags with evidence and questions left', () => {
  const model = buildStatisticsModel(sources());
  assert.deepEqual(model.weakTags, ['Networking']);
  // Networking's eligible set is n1 (answered, still in the wrong book) and n3
  // (never seen). n2 was answered correctly, so it is not offered again.
  assert.deepEqual(eligibleQuestionIdsForTags(sources(), ['Networking']).sort(), ['n1', 'n3']);
  const networking = model.focus.find((t) => t.tag === 'Networking');
  assert.equal(networking.eligibleCount, 2, 'the row label matches what the action would practise');
  assert.equal(networking.status, 'weakest');
});

test('a tag with nothing left to practise is excluded from the weak-tag action', () => {
  const model = buildStatisticsModel(sources({
    attempted: { n1: true, n2: true, n3: true, c1: true, c2: true, u1: true },
    wrong: {},
  }));
  assert.deepEqual(model.weakTags, []);
  const networking = model.focus.find((t) => t.tag === 'Networking');
  assert.equal(networking.eligibleCount, 0);
});

test('the study week separates "nothing studied" from "duration unavailable"', () => {
  const model = buildStatisticsModel(sources());
  // Week of Monday 2026-09-14: index 2 is Wednesday, index 5 is Saturday.
  const mon = model.week.days[0];
  const wed = model.week.days[2];
  const sat = model.week.days[5];
  assert.equal(wed.durationSeconds, 3120);
  assert.equal(sat.durationSeconds, null, 'Saturday had a session that recorded no duration');
  assert.equal(mon.durationSeconds, 0, 'Monday had no sessions at all');
  assert.equal(model.week.sessionsMissingDuration, 1);
  assert.equal(formatDuration(3120), '52m');
  assert.equal(formatDuration(4200), '1h 10m');
  assert.equal(formatDuration(0), '—');
  assert.equal(formatDuration(null), '?');
});

test('missing stats produce placeholders that the Dashboard must gate on request availability', () => {
  const model = buildStatisticsModel(sources({ stats: null }));
  assert.equal(model.coverage.total, 6);
  assert.equal(model.coverage.seen, 0);
  assert.equal(model.passMarkPct, null);
  assert.equal(model.accuracy.deltaPts, null);
  assert.equal(model.bestMock.best, null);
  assert.equal(model.readiness.available, false);
});

test('an empty bank, no attempts and no preferences all have their own wording', () => {
  const empty = buildStatisticsModel(sources({
    stats: statsPayload({ bankSize: 0, attemptedInBank: 0, totalAnswers: 0, accuracyTrend: [], mockScoreHistory: [], bestMock: null }),
    catalog: [], attempted: {}, wrong: {}, preferences: { examId: 'exam', targetDate: null, weeklyGoalMinutes: null },
  }));
  assert.equal(empty.countdown, null);
  assert.equal(empty.weeklyGoalMinutes, null);
  assert.equal(empty.focus.length, 0);
  assert.match(readinessNarrative(empty, 'Cloud Pro'), /no questions yet/i);

  const noAttempts = buildStatisticsModel(sources({
    stats: statsPayload({ attemptedInBank: 0, totalAnswers: 0, accuracyTrend: [] }),
    attempted: {}, wrong: {},
  }));
  assert.match(readinessNarrative(noAttempts, 'Cloud Pro'), /answer some questions/i);
});

test('the countdown is whole UTC days from the user-supplied date', () => {
  const model = buildStatisticsModel(sources());
  assert.deepEqual(model.countdown, { targetDate: '2026-10-27', daysLeft: 37, passed: false });

  const past = buildStatisticsModel(sources({
    preferences: { examId: 'exam', targetDate: '2026-09-01', weeklyGoalMinutes: 480 },
  }));
  assert.equal(past.countdown.passed, true);
});

test('a positive, negative and flat accuracy delta each read differently', () => {
  assert.equal(formatSignedPoints(5), '+5 pts');
  assert.equal(formatSignedPoints(-5), '−5 pts');
  assert.equal(formatSignedPoints(0), '±0 pts');
});

test('readiness, once available, is reported against the pass line and nothing more', () => {
  const model = buildStatisticsModel(sources({
    stats: statsPayload({ attemptedInBank: 60, bankSize: 120, totalAnswers: 200, byDifficulty: [{ difficulty: 'medium', attempted: 200, correct: 200, accuracyPct: 100 }] }),
  }));
  assert.equal(model.readiness.available, true);
  assert.equal(model.readiness.scorePct, 88);
  const copy = readinessNarrative(model, 'Cloud Pro');
  assert.match(copy, /13 points above the 75% pass line/);
  // Decision 1: no "practise N questions and you will pass" claim anywhere.
  assert.doesNotMatch(copy, /questions? (closes|close)/i);
});
