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

export default function StudyPlanDialog({
  preferences, examName, onClose, onSave,
}: {
  preferences: ExamStudyPreferencesResponse;
  examName: string | null;
  onClose: () => void;
  onSave: (patch: UpdateExamStudyPreferencesRequest) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
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
      setError(e instanceof Error ? e.message : "Could not save your study plan. Please try again.");
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
        <span className="dialog-title" id="pd-stats-plan-title">Study plan</span>
        <p className="dialog-body" style={{ margin: 0 }}>
          {examName ? `For ${examName}.` : "For the active exam."} Both are optional — clear a field to remove it.
        </p>

        <div className="pd-stats-plan-fields">
          <DateField
            label="Exam date"
            value={date}
            onChange={value => { setDate(value); setDateEdited(true); }}
            isInvalid={dateInvalid}
            hint={dateInvalid ? "Enter a real calendar date." : "Counted down in whole days (UTC)."}
          />
          <Input
            label="Weekly study goal (hours)"
            type="number"
            inputMode="decimal"
            value={hours}
            onChange={value => { setHours(value); setGoalEdited(true); }}
            isInvalid={goalInvalid}
            hint={goalInvalid
              ? `Enter between ${WEEKLY_GOAL_MIN_MINUTES / 60} and ${WEEKLY_GOAL_MAX_MINUTES / 60} hours.`
              : "Measured against recorded session time, Monday to Sunday."}
          />
        </div>

        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger-text)" }}>{error}</p>}

        <div className="dialog-actions">
          <Button size="md" color="secondary" onClick={onClose} isDisabled={busy}>Cancel</Button>
          <Button size="md" onClick={save} isDisabled={busy || dateInvalid || goalInvalid} isLoading={busy} showTextWhileLoading>
            Save
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
