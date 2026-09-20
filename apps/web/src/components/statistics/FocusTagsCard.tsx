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

function statusBadge(tag: FocusTag) {
  switch (tag.status) {
    case "weakest":
      return <BadgeWithDot type="pill-color" size="sm" color="error">weakest</BadgeWithDot>;
    case "below-line":
      return <BadgeWithDot type="pill-color" size="sm" color="warning">below line</BadgeWithDot>;
    case "on-track":
      return <BadgeWithDot type="pill-color" size="sm" color="success">on track</BadgeWithDot>;
    default:
      return <Badge type="pill-color" size="sm" color="gray">needs {FOCUS_TAG_MIN_ANSWERS} answers</Badge>;
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

function contextLine(tag: FocusTag): string {
  const parts: string[] = [];
  if (tag.wrongCount > 0) parts.push(`${tag.wrongCount} wrong`);
  if (tag.unseenCount > 0) parts.push(`${tag.unseenCount} unseen`);
  if (parts.length === 0) parts.push("nothing left to practise");
  if (tag.difficultyLabel) parts.push(tag.difficultyLabel);
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
  const visible = expanded ? focus : focus.slice(0, FOCUS_PREVIEW_ROWS);

  return (
    <section className="pd-stats-card" aria-labelledby="pd-stats-focus-title">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h3 id="pd-stats-focus-title">Where to focus</h3>
          <p className="pd-stats-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {passMarkPct == null
              ? "Weakest tags first, hard questions weighted"
              : `Weakest tags first, hard questions weighted, against the ${passMarkPct}% pass line`}
          </p>
        </div>
        {focus.length > FOCUS_PREVIEW_ROWS && (
          <Button size="md" color="secondary" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Show top tags" : `View all ${focus.length} tags`}
          </Button>
        )}
      </div>

      {focus.length === 0 ? (
        <p className="pd-stats-muted" style={{ margin: 0, fontSize: 13 }}>
          No tagged questions in this bank yet, so there is nothing to rank.
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
                      ? `${tag.tag}: not enough answers to measure accuracy`
                      : `${tag.tag}: ${accuracy}% accuracy over ${tag.attempted} answers`}
                  >
                    <div className="pd-stats-focus-meter-fill" style={{ width: `${accuracy ?? 0}%`, background: meterColor(tag) }} />
                  </div>
                  <span className="pd-stats-focus-pct">{accuracy == null ? "—" : `${accuracy}%`}</span>
                </div>

                <Button
                  size="md"
                  color="secondary"
                  isDisabled={tag.eligibleCount === 0}
                  title={tag.eligibleCount === 0 ? `Every ${tag.tag} question has been answered and none is in your wrong book.` : undefined}
                  onClick={() => onPracticeTag(tag)}
                >
                  {tag.eligibleCount === 0 ? "All practised" : `Practice ${tag.eligibleCount}`}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
