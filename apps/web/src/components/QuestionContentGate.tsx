import { useEffect, type ReactNode } from "react";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { Question } from "../types";

// Leave the surrounding timer, palette and navigation available while only
// the opened question's component snapshot is being fetched.
export default function QuestionContentGate({ question, learning = false, children }: {
  question: Question; learning?: boolean; children: ReactNode;
}) {
  const { state, loadQuestionContent, loadLearningDetail, retryWorkspace } = usePrepDeck();
  const status = learning ? state.lDetail[question.id] : state.questionContent[question.id];
  const pending = !!question.hasContent && !question.content;
  useEffect(() => {
    if (status) return;
    if (learning) loadLearningDetail(question.id);
    else if (pending) loadQuestionContent(question.id);
  }, [question, pending, learning, status, loadQuestionContent, loadLearningDetail]);

  if (!pending) return <>{children}</>;
  const failed = status?.status === "error";
  return <div role={failed ? "alert" : "status"} style={{ paddingBlock: 20 }}>
    <p>{failed ? status.error ?? "Could not load this question. Please retry." : "Loading question…"}</p>
    {failed && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <button type="button" className="btn btn-primary" onClick={() => learning ? loadLearningDetail(question.id) : loadQuestionContent(question.id)}>Retry question</button>
      <button type="button" className="btn btn-secondary" onClick={retryWorkspace}>Refresh exam</button>
    </div>}
  </div>;
}
