import { useEffect, useRef } from "react";
import { useCatalogState, useMockExamActions, useMockExamState } from "../store/PrepDeckContext";
import { mockAnsweredCount } from "../lib/mockAnswers";
import ModalLayer from "./ModalLayer";
import { IC, Icon } from "./study/StudyKit";
import { useI18n } from "../i18n";

export default function ConfirmDialog() {
  const { mConfirm } = useMockExamState();
  return mConfirm ? <SubmitConfirmation /> : null;
}

// The last step before an irreversible submission, so it is a real modal
// (ModalLayer): the exam behind it is inert, Tab stays inside, Escape and the
// backdrop mean "Keep going", and focus returns to the control that opened it.
function SubmitConfirmation() {
  const { mQueue, mSel, mFlag } = useMockExamState();
  const { catalogBy } = useCatalogState();
  const { cancelSubmit, finishMock } = useMockExamActions();
  const { t } = useI18n();
  const keepGoing = useRef<HTMLButtonElement>(null);
  // The safe choice has focus when the dialog opens. Runs after ModalLayer's
  // showModal(), whatever the browser's own initial-focus heuristic picked.
  useEffect(() => keepGoing.current?.focus(), []);
  const answered = mockAnsweredCount({ mQueue, mSel, catalogBy });
  const flagged = mQueue.filter((id) => mFlag[id]).length;
  return (
    <ModalLayer labelledBy="st-submit-title" describedBy="st-submit-body" onClose={cancelSubmit}>
      <div className="pd-study st-dialog">
        <span className="st-dialog-icon"><Icon d={IC.flag} size={22} /></span>
        <div>
          <div id="st-submit-title" className="st-dialog-title">{t("mock.submit.title")}</div>
          <p id="st-submit-body" className="st-dialog-body">
            {flagged
              ? t("mock.submit.answeredFlagged", { answered, total: mQueue.length, flagged })
              : t("mock.submit.answered", { answered, count: mQueue.length })}
            {" "}{t("mock.submit.warning")}
          </p>
        </div>
        <div className="st-dialog-actions">
          <button ref={keepGoing} type="button" className="st-btn" onClick={cancelSubmit}>{t("mock.submit.keepGoing")}</button>
          <button type="button" className="st-btn st-btn--primary" onClick={finishMock}>{t("mock.submit.submit")}</button>
        </div>
      </div>
    </ModalLayer>
  );
}
