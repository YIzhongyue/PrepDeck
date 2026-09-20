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
import { formatDuration } from "../../lib/statistics";
import { ChartData, usePrefersReducedMotion } from "./chartSupport";
import type { StatisticsResourceStatus } from "../../hooks/useStatisticsResource";

interface Datum {
  weekday: string;
  date: string;
  minutes: number;
  unavailable: boolean;
  label: string;
}

export default function StudyTimeCard({
  week, weeklyGoalMinutes, planStatus, onEditPlan,
}: {
  week: StudyWeek;
  weeklyGoalMinutes: number | null;
  planStatus: StatisticsResourceStatus;
  onEditPlan: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();

  const data: Datum[] = week.days.map((d) => ({
    weekday: d.weekday,
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
    ? "No completed study sessions this week."
    : `${formatDuration(totalSeconds)} of recorded study time across ${week.sessionsCompleted} session`
      + `${week.sessionsCompleted === 1 ? "" : "s"} this week`
      + (planStatus !== "ready" ? ". Weekly goal unavailable."
        : goalSeconds != null ? `, against a goal of ${formatDuration(goalSeconds)}.` : ", with no weekly goal set.")
      + (week.sessionsMissingDuration > 0 ? ` ${week.sessionsMissingDuration} session(s) did not record a duration.` : "");

  return (
    <section className="pd-stats-card" aria-labelledby="pd-stats-week-title">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h3 id="pd-stats-week-title">Study time</h3>
          <p className="pd-stats-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {goalSeconds != null
              ? `${formatDuration(totalSeconds)} of ${formatDuration(goalSeconds)} weekly goal`
              : `${formatDuration(totalSeconds)} recorded this week`}
          </p>
        </div>
        {planStatus !== "ready"
          ? <span className="pd-stats-muted" role="status">{planStatus === "error" ? "Weekly goal unavailable" : "Loading weekly goal…"}</span>
          : goalPct != null
          ? <Badge type="pill-color" size="md" color={goalPct >= 100 ? "success" : "brand"}>{goalPct}% of goal</Badge>
          : <Button size="sm" color="secondary" onClick={onEditPlan}>Set weekly goal</Button>}
      </div>

      <div className="pd-stats-chart" style={{ height: 200 }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 24, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
            <XAxis dataKey="weekday" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--color-neutral-600)" }} />
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
              <LabelList dataKey="label" position="top" style={{ fontSize: 11, fill: "var(--color-neutral-600)" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <hr className="pd-stats-divider" />

      <p className="pd-stats-muted" style={{ margin: 0, fontSize: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span>{week.sessionsCompleted} session{week.sessionsCompleted === 1 ? "" : "s"}</span>
        <span>{week.averageSessionSeconds == null ? "No session durations recorded" : `${formatDuration(week.averageSessionSeconds)} average`}</span>
        {week.longestDay && <span>Longest {week.longestDay.weekday} · {formatDuration(week.longestDay.durationSeconds)}</span>}
      </p>

      {/* Decision 4: this is time a session was open, which is not the same as
          time spent engaged, and the difference is worth stating once. */}
      <p className="pd-stats-muted" style={{ margin: 0, fontSize: 11 }}>
        Recorded session time, Monday to Sunday in UTC.
        {week.sessionsMissingDuration > 0 && ` ${week.sessionsMissingDuration} session${week.sessionsMissingDuration === 1 ? "" : "s"} recorded no duration and show as “?”.`}
      </p>

      <ChartData
        summary={summary}
        caption="Recorded study time by day this week"
        columns={["Day", "Date (UTC)", "Sessions", "Recorded time"]}
        rows={week.days.map((d) => [d.weekday, d.date, d.sessionsCompleted, formatDuration(d.durationSeconds)])}
      />
    </section>
  );
}
