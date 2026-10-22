// implementation — where the exam date and the weekly study goal are set.
//
// Both are optional and both are clearable: an empty field saves `null`, which
// puts the header and the Study time card back to their "set one" prompts
// rather than to an invented value.

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExamStudyPreferencesResponse, UpdateExamStudyPreferencesRequest } from "@prepdeck/shared";
import { isValidTargetDate, WEEKLY_GOAL_MAX_MINUTES, WEEKLY_GOAL_MIN_MINUTES } from "@prepdeck/shared";
import { Button } from "@/components/base/buttons/button";
import { DateField } from "@/components/base/date-picker/date-field";
import { Input } from "@/components/base/input/input";
import { useDialogFocus } from "../knowledgePoints/useDialogFocus";
import { timeZoneLabel } from "../../lib/statistics";
import { useI18n } from "../../i18n";

export default function StudyPlanDialog({
  preferences, examName, timeZone, onClose, onSave,
}: {
  preferences: ExamStudyPreferencesResponse;
  examName: string | null;
  timeZone: string;
  onClose: () => void;
  onSave: (patch: UpdateExamStudyPreferencesRequest) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useDialogFocus(dialogRef, onClose);

  const [date, setDate] = useState(preferences.targetDate ?? "");
  const [hours, setHours] = useState(
    preferences.weeklyGoalMinutes != null ? String(preferences.weeklyGoalMinutes / 60) : "",
  );
  const [dateEdited, setDateEdited] = useState(false);
  const [goalEdited, setGoalEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedDate = date.trim();
  const trimmedHours = hours.trim();
  const parsedHours = trimmedHours === "" ? null : Number(trimmedHours);
  const dateInvalid = trimmedDate !== "" && !isValidTargetDate(trimmedDate);
  const goalMinutes = parsedHours == null ? null : Math.round(parsedHours * 60);
  const goalInvalid = parsedHours != null
    && (!Number.isFinite(parsedHours) || goalMinutes! < WEEKLY_GOAL_MIN_MINUTES || goalMinutes! > WEEKLY_GOAL_MAX_MINUTES);

  const save = async () => {
    if (dateInvalid || goalInvalid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const patch: UpdateExamStudyPreferencesRequest = {};
      if (dateEdited) patch.targetDate = trimmedDate === "" ? null : trimmedDate;
      if (goalEdited) patch.weeklyGoalMinutes = goalMinutes;
      if (dateEdited || goalEdited) await onSave(patch);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("stats.plan.saveFailed"));
      setBusy(false);
    }
  };

  // Portalled to the document: `.dialog-backdrop` is `position: fixed`, and the
  // Statistics screen this dialog is opened from carries an entrance animation
  // on `transform`, which makes it the containing block for fixed descendants.
  // Rendered in place, the backdrop covered only the content column.
  return createPortal(
    <div className="dialog-backdrop" style={{ zIndex: 60 }}>
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="pd-stats-plan-title" tabIndex={-1}>
        <span className="dialog-title" id="pd-stats-plan-title">{t("stats.plan.title")}</span>
        <p className="dialog-body" style={{ margin: 0 }}>
          {examName ? t("stats.plan.forExam", { exam: examName }) : t("stats.plan.forActive")} {t("stats.plan.optional")}
        </p>

        <div className="pd-stats-plan-fields">
          <DateField
            label={t("stats.plan.examDate")}
            value={date}
            onChange={value => { setDate(value); setDateEdited(true); }}
            isInvalid={dateInvalid}
            hint={dateInvalid ? t("stats.plan.invalidDate") : t("stats.plan.countdownHint", { zone: timeZoneLabel(timeZone) })}
          />
          <Input
            label={t("stats.plan.weeklyGoal")}
            type="number"
            inputMode="decimal"
            value={hours}
            onChange={value => { setHours(value); setGoalEdited(true); }}
            isInvalid={goalInvalid}
            hint={goalInvalid
              ? t("stats.plan.goalRange", { min: WEEKLY_GOAL_MIN_MINUTES / 60, max: WEEKLY_GOAL_MAX_MINUTES / 60 })
              : t("stats.plan.goalHint")}
          />
        </div>

        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger-text)" }}>{error}</p>}

        <div className="dialog-actions">
          <Button size="md" color="secondary" onClick={onClose} isDisabled={busy}>{t("common.cancel")}</Button>
          <Button size="md" onClick={save} isDisabled={busy || dateInvalid || goalInvalid} isLoading={busy} showTextWhileLoading>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
