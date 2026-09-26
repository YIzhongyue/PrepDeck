import StructuredResponse from "../components/StructuredResponse";
import QuestionContent from "../components/QuestionContent";
import QuestionContentGate from "../components/QuestionContentGate";
import { IC, Icon, OptionRow, QuestionBadges } from "../components/study/StudyKit";
import { isMockAnswered, mockAnsweredCount } from "../lib/mockAnswers";
import { questionTypeLabel } from "../lib/questionTypes";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { Breakpoints } from "../lib/responsive";

// Under five minutes the timer turns red and pulses.
const LOW_TIME_SECONDS = 5 * 60;

export default function MockLive({ bp }: { bp: Breakpoints }) {
  const { state, mockQ, mockPick, mockPrev, mockNext, mockGoto, toggleFlag, askSubmit } = usePrepDeck();
  const mq = mockQ();
  if (!mq) return null;

  const total = state.mQueue.length;
  const mm = Math.floor(state.mLeft / 60);
  const ss = state.mLeft % 60;
  const lowTime = state.mLeft < LOW_TIME_SECONDS;
  const flagged = !!state.mFlag[mq.id];
  const answered = mockAnsweredCount(state);
  const flaggedCount = state.mQueue.filter((id) => state.mFlag[id]).length;
  const rail = !bp.narrow;
  const mockCols = rail ? "minmax(0, 1fr) minmax(260px, 300px)" : "minmax(0, 1fr)";
  const mSel = state.mSel[mq.id] || [];
  const last = state.mIdx + 1 >= total;
  const structured = mq.type === "ordering" || mq.type === "matching";

  return (
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      <div className="st-card st-mockbar">
        <span className="st-timer" data-low={lowTime} role="timer" aria-label={`${mm} minutes ${ss} seconds left`}>
          <Icon d={IC.timer} size={20} />{mm}:{ss < 10 ? "0" : ""}{ss}
        </span>
        <div className="st-mock-progress">
          <div className="st-mock-progress-row">
            <span>Answered {answered} of {total}</span>
            <span data-low={lowTime}>{lowTime ? "Under 5 minutes left" : "Server clock · answers save as you go"}</span>
          </div>
          <div className="st-bar st-bar--lg" aria-hidden="true"><span style={{ width: `${total ? (answered / total) * 100 : 0}%` }} /></div>
        </div>
        <div className="st-mockbar-actions">
          <button type="button" className={`st-btn${flagged ? " st-btn--flagged" : ""}`} onClick={toggleFlag} aria-pressed={flagged}>
            <Icon d={IC.flag} size={18} fill={flagged ? "currentColor" : "none"} />{flagged ? "Flagged" : "Flag"}
          </button>
          <button type="button" className="st-btn st-btn--primary" onClick={askSubmit}><Icon d={IC.send} />Submit exam</button>
        </div>
      </div>

      <div className="st-grid" style={{ gridTemplateColumns: mockCols, alignItems: "start" }}>
        <section className="st-card st-q" aria-label="Question">
          <div className="st-q-body">
            <QuestionBadges label={`Question ${state.mIdx + 1}`} typeLabel={questionTypeLabel(mq)} multi={mq.type === "multiple_choice"} />
            <QuestionContentGate question={mq}>
              <div className="st-stem"><QuestionContent src={mq.stem} content={mq.content} /></div>
              <div className="st-opts">
                {mq.type === "fill_blank" && (
                  <label className="st-field">Your answer<input className="st-input" value={mSel[0] ?? ""} onChange={e => mockPick(mq, e.target.value)} /></label>
                )}
                {mq.content && structured && <StructuredResponse content={mq.content} selected={mSel} onChange={answer => mockPick(mq, answer)} />}
                {(structured ? [] : mq.options ?? []).map((o) => (
                  <OptionRow key={o.id} id={o.id} state={mSel.includes(o.id) ? "selected" : "idle"} onPick={() => mockPick(mq, o.id)}>
                    <QuestionContent src={o.text} content={mq.content} optionId={o.id} />
                  </OptionRow>
                ))}
              </div>
            </QuestionContentGate>
          </div>
          <div className="st-q-foot">
            <button type="button" className="st-btn" onClick={mockPrev} disabled={state.mIdx === 0}><Icon d={IC.chevLeft} size={18} />Back</button>
            <span className="st-spacer" />
            <button type="button" className="st-btn st-btn--primary" onClick={last ? askSubmit : mockNext}>
              {last ? "Review & submit" : "Next"}<Icon d={IC.chevRight} size={18} />
            </button>
          </div>
        </section>

        <aside className="st-card" aria-label="Question palette" style={{ position: rail ? "sticky" : "static", top: 18 }}>
          <div className="st-card-title">Questions</div>
          <div className="st-trio">
            <div><div className="st-trio-k">Answered</div><div className="st-trio-v">{answered}</div></div>
            <div><div className="st-trio-k">Flagged</div><div className="st-trio-v st-trio-v--warn">{flaggedCount}</div></div>
            <div><div className="st-trio-k">Left</div><div className="st-trio-v">{total - answered}</div></div>
          </div>
          <div className="st-palette">
            {state.mQueue.map((id, i) => {
              const isAnswered = isMockAnswered(state, id);
              const isFlagged = !!state.mFlag[id];
              return (
                <button
                  key={id} type="button" className="st-pal" onClick={() => mockGoto(i)}
                  data-state={isAnswered ? "answered" : isFlagged ? "flagged" : "open"}
                  aria-current={i === state.mIdx ? "true" : undefined}
                  aria-label={`Question ${i + 1}${isAnswered ? ", answered" : ""}${isFlagged ? ", flagged" : ""}`}
                >
                  {i + 1}
                  {isAnswered && isFlagged && <span className="st-pal-dot" />}
                </button>
              );
            })}
          </div>
          <div className="st-legend">
            <span><span className="st-swatch st-swatch--answered" />Answered</span>
            <span><span className="st-swatch st-swatch--flagged" />Flagged</span>
            <span><span className="st-swatch" />Not answered</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
