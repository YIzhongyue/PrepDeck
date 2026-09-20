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
import { MAX_ATTEMPT_QUESTIONS } from "@prepdeck/shared";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ProgressBarBase } from "@/components/base/progress-indicators/progress-indicators";
import { usePrepDeck } from "../store/PrepDeckContext";
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
import "../components/statistics/statistics.css";

// Recharts only arrives with these two cards. Splitting them out keeps the
// readiness card and the metric row painting without waiting for that chunk —
// this screen is the landing screen, so that wait would be the first thing a
// user sees.
const AccuracyTrendCard = lazy(() => import("../components/statistics/AccuracyTrendCard"));
const StudyTimeCard = lazy(() => import("../components/statistics/StudyTimeCard"));
const StudyPlanDialog = lazy(() => import("../components/statistics/StudyPlanDialog"));

const HEATMAP_DAYS = 84; // 12 weeks, matches the 7-row grid below

function DataUnavailable({ title, failed }: { title: string; failed: boolean }) {
  return (
    <section className="pd-stats-card" role="status" aria-label={title}>
      <h3>{title}</h3>
      <p className="pd-stats-muted" style={{ margin: 0 }}>
        {failed ? "Unavailable. Retry to load this data." : "Loading…"}
      </p>
    </section>
  );
}

function ChartPlaceholder({ label }: { label: string }) {
  return (
    <section className="pd-stats-card" style={{ minHeight: 320, justifyContent: "center" }} role="status">
      <p className="pd-stats-muted" style={{ margin: 0, fontSize: 13 }}>Loading {label}…</p>
    </section>
  );
}

function heatColor(questions: number): string {
  if (questions <= 0) return "var(--color-neutral-200)";
  if (questions <= 5) return "var(--color-accent-2-200)";
  if (questions <= 15) return "var(--color-accent-2-400)";
  return "var(--color-accent-2-600)";
}

function heatCells(activity: StudyActivityResponse | null) {
  const byDate = new Map((activity?.days ?? []).map((d) => [d.date, d.questionsAnswered]));
  const cells: { key: number; bg: string; title: string }[] = [];
  const today = new Date();
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const questions = byDate.get(iso) ?? 0;
    cells.push({
      key: i,
      bg: heatColor(questions),
      title: `${iso}: ${questions > 0 ? `${questions} questions` : "no practice"}`
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
  const { state, go, openPracticeWithFilters } = usePrepDeck();

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
  }), [stats, activity, preferences, state.catalog, state.attempted, state.wrong, state.mastered]);

  const model = useMemo(() => buildStatisticsModel(sources), [sources]);

  const savePlan = async (patch: UpdateExamStudyPreferencesRequest) => {
    const examId = state.examId;
    if (!examId || !preferences) throw new Error("Load your study plan before editing it.");
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
      source: "focus", tags, diff: "all",
      count: Math.min(eligible, MAX_ATTEMPT_QUESTIONS),
    });
  }, [sources, openPracticeWithFilters]);

  const practiceTag = useCallback((tag: FocusTag) => practiceTags([tag.tag]), [practiceTags]);

  if (!state.examId) {
    return (
      <div className="pd-stats">
        <section className="pd-stats-card" role="status">
          <h2>No exam selected</h2>
          <p className="pd-stats-muted" style={{ margin: 0, fontSize: 14 }}>
            Choose an exam from the workspace switcher to see your statistics.
          </p>
        </section>
      </div>
    );
  }

  if (!stats && !activity && !preferences && !statsError && !activityError && !preferencesError) {
    return <div className="pd-stats-card" role="status"><p style={{ margin: 0 }}>Loading statistics…</p></div>;
  }

  const failures = [
    statsError && "statistics",
    activityError && "study activity",
    preferencesError && "your study plan",
  ].filter(Boolean) as string[];

  const heat = heatCells(activity);
  const { answered, accuracy, wrongBook, bestMock, coverage } = model;

  return (
    <div className="pd-stats">
      <StatisticsHeader
        greetingName={state.me?.displayName || "there"}
        examName={activeExam?.name ?? null}
        countdown={model.countdown}
        planStatus={preferencesRequest.status}
        canContinue={state.catalog.length > 0}
        onContinue={() => go("practice")}
        onEditPlan={() => setPlanOpen(true)}
      />

      {failures.length > 0 && (
        <div className="pd-stats-card pd-stats-card--tight" role="alert" style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: 13, flex: "1 1 240px" }}>
            Could not load {failures.join(" or ")}. Everything else on this page is unaffected.
          </p>
          <Button size="sm" color="secondary" onClick={() => {
            if (statsError) statsRequest.retry();
            if (activityError) activityRequest.retry();
            if (preferencesError) preferencesRequest.retry();
          }}>Retry</Button>
        </div>
      )}

      <div className="pd-stats-row">
        {stats ? <ReadinessCard
          model={model}
          examName={activeExam?.name ?? null}
          canStartMock={state.catalog.length > 0}
          onPracticeWeakTags={() => practiceTags(model.weakTags)}
          onStartMock={() => go("mock", { newMock: true })}
        /> : <DataUnavailable title="Exam readiness" failed={statsError} />}

        <div className="pd-stats-metrics">
          {stats ? <MetricCard
            icon={CheckDone01} tone="brand" label="Answered"
            value={answered.questions} suffix={`/ ${answered.bankSize}`}
            footer={`+${answered.newThisWeek} new in ${answered.windowDays} days · ${answered.unseen} unseen`}
          >
            <ProgressBarBase value={coverage.pct} aria-label={`${coverage.pct} percent of the bank answered`} />
          </MetricCard> : <DataUnavailable title="Answered" failed={statsError} />}

          {stats ? <MetricCard
            icon={TrendUp02} tone="success" label="Accuracy"
            value={`${accuracy.accuracyPct}%`}
            badge={accuracy.deltaPts != null && (
              <Badge type="pill-color" size="sm" color={accuracy.deltaPts >= 0 ? "success" : "error"}>
                {formatSignedPoints(accuracy.deltaPts)}
              </Badge>
            )}
            footer={accuracy.passMarkPct == null
              ? `${accuracy.answerEvents} answers · no pass mark set`
              : `${accuracy.answerEvents} answers · vs ${accuracy.passMarkPct}% pass line`}
          >
            <Sparkline values={model.trend.points.map((p) => p.accuracyPct)} />
          </MetricCard> : <DataUnavailable title="Accuracy" failed={statsError} />}

          <MetricCard
            icon={AlertTriangle} tone="error" label="Wrong book"
            value={wrongBook.saved} suffix="saved"
            footer={wrongBook.saved === 0
              ? "Nothing saved yet"
              : `${wrongBook.repeated} missed more than once · ${wrongBook.recent} in the last 7 days`}
            footerTone={wrongBook.repeated > 0 ? "error" : undefined}
          >
            {/* Severity, not a schedule: PrepDeck has no review-scheduling
                model, so this deliberately does not claim anything is "due". */}
            {wrongBook.strip.length > 0 && (
              <div className="pd-stats-strip" role="img"
                aria-label={`${wrongBook.saved} unmastered questions, ${wrongBook.repeated} of them missed more than once`}>
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
            icon={Trophy01} tone="success" label="Best mock"
            value={bestMock.best ? `${Math.round(bestMock.best.score)}%` : "—"}
            badge={bestMock.best?.passed != null && (
              <Badge type="pill-color" size="sm" color={bestMock.best.passed ? "success" : "error"}>
                {bestMock.best.passed ? "Passed" : "Below line"}
              </Badge>
            )}
            footer={bestMock.best
              ? `${formatDate(bestMock.best.completedAt)} · ${bestMock.attempts} attempt${bestMock.attempts === 1 ? "" : "s"}`
              : "No mock exams completed yet"}
          >
            {bestMock.recent.length > 0 && (
              <div className="pd-stats-mockbars" role="img"
                aria-label={`Scores of the last ${bestMock.recent.length} mock exams: ${bestMock.recent.map((m) => `${Math.round(m.score)}%`).join(", ")}`}>
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
          </MetricCard> : <DataUnavailable title="Best mock" failed={statsError} />}
        </div>
      </div>

      <div className="pd-stats-row">
        {stats ? <Suspense fallback={<ChartPlaceholder label="the accuracy trend" />}>
          <AccuracyTrendCard trend={model.trend} />
        </Suspense> : <DataUnavailable title="Accuracy trend" failed={statsError} />}
        {activity ? <Suspense fallback={<ChartPlaceholder label="study time" />}>
          <StudyTimeCard week={model.week} weeklyGoalMinutes={model.weeklyGoalMinutes} planStatus={preferencesRequest.status} onEditPlan={() => setPlanOpen(true)} />
        </Suspense> : <DataUnavailable title="Study time" failed={activityError} />}
      </div>

      {stats ? <FocusTagsCard focus={model.focus} passMarkPct={model.passMarkPct} onPracticeTag={practiceTag} />
        : <DataUnavailable title="Where to focus" failed={statsError} />}

      {/* Everything the screen showed before #151 that the concept does not
          have a place for. Kept reachable rather than dropped. */}
      <details className="pd-stats-card pd-stats-detail">
        <summary>More detail: difficulty, mock history and long-range activity</summary>

        <div className="pd-stats-row" style={{ marginBottom: 24 }}>
          <div>
            <h3 style={{ marginBottom: 14 }}>By difficulty</h3>
            {stats && stats.byDifficulty.length ? stats.byDifficulty.map((d) => (
              <div key={d.difficulty} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                  <span style={{ textTransform: "capitalize" }}>{d.difficulty}</span>
                  <span className="pd-stats-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{d.accuracyPct}% ({d.correct}/{d.attempted})</span>
                </div>
                <ProgressBarBase value={d.accuracyPct} aria-label={`${d.difficulty}: ${d.accuracyPct} percent`} />
              </div>
            )) : <p className="pd-stats-muted" style={{ margin: 0, fontSize: 13 }}>{stats ? "No attempts yet." : statsError ? "Unavailable" : "Loading…"}</p>}
          </div>

          <div>
            <h3 style={{ marginBottom: 14 }}>Mock exam history</h3>
            {stats && stats.mockScoreHistory.length ? (
              <div className="pd-stats-data-scroll">
                <table className="table">
                  <thead><tr><th scope="col">Completed</th><th scope="col">Score</th><th scope="col">Questions</th><th scope="col">Result</th></tr></thead>
                  <tbody>
                    {stats.mockScoreHistory.slice().reverse().map((m) => (
                      <tr key={m.attemptId}>
                        <td>{formatDate(m.completedAt)}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(m.score)}%</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{m.totalQuestions}</td>
                        <td>{m.passed == null ? "—" : m.passed ? "Passed" : "Below line"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="pd-stats-muted" style={{ margin: 0, fontSize: 13 }}>{stats ? "No mock exams completed yet." : statsError ? "Unavailable" : "Loading…"}</p>}
          </div>
        </div>

        <h3 style={{ marginBottom: 6 }}>Study activity</h3>
        <p className="pd-stats-muted" style={{ margin: "0 0 14px", fontSize: 12 }}>
          {activity
            ? `Last ${HEATMAP_DAYS} days · ${activity.activeDayCount} active days · `
              + `${activity.sessionsWithDuration} of ${activity.sessionsCompleted} sessions recorded a duration · `
              + `avg session ${Math.round(activity.averageSessionSeconds / 60)} min`
            : activityError ? "Unavailable" : "Loading…"}
        </p>
        {activity && <><div className="pd-stats-heatmap">
          {heat.map((c) => <span key={c.key} title={c.title} style={{ background: c.bg }} />)}
        </div>
        <div className="pd-stats-muted" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 11 }}>
          <span>Less</span>
          {["var(--color-neutral-200)", "var(--color-accent-2-200)", "var(--color-accent-2-400)", "var(--color-accent-2-600)"].map((bg) => (
            <span key={bg} style={{ width: 12, height: 12, borderRadius: 4, background: bg }} />
          ))}
          <span>More</span>
        </div></>}
      </details>

      {planOpen && preferences && (
        <Suspense fallback={null}>
          <StudyPlanDialog
            preferences={preferences}
            examName={activeExam?.name ?? null}
            onClose={() => setPlanOpen(false)}
            onSave={savePlan}
          />
        </Suspense>
      )}
    </div>
  );
}
