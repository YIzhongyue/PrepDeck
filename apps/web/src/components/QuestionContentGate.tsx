import { useEffect, type ReactNode } from "react";
import { useCatalogActions, useCatalogState, useLearningState, useWorkspaceActions } from "../store/PrepDeckContext";
import type { Question } from "../types";
import { useI18n } from "../i18n";

// Leave the surrounding timer, palette and navigation available while only
// the opened question's component snapshot is being fetched.
export default function QuestionContentGate({ question, learning = false, children }: {
  question: Question; learning?: boolean; children: ReactNode;
}) {
  const { lDetail } = useLearningState();
  const { questionContent } = useCatalogState();
  const { loadQuestionContent, loadLearningDetail } = useCatalogActions();
  const { retryWorkspace } = useWorkspaceActions();
  const { t } = useI18n();
  const status = learning ? lDetail[question.id] : questionContent[question.id];

  const pending = !!question.hasContent && !question.content;
  useEffect(() => {
    if (status) return;
    if (learning) loadLearningDetail(question.id);
    else if (pending) loadQuestionContent(question.id);
  }, [question, pending, learning, status, loadQuestionContent, loadLearningDetail]);

  if (!pending) return <>{children}</>;
  const failed = status?.status === "error";
  return <div role={failed ? "alert" : "status"} style={{ paddingBlock: 20 }}>
    <p>{failed ? status.error ?? t("study.gate.loadFailed") : t("study.gate.loading")}</p>
    {failed && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <button type="button" className="btn btn-primary" onClick={() => learning ? loadLearningDetail(question.id) : loadQuestionContent(question.id)}>{t("study.gate.retry")}</button>
      <button type="button" className="btn btn-secondary" onClick={retryWorkspace}>{t("study.gate.refresh")}</button>
    </div>}
  </div>;
}
