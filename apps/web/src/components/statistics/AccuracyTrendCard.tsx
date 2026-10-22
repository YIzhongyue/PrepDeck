// implementation — accuracy over the latest active days, with the exam's pass
// mark drawn as a threshold line. The chart is Recharts through the vendored
// charts-base tooltip, coloured from PrepDeck variables so it follows the
// scheme the same way every other surface does.
//
// Loaded lazily by the Dashboard: this module is what pulls Recharts in, and
// the cards above it should not wait for that chunk.

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltipContent } from "@/components/application/charts/charts-base";
import type { TrendModel } from "../../lib/statistics";
import { formatDateKey, timeZoneLabel } from "../../lib/statistics";
import { ChartData, usePrefersReducedMotion } from "./chartSupport";
import { useI18n } from "../../i18n";

export default function AccuracyTrendCard({ trend, timeZone }: { trend: TrendModel; timeZone: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const { t } = useI18n();
  const data = trend.points.map((p) => ({ ...p, label: formatDateKey(p.date) }));

  // One active day is a dot, not a line, so the chart still renders something
  // truthful rather than an empty plot area.
  const enough = data.length >= 1;
  const summary = enough
    ? t("stats.trend.summary", {
      count: trend.activeDays, from: data[0]!.accuracyPct, fromDay: data[0]!.label,
      to: data[data.length - 1]!.accuracyPct, toDay: data[data.length - 1]!.label,
    }) + " " + (trend.passMarkPct == null ? t("stats.trend.noPassMark") : t("stats.trend.passLineIs", { pass: trend.passMarkPct }))
    : t("stats.trend.empty");

  return (
    <section className="pd-stats-card" aria-labelledby="pd-stats-trend-title">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 id="pd-stats-trend-title">{t("stats.trend.title")}</h3>
          <p className="pd-stats-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {enough
              ? t("stats.trend.subtitle", { count: trend.activeDays, zone: timeZoneLabel(timeZone) })
              : t("stats.trend.needsAnswer")}
          </p>
        </div>
        <div className="pd-stats-chart-legend pd-stats-muted">
          <span><span className="dot" style={{ background: "var(--color-accent)" }} />{t("stats.accuracy.label")}</span>
          {trend.passMarkPct != null && <span><span className="dot" style={{ background: "var(--color-accent-2-600)" }} />{t("stats.trend.passLine")}</span>}
        </div>
      </div>

      {enough ? (
        <div className="pd-stats-chart" style={{ height: 220 }} aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            {/* Not focusable (issue #56): the chart is aria-hidden, and "Show the numbers" is its text alternative. */}
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} accessibilityLayer={false}>
              <defs>
                <linearGradient id="pd-stats-accuracy-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-divider)" strokeDasharray="3 5" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--color-text-muted)" }} minTickGap={16} />
              {/* The domain always contains the threshold, so a pass line above
                  or below every plotted point is still visible. */}
              <YAxis domain={trend.domain} tickLine={false} axisLine={false} width={44}
                tick={{ fontSize: 11, fill: "var(--color-text-muted)" }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<ChartTooltipContent />} formatter={(value: unknown) => `${value}%`} cursor={{ stroke: "var(--color-divider)" }} />
              {trend.passMarkPct != null && (
                <ReferenceLine y={trend.passMarkPct} stroke="var(--color-accent-2-600)" strokeDasharray="2 4" strokeWidth={2} />
              )}
              <Area
                type="monotone" dataKey="accuracyPct" name={t("stats.accuracy.label")}
                stroke="var(--color-accent)" strokeWidth={2.5}
                fill="url(#pd-stats-accuracy-fill)"
                dot={data.length <= 12 ? { r: 3, fill: "var(--color-bg)", stroke: "var(--color-accent)", strokeWidth: 2 } : false}
                isAnimationActive={!reducedMotion}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="pd-stats-muted" style={{ margin: "28px 0", fontSize: 13 }}>
          {t("stats.trend.completeSession")}
        </p>
      )}

      {enough && trend.latestPct != null && (
        <p style={{ margin: 0, fontSize: 13 }}>
          <strong style={{ fontWeight: 600 }}>{t("stats.trend.latest", { pct: trend.latestPct })}</strong>
          {" — "}{t(trend.passMarkPct == null
            ? "stats.trend.latestNoPass"
            : trend.latestPct >= trend.passMarkPct ? "stats.trend.aboveLine" : "stats.trend.belowLine")}
        </p>
      )}

      <ChartData
        summary={summary}
        caption={t("stats.trend.caption")}
        columns={[t("stats.table.day"), t("stats.table.answers"), t("stats.table.correct"), t("stats.accuracy.label")]}
        rows={data.map((p) => [p.label, p.attempted, p.correct, `${p.accuracyPct}%`])}
      />
    </section>
  );
}
