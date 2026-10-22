import { formatAnswerText, type FormattableQuestion } from "@prepdeck/shared";
import { useI18n } from "../i18n";

export default function AnswerRevisionNotice({ revisedAt, historical = false, gradedAnswers, question }: {
  revisedAt?: string | null; historical?: boolean; gradedAnswers?: string[] | null;
  // Lets a historical matching or ordering key read as text (issue #43). Its IDs
  // may no longer exist in the current content; they are shown as they are then.
  question?: FormattableQuestion;
}) {
  const { t, formatDateTime } = useI18n();
  if (!revisedAt) return null;
  return <div role="note" style={{ fontSize: 12, padding: "8px 10px", borderRadius: 10, background: "var(--color-neutral-100)", margin: "8px 0" }}>
    <strong>{t("study.revision.title")}</strong> · {formatDateTime(revisedAt)}
    {historical && <div>{t("study.revision.historical")}
      {" "}{gradedAnswers ? t("study.revision.gradedKey", { key: question ? formatAnswerText(question, gradedAnswers) : gradedAnswers.join(", ") }) : t("study.revision.legacy")}</div>}
  </div>;
}
