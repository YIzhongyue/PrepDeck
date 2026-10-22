// implementation — "Where to focus": the ranked weak tags, and the action that
// opens Practice already filtered to one of them.
//
// Each row's button labels the number of questions that action will actually
// draw from (unseen plus unmastered-wrong, deduplicated), so "Practice 47"
// always means 47 questions. A tag with nothing left to practise gets a
// disabled action with the reason on it, not a button that starts an empty
// session.

import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import type { FocusTag } from "@prepdeck/shared";
import { FOCUS_TAG_MIN_ANSWERS } from "@prepdeck/shared";
import { FOCUS_PREVIEW_ROWS } from "../../lib/statistics";
import { t, useI18n } from "../../i18n";

function statusBadge(tag: FocusTag) {
  switch (tag.status) {
    case "weakest":
      return <BadgeWithDot type="pill-color" size="sm" color="error">{t("stats.focus.status.weakest")}</BadgeWithDot>;
    case "below-line":
      return <BadgeWithDot type="pill-color" size="sm" color="warning">{t("stats.focus.status.belowLine")}</BadgeWithDot>;
    case "on-track":
      return <BadgeWithDot type="pill-color" size="sm" color="success">{t("stats.focus.status.onTrack")}</BadgeWithDot>;
    default:
      return <Badge type="pill-color" size="sm" color="gray">{t("stats.focus.status.notMeasured", { count: FOCUS_TAG_MIN_ANSWERS })}</Badge>;
  }
}

// Status is never carried by color alone: each badge has its own word, and
// the meter below repeats the same three-way split in its fill.
function meterColor(tag: FocusTag): string {
  if (!tag.hasEvidence) return "var(--color-neutral-400)";
  if (tag.status === "weakest") return "var(--color-danger)";
  if (tag.status === "below-line") return "var(--color-warning)";
  return "var(--color-accent-2-600)";
}

// The difficulty mix arrives as a fixed English identifier from @prepdeck/shared.
const MIX_KEYS = {
  "mostly hard": "stats.focus.mix.mostlyHard",
  "medium-heavy": "stats.focus.mix.mediumHeavy",
  "mostly easy": "stats.focus.mix.mostlyEasy",
  mixed: "stats.focus.mix.mixed",
} as const;

function contextLine(tag: FocusTag): string {
  const parts: string[] = [];
  if (tag.wrongCount > 0) parts.push(t("stats.focus.wrong", { count: tag.wrongCount }));
  if (tag.unseenCount > 0) parts.push(t("stats.focus.unseen", { count: tag.unseenCount }));
  if (parts.length === 0) parts.push(t("stats.focus.nothingLeft"));
  if (tag.difficultyLabel) parts.push(tag.difficultyLabel in MIX_KEYS ? t(MIX_KEYS[tag.difficultyLabel as keyof typeof MIX_KEYS]) : tag.difficultyLabel);
  return parts.join(" · ");
}

export default function FocusTagsCard({
  focus, passMarkPct, onPracticeTag,
}: {
  focus: FocusTag[];
  passMarkPct: number | null;
  onPracticeTag: (tag: FocusTag) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();
  const visible = expanded ? focus : focus.slice(0, FOCUS_PREVIEW_ROWS);
  const measured = focus.some((tag) => tag.hasEvidence);

  return (
    <section className="pd-stats-card" aria-labelledby="pd-stats-focus-title">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h3 id="pd-stats-focus-title">{t("stats.focus.title")}</h3>
          <p className="pd-stats-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {/* Nothing is "weakest" until something is measured: say so rather
                than rank by an accuracy nobody has. */}
            {!measured
              ? t("stats.focus.notRanked", { count: FOCUS_TAG_MIN_ANSWERS })
              : passMarkPct == null
              ? t("stats.focus.ranked")
              : t("stats.focus.rankedPass", { pass: passMarkPct })}
          </p>
        </div>
        {focus.length > FOCUS_PREVIEW_ROWS && (
          <Button size="md" color="secondary" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? t("stats.focus.showTop") : t("stats.focus.viewAll", { count: focus.length })}
          </Button>
        )}
      </div>

      {focus.length === 0 ? (
        <p className="pd-stats-muted" style={{ margin: 0, fontSize: 13 }}>
          {t("stats.focus.empty")}
        </p>
      ) : (
        <ul className="pd-stats-focus-list">
          {visible.map((tag) => {
            const accuracy = tag.accuracyPct;
            return (
              <li key={tag.tagId ?? tag.tag} className="pd-stats-focus-row">
                <div style={{ minWidth: 0 }}>
                  <div className="pd-stats-focus-name">
                    <strong style={{ fontSize: 15, fontWeight: 600 }}>{tag.tag}</strong>
                    {statusBadge(tag)}
                  </div>
                  <p className="pd-stats-muted" style={{ margin: "4px 0 0", fontSize: 12 }}>{contextLine(tag)}</p>
                </div>

                <div className="pd-stats-focus-meter">
                  <div
                    className="pd-stats-focus-meter-track"
                    role="img"
                    aria-label={accuracy == null
                      ? t("stats.focus.meterUnmeasured", { tag: tag.tag })
                      : t("stats.focus.meter", { tag: tag.tag, pct: accuracy, count: tag.attempted })}
                  >
                    <div className="pd-stats-focus-meter-fill" style={{ width: `${accuracy ?? 0}%`, background: meterColor(tag) }} />
                  </div>
                  <span className="pd-stats-focus-pct">{accuracy == null ? "—" : `${accuracy}%`}</span>
                </div>

                <Button
                  size="md"
                  color="secondary"
                  isDisabled={tag.eligibleCount === 0}
                  title={tag.eligibleCount === 0 ? t("stats.focus.allPractisedTitle", { tag: tag.tag }) : undefined}
                  onClick={() => onPracticeTag(tag)}
                >
                  {tag.eligibleCount === 0 ? t("stats.focus.allPractised") : t("stats.focus.practice", { count: tag.eligibleCount })}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
