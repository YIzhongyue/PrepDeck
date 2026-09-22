import StructuredResponse from "../components/StructuredResponse";
import QuestionContent from "../components/QuestionContent";
import { isMockAnswered, mockAnsweredCount } from "../lib/mockAnswers";
import { questionTypeLabel } from "../lib/questionTypes";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { Breakpoints } from "../lib/responsive";

export default function MockLive({ bp }: { bp: Breakpoints }) {
  const { state, mockQ, mockPick, mockPrev, mockNext, mockGoto, toggleFlag, askSubmit } = usePrepDeck();
  const mq = mockQ();
  if (!mq) return null;

  const mm = Math.floor(state.mLeft / 60);
  const ss = state.mLeft % 60;
  const lowTime = state.mLeft < 120;
  const flagged = state.mFlag[mq.id];
  const rail = !bp.narrow;
  const mockCols = rail ? "minmax(0, 1.75fr) minmax(230px, 1fr)" : "1fr";
  const mSel = state.mSel[mq.id] || [];

  return (
    <div style={{ animation: "pd-rise .22s ease both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "8px 16px", borderRadius: 999, background: lowTime ? "var(--color-accent-700)" : "var(--color-surface)", color: lowTime ? "var(--color-bg)" : "var(--color-text)", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-heading)", fontSize: 19 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round">
            <path d="M12 4a8 8 0 100 16 8 8 0 000-16z" />
            <path d="M12 8v4l3 2" />
          </svg>
          <span>{mm}:{ss < 10 ? "0" : ""}{ss}</span>
        </span>
        <span style={{ fontSize: 13, opacity: 0.7 }}>Answered {mockAnsweredCount(state)} of {state.mQueue.length}</span>
        <button
          type="button" onClick={toggleFlag} className="btn btn-secondary"
          style={{ marginLeft: "auto", padding: "7px 14px", background: flagged ? "var(--color-accent-2-200)" : "transparent", color: flagged ? "var(--color-accent-2-900)" : "var(--color-text)" }}
        >
          {flagged ? "Flagged" : "Flag"}
        </button>
        <button type="button" className="btn btn-primary" onClick={askSubmit} style={{ padding: "7px 16px" }}>Submit</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mockCols, gap: 20, alignItems: "start" }}>
        <div className="card elev-sm" style={{ padding: bp.phone ? 18 : "26px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="tag tag-neutral" style={{ whiteSpace: "nowrap" }}>Question {state.mIdx + 1}</span>
            <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>{questionTypeLabel(mq)}</span>
          </div>
          <div style={{ margin: "14px 0 20px", fontSize: bp.phone ? 15 : 16.5, lineHeight: 1.6 }}><QuestionContent src={mq.stem} content={mq.content} /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {mq.type === "fill_blank" && <label>Your answer<input className="input" value={mSel[0] ?? ""} onChange={e => mockPick(mq, e.target.value)} /></label>}
            {mq.content && (mq.type === "ordering" || mq.type === "matching") && <StructuredResponse content={mq.content} selected={mSel} onChange={answer => mockPick(mq, answer)} />}
            {((mq.type === "ordering" || mq.type === "matching") ? [] : mq.options ?? []).map((o) => {
              const on = mSel.indexOf(o.id) >= 0;
              return (
                <button
                  key={o.id} type="button" onClick={() => mockPick(mq, o.id)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 13, textAlign: "left", width: "100%", padding: "13px 15px",
                    borderRadius: 20, cursor: "pointer", font: "inherit", fontSize: 14.5, lineHeight: 1.5,
                    background: on ? "var(--color-accent-100)" : "var(--color-neutral-100)",
                    border: `1.5px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`, color: "var(--color-text)"
                  }}
                >
                  <span style={{ width: 26, height: 26, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12.5, background: on ? "var(--color-accent)" : "var(--color-neutral-200)", color: on ? "var(--color-bg)" : "var(--color-neutral-800)" }}>{o.id}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><QuestionContent src={o.text} content={mq.content} optionId={o.id} /></div>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button type="button" className="btn btn-secondary" onClick={mockPrev}>Back</button>
            <button type="button" className="btn btn-primary" onClick={mockNext} style={{ marginLeft: "auto" }}>Next</button>
          </div>
        </div>

        <div className="card elev-sm" style={{ padding: 18, gap: 12, position: rail ? "sticky" : "static", top: 18 }}>
          <span className="card-kicker">Question palette</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(38px, 1fr))", gap: 7 }}>
            {state.mQueue.map((id, i) => {
              const answered = isMockAnswered(state, id);
              const flaggedI = state.mFlag[id];
              const cur = i === state.mIdx;
              return (
                <button
                  key={id} type="button" onClick={() => mockGoto(i)}
                  style={{
                    aspectRatio: "1", borderRadius: 13, cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 600,
                    background: answered ? "var(--color-accent)" : flaggedI ? "var(--color-accent-2-300)" : "transparent",
                    color: answered ? "var(--color-bg)" : "var(--color-text)",
                    border: `1.5px solid ${cur ? "var(--color-neutral-900)" : answered ? "var(--color-accent)" : "var(--color-divider)"}`
                  }}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5, marginTop: 4, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: "var(--color-accent)" }} />answered</span>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: "var(--color-accent-2-300)" }} />flagged</span>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 12, height: 12, borderRadius: 4, border: "1.5px solid var(--color-divider)" }} />untouched</span>
          </div>
        </div>
      </div>
    </div>
  );
}
