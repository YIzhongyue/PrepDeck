// implementation — the Statistics screen's header: who is looking, what they are
// preparing for, how long is left, and the one action that resumes practice.

import { Calendar, PlayCircle } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import type { CountdownModel } from "../../lib/statistics";
import type { StatisticsResourceStatus } from "../../hooks/useStatisticsResource";

function countdownLabel(countdown: CountdownModel): string {
  const date = new Date(`${countdown.targetDate}T00:00:00Z`)
    .toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  if (countdown.daysLeft > 0) return `Exam ${date} · ${countdown.daysLeft} day${countdown.daysLeft === 1 ? "" : "s"} left`;
  if (countdown.daysLeft === 0) return `Exam ${date} · today`;
  return `Exam ${date} · passed`;
}

export default function StatisticsHeader({
  greetingName, examName, countdown, planStatus, onContinue, onEditPlan, canContinue,
}: {
  greetingName: string;
  examName: string | null;
  countdown: CountdownModel | null;
  planStatus: StatisticsResourceStatus;
  onContinue: () => void;
  onEditPlan: () => void;
  canContinue: boolean;
}) {
  return (
    <header className="pd-stats-header">
      <div style={{ minWidth: 0 }}>
        <h1>Good to see you, {greetingName}</h1>
        <p className="pd-stats-muted" style={{ margin: "6px 0 0", fontSize: 14, overflowWrap: "anywhere" }}>
          {examName
            ? <>Here&apos;s how your <strong style={{ fontWeight: 600 }}>{examName}</strong> prep is tracking today.</>
            : "Choose an exam to see how your preparation is tracking."}
        </p>
      </div>

      <div className="pd-stats-header-actions">
        {/* The countdown is only ever shown when the user has supplied a date.
            With none set this is the prompt to set one, never an invented
            date — and it is a real button, so it is reachable by keyboard. */}
        {planStatus !== "ready" ? (
          <Button size="md" color="secondary" isDisabled>
            {planStatus === "error" ? "Study plan unavailable" : "Loading study plan…"}
          </Button>
        ) : countdown ? (
          <button
            type="button"
            onClick={onEditPlan}
            style={{ background: "none", border: 0, padding: 0, cursor: "pointer", borderRadius: 999 }}
            aria-label={`${countdownLabel(countdown)}. Change your study plan.`}
          >
            <Badge type="pill-color" size="md" color={countdown.passed ? "gray" : "brand"}>
              {countdownLabel(countdown)}
            </Badge>
          </button>
        ) : (
          <Button size="md" color="secondary" iconLeading={Calendar} onClick={onEditPlan}>
            Set exam date
          </Button>
        )}
        <Button size="md" iconLeading={PlayCircle} onClick={onContinue} isDisabled={!canContinue}>
          Continue practice
        </Button>
      </div>
    </header>
  );
}
