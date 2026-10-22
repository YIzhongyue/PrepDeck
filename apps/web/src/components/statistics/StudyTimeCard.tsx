// implementation — this week's recorded study time against the user's own weekly
// goal.
//
// Three states that a naive bar chart collapses into one are kept apart here:
// a day with no sessions (a zero bar and an em dash), a day with sessions but
// no recorded duration (a flat hatch-toned bar and a "?"), and a real
// duration. Every figure in the footer is derived from the same seven days as
// the bars, so the total, the goal percentage and the average can never
// disagree with what is drawn.

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { StudyWeek } from "@prepdeck/shared";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { formatDuration, timeZoneLabel } from "../../lib/statistics";
import { ChartData, usePrefersReducedMotion } from "./chartSupport";
import type { StatisticsResourceStatus } from "../../hooks/useStatisticsResource";
import { formatDate, useI18n } from "../../i18n";

// The week arrives with English weekday abbreviations; the day is named from
// its date in the interface language instead.
const weekdayOf = (date: string) => formatDate(`${date}T00:00:00Z`, { weekday: "short", timeZone: "UTC" });

interface Datum {
  weekday: string;
  date: string;
  minutes: number;
  unavailable: boolean;
  label: string;
}

export default function StudyTimeCard({
  week, timeZone, weeklyGoalMinutes, planStatus, onEditPlan,
}: {
  week: StudyWeek;
  timeZone: string;
  weeklyGoalMinutes: number | null;
  planStatus: StatisticsResourceStatus;
  onEditPlan: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const { t } = useI18n();

  const data: Datum[] = week.days.map((d) => ({
    weekday: weekdayOf(d.date),
    date: d.date,
    minutes: d.durationSeconds == null ? 0 : Math.round(d.durationSeconds / 60),
    unavailable: d.durationSeconds == null,
    label: formatDuration(d.durationSeconds),
  }));

  const totalSeconds = week.totalDurationSeconds;
  const goalSeconds = weeklyGoalMinutes != null ? weeklyGoalMinutes * 60 : null;
  const goalPct = goalSeconds != null && goalSeconds > 0 && totalSeconds != null
    ? Math.round((totalSeconds / goalSeconds) * 100)
    : null;

  const peak = Math.max(1, ...data.map((d) => d.minutes));

  const summary = week.sessionsCompleted === 0
    ? t("stats.studyTime.summaryEmpty")
    : [
      t("stats.studyTime.summary", { time: formatDuration(totalSeconds), count: week.sessionsCompleted }),
      planStatus !== "ready" ? t("stats.studyTime.summaryGoalUnavailable")
        : goalSeconds != null ? t("stats.studyTime.summaryGoal", { goal: formatDuration(goalSeconds) }) : t("stats.studyTime.summaryNoGoal"),
      week.sessionsMissingDuration > 0 ? t("stats.studyTime.summaryMissing", { count: week.sessionsMissingDuration }) : "",
    ].filter(Boolean).join(" ");

  return (
    <section className="pd-stats-card" aria-labelledby="pd-stats-week-title">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h3 id="pd-stats-week-title">{t("stats.studyTime.title")}</h3>
          <p className="pd-stats-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {goalSeconds != null
              ? t("stats.studyTime.ofGoal", { time: formatDuration(totalSeconds), goal: formatDuration(goalSeconds) })
              : t("stats.studyTime.recorded", { time: formatDuration(totalSeconds) })}
          </p>
        </div>
        {planStatus !== "ready"
          ? <span className="pd-stats-muted" role="status">{t(planStatus === "error" ? "stats.studyTime.goalUnavailable" : "stats.studyTime.goalLoading")}</span>
          : goalPct != null
          ? <Badge type="pill-color" size="md" color={goalPct >= 100 ? "success" : "brand"}>{t("stats.studyTime.goalPct", { pct: goalPct })}</Badge>
          : <Button size="sm" color="secondary" onClick={onEditPlan}>{t("stats.studyTime.setGoal")}</Button>}
      </div>

      <div className="pd-stats-chart" style={{ height: 200 }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          {/* Not focusable (issue #56): the chart is aria-hidden, and "Show the numbers" is its text alternative. */}
          <BarChart data={data} margin={{ top: 24, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%" accessibilityLayer={false}>
            <XAxis dataKey="weekday" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} />
            <YAxis hide domain={[0, peak]} />
            <Bar dataKey="minutes" radius={[6, 6, 6, 6]} minPointSize={3} isAnimationActive={!reducedMotion}>
              {data.map((d) => (
                <Cell
                  key={d.date}
                  fill={d.unavailable
                    ? "var(--color-neutral-400)"
                    : d.minutes >= peak * 0.6 ? "var(--color-accent)" : "var(--color-accent-400)"}
                />
              ))}
              <LabelList dataKey="label" position="top" style={{ fontSize: 11, fill: "var(--color-text-muted)" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <hr className="pd-stats-divider" />

      <p className="pd-stats-muted" style={{ margin: 0, fontSize: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span>{t("stats.studyTime.sessions", { count: week.sessionsCompleted })}</span>
        <span>{week.averageSessionSeconds == null ? t("stats.studyTime.noDurations") : t("stats.studyTime.average", { time: formatDuration(week.averageSessionSeconds) })}</span>
        {week.longestDay && <span>{t("stats.studyTime.longest", { day: weekdayOf(week.longestDay.date), time: formatDuration(week.longestDay.durationSeconds) })}</span>}
      </p>

      {/* Decision 4: this is time a session was open, which is not the same as
          time spent engaged, and the difference is worth stating once. */}
      <p className="pd-stats-muted" style={{ margin: 0, fontSize: 11 }}>
        {t("stats.studyTime.footnote", { zone: timeZoneLabel(timeZone) })}
        {week.sessionsMissingDuration > 0 && ` ${t("stats.studyTime.footnoteMissing", { count: week.sessionsMissingDuration })}`}
      </p>

      <ChartData
        summary={summary}
        caption={t("stats.studyTime.caption")}
        columns={[t("stats.table.day"), t("stats.table.date"), t("stats.table.sessions"), t("stats.table.recordedTime")]}
        rows={week.days.map((d) => [weekdayOf(d.date), d.date, d.sessionsCompleted, formatDuration(d.durationSeconds)])}
      />
    </section>
  );
}
