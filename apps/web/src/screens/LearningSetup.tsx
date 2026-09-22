import StudyTagFilter from "../components/StudyTagFilter";
import { useState } from "react";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { Breakpoints } from "../lib/responsive";
import type { Difficulty } from "../types";

const DIFF_OPTS: { id: Difficulty | "all"; label: string }[] = [
  { id: "all", label: "Any" }, { id: "easy", label: "Easy" }, { id: "medium", label: "Medium" }, { id: "hard", label: "Hard" }
];

function segBg(on: boolean) { return on ? "var(--color-accent)" : "transparent"; }
function segFg(on: boolean) { return on ? "var(--color-bg)" : "var(--color-text)"; }
function segBd(on: boolean) { return on ? "var(--color-accent)" : "var(--color-divider)"; }

// FR-14.1/FR-14.2/FR-14.9 — choose a starting question sequence number
// (optionally resuming last position), and optional tag/difficulty filters,
// then walk the exam's questions in order with the answer already revealed.
export default function LearningSetup({ bp }: { bp: Breakpoints }) {
  const { state, learningPool, setLearningStartInput, toggleLearningTag, setLearningDiff, beginLearning } = usePrepDeck();
  const [startText, setStartText] = useState(String(state.lStartInput));
  const pool = learningPool();
  const maxSeq = pool.length ? pool[pool.length - 1]!.sequenceNumber : 0;

  const commitStart = (raw: string) => {
    const n = Math.max(1, parseInt(raw, 10) || 1);
    setStartText(String(n));
    setLearningStartInput(n);
  };

  return (
    <div style={{ maxWidth: 720, animation: "pd-rise .28s ease backwards" }}>
      <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>Learning mode</p>
      <h1 style={{ margin: "0 0 22px", fontSize: 34 }}>Work through the bank in order</h1>

      <div className="card elev-sm" style={{ padding: 22, gap: 20 }}>
        {state.lResume != null && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 16, background: "var(--color-accent-100)", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, flex: 1 }}>You left off at question <strong>#{state.lResume}</strong>.</span>
            <button type="button" className="btn btn-primary" style={{ padding: "6px 14px" }} onClick={() => beginLearning(state.lResume!)}>
              Resume
            </button>
          </div>
        )}

        <div>
          <span style={{ display: "block", fontSize: 12, color: "color-mix(in srgb, var(--color-text) 70%, transparent)", marginBottom: 8 }}>
            Start from question #{maxSeq ? ` (1–${maxSeq})` : ""}
          </span>
          <input
            type="number" min={1} max={maxSeq || undefined} className="input" value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={(e) => commitStart(e.target.value)}
            style={{ width: 140 }}
          />
        </div>

        <StudyTagFilter questions={state.catalog} selected={state.lTags} onToggle={toggleLearningTag} />

        <div>
          <span style={{ display: "block", fontSize: 12, color: "color-mix(in srgb, var(--color-text) 70%, transparent)", marginBottom: 8 }}>Difficulty</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {DIFF_OPTS.map((o) => {
              const on = state.lDiff === o.id;
              return (
                <button
                  key={o.id} type="button" onClick={() => setLearningDiff(o.id)}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "7px 15px",
                    borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 13, whiteSpace: "nowrap",
                    background: segBg(on), color: segFg(on), border: `1.5px solid ${segBd(on)}`
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", paddingTop: 4, borderTop: "1px solid var(--color-divider)" }}>
          <span style={{ fontSize: 12, opacity: 0.7, marginRight: "auto" }}>{pool.length} questions match these filters</span>
          <button type="button" className="btn btn-primary" disabled={!pool.length} onClick={() => beginLearning()}>Start learning</button>
        </div>
      </div>

      <p style={{ margin: "16px 4px 0", fontSize: 12, opacity: 0.6 }}>
        Every question shows its correct answer, your own answer history, explanations and notes right away — nothing is graded, and nothing is added to the wrong question book.
      </p>
    </div>
  );
}
