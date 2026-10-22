// implementation — the Statistics screen's header: who is looking, what they are
// preparing for, how long is left, and the one action that resumes practice.

import { Calendar, PlayCircle } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import type { CountdownModel } from "../../lib/statistics";
import type { StatisticsResourceStatus } from "../../hooks/useStatisticsResource";
import { formatDate, t, useI18n } from "../../i18n";

function countdownLabel(countdown: CountdownModel): string {
  const date = formatDate(`${countdown.targetDate}T00:00:00Z`, { month: "short", day: "numeric", timeZone: "UTC" });
  if (countdown.daysLeft > 0) return t("stats.countdown.daysLeft", { date, count: countdown.daysLeft });
  if (countdown.daysLeft === 0) return t("stats.countdown.today", { date });
  return t("stats.countdown.passed", { date });
}

export default function StatisticsHeader({
  greetingName, examName, countdown, planStatus, onContinue, onEditPlan, canContinue, hasAnswers = true,
}: {
  greetingName: string | null;
  examName: string | null;
  countdown: CountdownModel | null;
  planStatus: StatisticsResourceStatus;
  onContinue: () => void;
  onEditPlan: () => void;
  canContinue: boolean;
  /** False before the first answer, when there is nothing to "continue". */
  hasAnswers?: boolean;
}) {
  const { t, rich } = useI18n();
  return (
    <header className="pd-stats-header">
      <div style={{ minWidth: 0 }}>
        <h1>{greetingName ? t("stats.header.greeting", { name: greetingName }) : t("stats.header.greetingAnonymous")}</h1>
        <p className="pd-stats-muted" style={{ margin: "6px 0 0", fontSize: 14, overflowWrap: "anywhere" }}>
          {examName
            ? rich("stats.header.tracking", { exam: (chunks) => <strong style={{ fontWeight: 600 }}>{chunks}</strong>, name: examName })
            : t("stats.header.chooseExam")}
        </p>
      </div>

      <div className="pd-stats-header-actions">
        {/* The countdown is only ever shown when the user has supplied a date.
            With none set this is the prompt to set one, never an invented
            date — and it is a real button, so it is reachable by keyboard. */}
        {planStatus !== "ready" ? (
          <Button size="md" color="secondary" isDisabled>
            {t(planStatus === "error" ? "stats.plan.unavailable" : "stats.plan.loading")}
          </Button>
        ) : countdown ? (
          <button
            type="button"
            onClick={onEditPlan}
            style={{ background: "none", border: 0, padding: 0, cursor: "pointer", borderRadius: 999 }}
            aria-label={t("stats.plan.changeLabel", { countdown: countdownLabel(countdown) })}
          >
            <Badge type="pill-color" size="md" color={countdown.passed ? "gray" : "brand"}>
              {countdownLabel(countdown)}
            </Badge>
          </button>
        ) : (
          <Button size="md" color="secondary" iconLeading={Calendar} onClick={onEditPlan}>
            {t("stats.plan.setDate")}
          </Button>
        )}
        <Button size="md" iconLeading={PlayCircle} onClick={onContinue} isDisabled={!canContinue}>
          {t(hasAnswers ? "stats.header.continue" : "stats.header.setUp")}
        </Button>
      </div>
    </header>
  );
}
