import { useEffect, useRef } from "react";
import { usePrepDeck } from "../store/PrepDeckContext";
import { mockAnsweredCount } from "../lib/mockAnswers";
import ModalLayer from "./ModalLayer";
import { IC, Icon } from "./study/StudyKit";

export default function ConfirmDialog() {
  const { state } = usePrepDeck();
  return state.mConfirm ? <SubmitConfirmation /> : null;
}

// The last step before an irreversible submission, so it is a real modal
// (ModalLayer): the exam behind it is inert, Tab stays inside, Escape and the
// backdrop mean "Keep going", and focus returns to the control that opened it.
function SubmitConfirmation() {
  const { state, cancelSubmit, finishMock } = usePrepDeck();
  const keepGoing = useRef<HTMLButtonElement>(null);
  // The safe choice has focus when the dialog opens. Runs after ModalLayer's
  // showModal(), whatever the browser's own initial-focus heuristic picked.
  useEffect(() => keepGoing.current?.focus(), []);
  const answered = mockAnsweredCount(state);
  const flagged = state.mQueue.filter((id) => state.mFlag[id]).length;
  return (
    <ModalLayer labelledBy="st-submit-title" describedBy="st-submit-body" onClose={cancelSubmit}>
      <div className="pd-study st-dialog">
        <span className="st-dialog-icon"><Icon d={IC.flag} size={22} /></span>
        <div>
          <div id="st-submit-title" className="st-dialog-title">Submit your exam?</div>
          <p id="st-submit-body" className="st-dialog-body">
            You have answered {answered} of {state.mQueue.length} questions{flagged ? ` and flagged ${flagged}` : ""}.
            {" "}Unanswered questions are graded as incorrect, and you can't change answers after submitting.
          </p>
        </div>
        <div className="st-dialog-actions">
          <button ref={keepGoing} type="button" className="st-btn" onClick={cancelSubmit}>Keep going</button>
          <button type="button" className="st-btn st-btn--primary" onClick={finishMock}>Submit</button>
        </div>
      </div>
    </ModalLayer>
  );
}
