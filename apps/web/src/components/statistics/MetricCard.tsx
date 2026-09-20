// implementation — the shell the four headline metric cards share: an icon in a
// tinted tile, a label, the figure, an optional badge, an optional compact
// visualization and a footer line. Composed from the free Untitled UI badge
// and the icon package rather than depending on a paid metric template.

import type { FC, ReactNode } from "react";

export type MetricTone = "brand" | "success" | "error" | "neutral";

const TONE_FILL: Record<MetricTone, string> = {
  brand: "var(--color-accent-100)",
  success: "var(--color-accent-2-100)",
  error: "var(--color-danger-bg)",
  neutral: "var(--color-neutral-200)",
};

const TONE_INK: Record<MetricTone, string> = {
  brand: "var(--color-accent-700)",
  success: "var(--color-accent-2-700)",
  error: "var(--color-danger-text)",
  neutral: "var(--color-text)",
};

export default function MetricCard({
  icon: Icon, tone = "neutral", label, value, suffix, badge, children, footer, footerTone,
}: {
  icon: FC<{ className?: string; style?: Record<string, string> }>;
  tone?: MetricTone;
  label: string;
  value: ReactNode;
  suffix?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  footerTone?: MetricTone;
}) {
  return (
    <section className="pd-stats-card pd-stats-card--tight">
      <div className="pd-stats-metric-head">
        <span className="pd-stats-metric-icon" style={{ background: TONE_FILL[tone] }}>
          <Icon className="size-4" style={{ color: TONE_INK[tone] }} aria-hidden="true" />
        </span>
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>{label}</h3>
      </div>

      <div className="pd-stats-metric-value">
        <span className="pd-stats-figure">{value}</span>
        {suffix != null && <span className="pd-stats-muted" style={{ fontSize: 14 }}>{suffix}</span>}
        {badge}
      </div>

      {children}

      {footer != null && (
        <p style={{ margin: 0, fontSize: 12, color: footerTone ? TONE_INK[footerTone] : "color-mix(in srgb, var(--color-text) 62%, transparent)" }}>
          {footer}
        </p>
      )}
    </section>
  );
}
