import { usePrepDeck } from "../store/PrepDeckContext";
import { mockAnsweredCount } from "../lib/mockAnswers";
import { IC, Icon } from "./study/StudyKit";

export default function ConfirmDialog() {
  const { state, cancelSubmit, finishMock } = usePrepDeck();
  if (!state.mConfirm) return null;
  const answered = mockAnsweredCount(state);
  const flagged = state.mQueue.filter((id) => state.mFlag[id]).length;
  return (
    <div className="dialog-backdrop" style={{ zIndex: 60 }}>
      <div className="pd-study st-dialog" role="dialog" aria-modal="true" aria-labelledby="st-submit-title" aria-describedby="st-submit-body">
        <span className="st-dialog-icon"><Icon d={IC.flag} size={22} /></span>
        <div>
          <div id="st-submit-title" className="st-dialog-title">Submit your exam?</div>
          <p id="st-submit-body" className="st-dialog-body">
            You have answered {answered} of {state.mQueue.length} questions{flagged ? ` and flagged ${flagged}` : ""}.
            {" "}Unanswered questions are graded as incorrect, and you can't change answers after submitting.
          </p>
        </div>
        <div className="st-dialog-actions">
          <button type="button" className="st-btn" onClick={cancelSubmit}>Keep going</button>
          <button type="button" className="st-btn st-btn--primary" onClick={finishMock}>Submit</button>
        </div>
      </div>
    </div>
  );
}
