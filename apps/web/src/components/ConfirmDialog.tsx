import { usePrepDeck } from "../store/PrepDeckContext";
import { mockAnsweredCount } from "../lib/mockAnswers";

export default function ConfirmDialog() {
  const { state, cancelSubmit, finishMock } = usePrepDeck();
  if (!state.mConfirm) return null;
  const answered = mockAnsweredCount(state);
  return (
    <div className="dialog-backdrop" style={{ zIndex: 60 }}>
      <div className="dialog">
        <span className="dialog-title">Submit the exam?</span>
        <p className="dialog-body" style={{ margin: 0 }}>
          You have answered {answered} of {state.mQueue.length} questions. Unanswered questions are graded as incorrect.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={cancelSubmit}>Keep working</button>
          <button type="button" className="btn btn-primary" onClick={finishMock}>Submit</button>
        </div>
      </div>
    </div>
  );
}
