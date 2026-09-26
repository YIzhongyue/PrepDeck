// implementation — the readiness card.
//
// Readiness, coverage and the pass line are three different things and this
// card is where they are most easily confused, so:
//
//   * the ring shows READINESS, and only when computeReadiness() says there is
//     enough evidence for one. Below that floor it shows COVERAGE, says so in
//     its own label, and the copy underneath explains why;
//   * the bar underneath is always coverage, labelled as coverage;
//   * the pass line is drawn as a marker ON the ring, and omitted entirely
//     when the exam has no pass mark.

import { Target04 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { ProgressBarCircle } from "@/components/base/progress-indicators/progress-circles";
import { ProgressBarBase } from "@/components/base/progress-indicators/progress-indicators";
import type { StatisticsModel } from "../../lib/statistics";
import { readinessNarrative } from "../../lib/statistics";

const RING_BOX = 176; // progress-circles "xs": 2 * (72 + 16/2)

/** Positions the pass-line marker on the ring, matching the circle's own
 *  geometry: radius 72, stroke 16, drawn from the top clockwise. */
function PassLineMarker({ passMarkPct }: { passMarkPct: number }) {
  const angle = (Math.min(100, Math.max(0, passMarkPct)) / 100) * 2 * Math.PI - Math.PI / 2;
  const centre = RING_BOX / 2;
  const cx = centre + 72 * Math.cos(angle);
  const cy = centre + 72 * Math.sin(angle);
  return (
    <svg className="pd-stats-ring-overlay" viewBox={`0 0 ${RING_BOX} ${RING_BOX}`} width={RING_BOX} height={RING_BOX} aria-hidden="true" focusable="false">
      <circle cx={cx} cy={cy} r="6" fill="var(--color-bg)" />
      <circle cx={cx} cy={cy} r="4.5" fill="var(--color-accent-2-600)" />
    </svg>
  );
}

export default function ReadinessCard({
  model, examName, onPracticeWeakTags, onStartMock, canStartMock,
}: {
  model: StatisticsModel;
  examName: string | null;
  onPracticeWeakTags: () => void;
  onStartMock: () => void;
  canStartMock: boolean;
}) {
  const { readiness, coverage, passMarkPct } = model;
  const ringValue = readiness.available ? readiness.scorePct : coverage.pct;
  const ringLabel = readiness.available ? "ready" : "covered";
  const ringDescription = readiness.available
    ? `Readiness ${readiness.scorePct}%${passMarkPct == null ? "" : `, against a ${passMarkPct}% pass line`}`
    : `Readiness is not available yet. Bank coverage is ${coverage.pct}%.`;

  return (
    <section className="pd-stats-card" aria-labelledby="pd-stats-readiness-title">
      <div className="pd-stats-metric-head">
        <span className="pd-stats-metric-icon" style={{ background: "var(--color-neutral-200)" }}>
          <Target04 className="size-4" style={{ color: "var(--color-text)" }} aria-hidden="true" />
        </span>
        <span className="pd-stats-kicker">Exam readiness</span>
      </div>

      <div className="pd-stats-readiness">
        <div className="pd-stats-readiness-copy">
          <h2 id="pd-stats-readiness-title">{examName ?? "No exam selected"}</h2>
          <p className="pd-stats-muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
            {readinessNarrative(model, examName)}
          </p>
          {readiness.available && (
            <p className="pd-stats-muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
              Difficulty-weighted method v{readiness.version}, from {readiness.sample.answerEvents} answers
              across {readiness.sample.answeredQuestions} questions. Not a predicted exam score.
            </p>
          )}
        </div>

        {/* The ring itself carries the description (issue #56): a role="img"
            wrapper left the progressbar inside it unnamed. */}
        <div className="pd-stats-ring">
          <ProgressBarCircle
            aria-label={readiness.available ? "Readiness" : "Question bank covered"}
            aria-valuetext={ringDescription}
            size="xs"
            value={ringValue}
            label={ringLabel}
            valueFormatter={(_value, percentage) => `${percentage}%`}
          />
          {/* Only drawn when the ring actually shows readiness AND the exam
              defines a threshold: a marker against coverage would be meaningless. */}
          {readiness.available && passMarkPct != null && <PassLineMarker passMarkPct={passMarkPct} />}
        </div>
      </div>

      <hr className="pd-stats-divider" />

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, fontSize: 13, flexWrap: "wrap" }}>
          <span>Question bank covered</span>
          <span className="pd-stats-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
            {coverage.total > 0 ? `${coverage.seen} / ${coverage.total} · ${coverage.pct}%` : "No questions in this bank yet"}
          </span>
        </div>
        <ProgressBarBase value={coverage.pct} aria-label={`Bank coverage ${coverage.pct} percent`} />
      </div>

      <div className="pd-stats-actions">
        <Button
          size="md"
          onClick={onPracticeWeakTags}
          isDisabled={model.weakTags.length === 0}
          // Disabled is not self-explanatory, so the reason is on the element.
          title={model.weakTags.length === 0
            ? "No tag has both enough answered questions to judge and questions left to practise."
            : `Practises ${model.weakTags.join(", ")}`}
        >
          Practice weak tags
        </Button>
        <Button size="md" color="secondary" onClick={onStartMock} isDisabled={!canStartMock}>
          Start mock exam
        </Button>
      </div>
    </section>
  );
}
