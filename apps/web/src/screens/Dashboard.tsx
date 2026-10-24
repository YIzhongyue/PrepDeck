// The Statistics screen (screen id "dash"), redesigned in implementation against
// the exam-preparation dashboard concept.
//
// This file is orchestration only: it fetches, it handles per-request failure
// and retry, it owns the navigation intents, and it hands a single derived
// model to the cards under components/statistics/. Every number on the screen
// comes from lib/statistics.ts, which in turn leans on @prepdeck/shared so the
// REST dashboard and the User MCP cannot drift apart.
//
// The pre-implementation detail — difficulty breakdown, full mock history and the
// long-range activity heatmap — is still here, moved into a disclosure below
// the primary sections rather than removed.

import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { AlertTriangle, CheckDone01, TrendUp02, Trophy01 } from "@untitledui/icons";
import type { ExamStatsResponse, ExamStudyPreferencesResponse, FocusTag, StudyActivityResponse, UpdateExamStudyPreferencesRequest } from "@prepdeck/shared";
import { DEFAULT_TIME_ZONE, MAX_ATTEMPT_QUESTIONS, addDaysToDateKey, zonedDateKey } from "@prepdeck/shared";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ProgressBarBase } from "@/components/base/progress-indicators/progress-indicators";
import {
  useAccountState, useCatalogState, usePracticeActions, usePracticeState, useReviewListsActions, useReviewListsState,
  useStudyProgressState, useWorkspaceActions, useWorkspaceState,
} from "../store/PrepDeckContext";
import { apiFetch } from "../lib/api";
import { useStatisticsResource } from "../hooks/useStatisticsResource";
import {
  buildStatisticsModel, eligibleQuestionIdsForTags, formatDate, formatSignedPoints,
  type StatisticsSources,
} from "../lib/statistics";
import StatisticsHeader from "../components/statistics/StatisticsHeader";
import ReadinessCard from "../components/statistics/ReadinessCard";
import MetricCard from "../components/statistics/MetricCard";
import FocusTagsCard from "../components/statistics/FocusTagsCard";
import FirstSessionCard from "../components/statistics/FirstSessionCard";
import "../components/statistics/statistics.css";
import { formatList, t as translate, useI18n } from "../i18n";
import { difficultyLabel } from "../lib/labels";

// Recharts only arrives with these two cards. Splitting them out keeps the
// readiness card and the metric row painting without waiting for that chunk —
// this screen is the landing screen, so that wait would be the first thing a
// user sees.
const AccuracyTrendCard = lazy(() => import("../components/statistics/AccuracyTrendCard"));
const StudyTimeCard = lazy(() => import("../components/statistics/StudyTimeCard"));
const StudyPlanDialog = lazy(() => import("../components/statistics/StudyPlanDialog"));

const HEATMAP_DAYS = 84; // 12 weeks, matches the 7-row grid below
// The first-session quick start: Practice's own default size and pace.
const FIRST_SESSION_SIZE = 10;
const MINUTES_PER_QUESTION = 1.5;

function DataUnavailable({ title, failed }: { title: string; failed: boolean }) {
  const { t } = useI18n();
  return (
    <section className="pd-stats-card" role="status" aria-label={title}>
      <h3>{title}</h3>
      <p className="pd-stats-muted" style={{ margin: 0 }}>
        {failed ? t("stats.unavailableRetry") : t("common.loading")}
      </p>
    </section>
  );
}

function ChartPlaceholder({ label }: { label: string }) {
  return (
    <section className="pd-stats-card" style={{ minHeight: 320, justifyContent: "center" }} role="status">
      <p className="pd-stats-muted" style={{ margin: 0, fontSize: 13 }}>{label}</p>
    </section>
  );
}

function heatColor(questions: number): string {
  if (questions <= 0) return "var(--color-neutral-200)";
  if (questions <= 5) return "var(--color-accent-2-200)";
  if (questions <= 15) return "var(--color-accent-2-400)";
  return "var(--color-accent-2-600)";
}

// The days are the activity payload's calendar days, so "today" is taken in
// the zone they were counted in, not the browser's or UTC.
function heatCells(activity: StudyActivityResponse | null, timeZone: string) {
  const byDate = new Map((activity?.days ?? []).map((d) => [d.date, d.questionsAnswered]));
  const cells: { key: number; bg: string; title: string }[] = [];
  const today = zonedDateKey(new Date(), timeZone);
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const iso = addDaysToDateKey(today, -i);
    const questions = byDate.get(iso) ?? 0;
    cells.push({
      key: i,
      bg: heatColor(questions),
      title: questions > 0 ? translate("stats.heatmap.day", { date: iso, count: questions }) : translate("stats.heatmap.noPractice", { date: iso })
    });
  }
  return cells;
}

/** A metric-sized sparkline. Deliberately hand-drawn rather than a second
 *  Recharts instance: it carries no axes, no tooltip and no interaction, and
 *  the Accuracy trend card below already presents these numbers in full. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 24}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" style={{ width: "100%", height: 32 }} aria-hidden="true" focusable="false">
      <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// No `bp` prop: unlike the other screens this layout is entirely CSS-driven
// (components/statistics/statistics.css), so it also reflows correctly inside a
// content column narrower than the window, which a window-width breakpoint cannot see.
export default function Dashboard() {
  const { examId, exams, me, activityRevision } = useWorkspaceState();
  const { catalog } = useCatalogState();
  const { wrong, mastered } = useReviewListsState();
  const { attempted } = useStudyProgressState();
  const { skipReview } = usePracticeState();
  const { timeZone } = useAccountState();
  const state = { examId, exams, me, activityRevision, catalog, wrong, mastered, attempted, skipReview, timeZone };
  const { go } = useWorkspaceActions();
  const { openPracticeWithFilters } = usePracticeActions();
  const { practiceList } = useReviewListsActions();
  const { t } = useI18n();

  const examUrl = state.examId ? `/api/exams/${state.examId}` : null;
  const statsRequest = useStatisticsResource<ExamStatsResponse>(examUrl && `${examUrl}/stats`, state.activityRevision);
  const activityRequest = useStatisticsResource<StudyActivityResponse>(
    state.examId ? `/api/stats/activity?examId=${state.examId}&days=${HEATMAP_DAYS}` : null, state.activityRevision,
  );
  const preferencesRequest = useStatisticsResource<ExamStudyPreferencesResponse>(examUrl && `${examUrl}/preferences`, 0);
  const { data: stats, failed: statsError } = statsRequest;
  const { data: activity, failed: activityError } = activityRequest;
  const { data: preferences, failed: preferencesError } = preferencesRequest;
  const [planOpen, setPlanOpen] = useState(false);

  const activeExam = state.exams.find((e) => e.id === state.examId) ?? null;

  const sources: StatisticsSources = useMemo(() => ({
    stats, activity, preferences,
    catalog: state.catalog,
    attempted: state.attempted,
    wrong: state.wrong,
    mastered: state.mastered,
    now: new Date(),
    // Both payloads name the zone they were counted in (issue #47).
    timeZone: activity?.timeZone ?? stats?.timeZone ?? state.timeZone ?? DEFAULT_TIME_ZONE,
  }), [stats, activity, preferences, state.catalog, state.attempted, state.wrong, state.mastered, state.timeZone]);

  const model = useMemo(() => buildStatisticsModel(sources), [sources]);

  const savePlan = async (patch: UpdateExamStudyPreferencesRequest) => {
    const examId = state.examId;
    if (!examId || !preferences) throw new Error(translate("stats.plan.loadFirst"));
    const saved = await apiFetch<ExamStudyPreferencesResponse>(`/api/exams/${examId}/preferences`, {
      method: "PATCH", body: JSON.stringify(patch),
    });
    preferencesRequest.setData(saved);
  };

  // Every call to action states the whole filter set it wants rather than
  // toggling one field and inheriting the rest from a previous session.
  const practiceTags = useCallback((tags: string[]) => {
    const eligible = eligibleQuestionIdsForTags(sources, tags).length;
    if (eligible === 0) return;
    openPracticeWithFilters({
      source: "focus", tags, diff: "all", study: "all",
      count: Math.min(eligible, MAX_ATTEMPT_QUESTIONS),
    });
  }, [sources, openPracticeWithFilters]);

  const practiceTag = useCallback((tag: FocusTag) => practiceTags([tag.tag]), [practiceTags]);

  // The quick start draws from questions never answered, and honours the
  // Practice setup's choice about questions under review.
  const firstSessionPool = useMemo(
    () => state.catalog.filter((q) => !state.attempted[q.id] && !(state.skipReview && q.needsReview)).map((q) => q.id),
    [state.catalog, state.attempted, state.skipReview],
  );
  const firstSessionSize = Math.min(FIRST_SESSION_SIZE, firstSessionPool.length);
  const startFirstSession = useCallback(() => {
    const ids = firstSessionPool.slice().sort(() => Math.random() - 0.5).slice(0, FIRST_SESSION_SIZE);
    if (ids.length) practiceList(ids);
  }, [firstSessionPool, practiceList]);

  if (!state.examId) {
    return (
      <div className="pd-stats">
        <section className="pd-stats-card" role="status">
          <h2>{t("stats.noExam")}</h2>
          <p className="pd-stats-muted" style={{ margin: 0, fontSize: 14 }}>
            {t("stats.noExamBody")}
          </p>
        </section>
      </div>
    );
  }

  if (!stats && !activity && !preferences && !statsError && !activityError && !preferencesError) {
    return <div className="pd-stats-card" role="status"><p style={{ margin: 0 }}>{t("stats.loading")}</p></div>;
  }

  const failures = [
    statsError && t("stats.failures.statistics"),
    activityError && t("stats.failures.activity"),
    preferencesError && t("stats.failures.plan"),
  ].filter(Boolean) as string[];

  const heat = heatCells(activity, model.timeZone);
  const { answered, accuracy, wrongBook, bestMock, coverage } = model;
  // Nothing answered yet: no figure below can be measured, so the page leads
  // with the first session and leaves out the two charts that would be empty.
  const firstSession = !!stats && accuracy.answerEvents === 0;
  const measured = accuracy.answerEvents > 0;

  return (
    <div className="pd-stats">
      <StatisticsHeader
        greetingName={state.me?.displayName || null}
        examName={activeExam?.name ?? null}
        countdown={model.countdown}
        planStatus={preferencesRequest.status}
        canContinue={state.catalog.length > 0}
        hasAnswers={!firstSession}
        onContinue={() => go("practice")}
        onEditPlan={() => setPlanOpen(true)}
      />

      {failures.length > 0 && (
        <div className="pd-stats-card pd-stats-card--tight" role="alert" style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: 13, flex: "1 1 240px" }}>
            {t("stats.loadFailed", { what: formatList(failures, "disjunction") })}
          </p>
          <Button size="sm" color="secondary" onClick={() => {
            if (statsError) statsRequest.retry();
            if (activityError) activityRequest.retry();
            if (preferencesError) preferencesRequest.retry();
          }}>{t("common.retry")}</Button>
        </div>
      )}

      {firstSession && (
        <FirstSessionCard
          sessionSize={firstSessionSize}
          minutes={Math.round(firstSessionSize * MINUTES_PER_QUESTION)}
          onStart={startFirstSession}
          onLearn={() => go("learning")}
        />
      )}

      <div className="pd-stats-row">
        {stats ? <ReadinessCard
          model={model}
          examName={activeExam?.name ?? null}
          canStartMock={state.catalog.length > 0}
          onPracticeWeakTags={() => practiceTags(model.weakTags)}
          onStartMock={() => go("mock", { newMock: true })}
        /> : <DataUnavailable title={t("stats.readiness.title")} failed={statsError} />}

        <div className="pd-stats-metrics">
          {stats ? <MetricCard
            icon={CheckDone01} tone="brand" label={t("stats.answered.label")}
            value={answered.questions} suffix={t("stats.answered.suffix", { total: answered.bankSize })}
            footer={t("stats.answered.footer", { added: answered.newThisWeek, days: answered.windowDays, unseen: answered.unseen })}
          >
            <ProgressBarBase value={coverage.pct} aria-label={t("stats.answered.progress", { pct: coverage.pct })} />
          </MetricCard> : <DataUnavailable title={t("stats.answered.label")} failed={statsError} />}

          {stats ? <MetricCard
            icon={TrendUp02} tone="success" label={t("stats.accuracy.label")}
            value={measured ? `${accuracy.accuracyPct}%` : "—"}
            badge={accuracy.deltaPts != null && (
              <Badge type="pill-color" size="sm" color={accuracy.deltaPts >= 0 ? "success" : "error"}>
                {formatSignedPoints(accuracy.deltaPts)}
              </Badge>
            )}
            footer={!measured
              ? accuracy.passMarkPct == null ? t("stats.accuracy.notMeasured") : t("stats.accuracy.notMeasuredPass", { pass: accuracy.passMarkPct })
              : accuracy.passMarkPct == null
              ? t("stats.accuracy.answersNoPass", { count: accuracy.answerEvents })
              : t("stats.accuracy.answersVsPass", { count: accuracy.answerEvents, pass: accuracy.passMarkPct })}
          >
            <Sparkline values={model.trend.points.map((p) => p.accuracyPct)} />
          </MetricCard> : <DataUnavailable title={t("stats.accuracy.label")} failed={statsError} />}

          <MetricCard
            icon={AlertTriangle} tone="error" label={t("stats.wrongBook.label")}
            value={wrongBook.saved} suffix={t("stats.wrongBook.suffix")}
            footer={wrongBook.saved === 0
              ? t("stats.wrongBook.empty")
              : t("stats.wrongBook.footer", { repeated: wrongBook.repeated, recent: wrongBook.recent })}
            footerTone={wrongBook.repeated > 0 ? "error" : undefined}
          >
            {/* Severity, not a schedule: PrepDeck has no review-scheduling
                model, so this deliberately does not claim anything is "due". */}
            {wrongBook.strip.length > 0 && (
              <div className="pd-stats-strip" role="img"
                aria-label={t("stats.wrongBook.strip", { saved: wrongBook.saved, repeated: wrongBook.repeated })}>
                {wrongBook.strip.map((e) => (
                  <span key={e.id} style={{
                    background: e.misses >= 3 ? "var(--color-danger)"
                      : e.misses === 2 ? "var(--color-warning)"
                      : "var(--color-neutral-400)",
                  }} />
                ))}
              </div>
            )}
          </MetricCard>

          {stats ? <MetricCard
            icon={Trophy01} tone="success" label={t("stats.bestMock.label")}
            value={bestMock.best ? `${Math.round(bestMock.best.score)}%` : "—"}
            badge={bestMock.best?.passed != null && (
              <Badge type="pill-color" size="sm" color={bestMock.best.passed ? "success" : "error"}>
                {t(bestMock.best.passed ? "stats.passed" : "stats.belowLine")}
              </Badge>
            )}
            footer={bestMock.best
              ? t("stats.bestMock.footer", { date: formatDate(bestMock.best.completedAt, model.timeZone), count: bestMock.attempts })
              : t("stats.bestMock.empty")}
          >
            {bestMock.recent.length > 0 && (
              <div className="pd-stats-mockbars" role="img"
                aria-label={t("stats.bestMock.bars", { count: bestMock.recent.length, scores: bestMock.recent.map((m) => `${Math.round(m.score)}%`).join(", ") })}>
                {bestMock.recent.map((m) => (
                  <span key={m.attemptId} style={{
                    height: `${Math.max(12, Math.min(100, m.score))}%`,
                    background: m.passed === true ? "var(--color-accent-2-600)"
                      : m.passed === false ? "var(--color-accent-300)"
                      : "var(--color-accent-400)",
                  }} />
                ))}
              </div>
            )}
          </MetricCard> : <DataUnavailable title={t("stats.bestMock.label")} failed={statsError} />}
        </div>
      </div>

      {/* The actions come before the charts: what to study next matters more
          than how the last sessions went. */}
      {stats ? <FocusTagsCard focus={model.focus} passMarkPct={model.passMarkPct} onPracticeTag={practiceTag} />
        : <DataUnavailable title={t("stats.focus.title")} failed={statsError} />}

      {!firstSession && <div className="pd-stats-row">
        {stats ? <Suspense fallback={<ChartPlaceholder label={t("stats.trend.loading")} />}>
          <AccuracyTrendCard trend={model.trend} timeZone={model.timeZone} />
        </Suspense> : <DataUnavailable title={t("stats.trend.title")} failed={statsError} />}
        {activity ? <Suspense fallback={<ChartPlaceholder label={t("stats.studyTime.loading")} />}>
          <StudyTimeCard week={model.week} timeZone={model.timeZone} weeklyGoalMinutes={model.weeklyGoalMinutes} planStatus={preferencesRequest.status} onEditPlan={() => setPlanOpen(true)} />
        </Suspense> : <DataUnavailable title={t("stats.studyTime.title")} failed={activityError} />}
      </div>}

      {/* Everything the screen showed before #151 that the concept does not
          have a place for. Kept reachable rather than dropped. */}
      <details className="pd-stats-card pd-stats-detail">
        <summary>{t("stats.detail.summary")}</summary>

        <div className="pd-stats-row" style={{ marginBottom: 24 }}>
          <div>
            <h3 style={{ marginBottom: 14 }}>{t("stats.detail.byDifficulty")}</h3>
            {stats && stats.byDifficulty.length ? stats.byDifficulty.map((d) => (
              <div key={d.difficulty} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                  <span>{difficultyLabel(d.difficulty)}</span>
                  <span className="pd-stats-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{d.accuracyPct}% ({d.correct}/{d.attempted})</span>
                </div>
                <ProgressBarBase value={d.accuracyPct} aria-label={t("stats.detail.difficultyProgress", { difficulty: difficultyLabel(d.difficulty), pct: d.accuracyPct })} />
              </div>
            )) : <p className="pd-stats-muted" style={{ margin: 0, fontSize: 13 }}>{stats ? t("stats.detail.noAttempts") : statsError ? t("stats.unavailable") : t("common.loading")}</p>}
          </div>

          <div>
            <h3 style={{ marginBottom: 14 }}>{t("stats.detail.mockHistory")}</h3>
            {stats && stats.mockScoreHistory.length ? (
              <div className="pd-stats-data-scroll">
                <table className="table">
                  <thead><tr><th scope="col">{t("stats.detail.completed")}</th><th scope="col">{t("stats.detail.score")}</th><th scope="col">{t("stats.detail.questions")}</th><th scope="col">{t("stats.detail.result")}</th></tr></thead>
                  <tbody>
                    {stats.mockScoreHistory.slice().reverse().map((m) => (
                      <tr key={m.attemptId}>
                        <td>{formatDate(m.completedAt, model.timeZone)}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(m.score)}%</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{m.totalQuestions}</td>
                        <td>{m.passed == null ? "—" : t(m.passed ? "stats.passed" : "stats.belowLine")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="pd-stats-muted" style={{ margin: 0, fontSize: 13 }}>{stats ? t("stats.detail.noMocks") : statsError ? t("stats.unavailable") : t("common.loading")}</p>}
          </div>
        </div>

        <h3 style={{ marginBottom: 6 }}>{t("stats.detail.activity")}</h3>
        <p className="pd-stats-muted" style={{ margin: "0 0 14px", fontSize: 12 }}>
          {activity
            ? t("stats.detail.activitySummary", {
              days: HEATMAP_DAYS, active: activity.activeDayCount, withDuration: activity.sessionsWithDuration,
              sessions: activity.sessionsCompleted, minutes: Math.round(activity.averageSessionSeconds / 60)
            })
            : activityError ? t("stats.unavailable") : t("common.loading")}
        </p>
        {activity && <><div className="pd-stats-heatmap">
          {heat.map((c) => <span key={c.key} title={c.title} style={{ background: c.bg }} />)}
        </div>
        <div className="pd-stats-muted" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 11 }}>
          <span>{t("stats.heatmap.less")}</span>
          {["var(--color-neutral-200)", "var(--color-accent-2-200)", "var(--color-accent-2-400)", "var(--color-accent-2-600)"].map((bg) => (
            <span key={bg} style={{ width: 12, height: 12, borderRadius: 4, background: bg }} />
          ))}
          <span>{t("stats.heatmap.more")}</span>
        </div></>}
      </details>

      {planOpen && preferences && (
        <Suspense fallback={null}>
          <StudyPlanDialog
            preferences={preferences}
            examName={activeExam?.name ?? null}
            timeZone={model.timeZone}
            onClose={() => setPlanOpen(false)}
            onSave={savePlan}
          />
        </Suspense>
      )}
    </div>
  );
}
