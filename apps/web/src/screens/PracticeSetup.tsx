import StudyTagFilter from "../components/StudyTagFilter";
import { reviewIds } from "../lib/reviewLists";
import { needsFocusedPractice } from "../lib/practiceEligibility";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { Breakpoints } from "../lib/responsive";
import type { Difficulty } from "../types";

const SOURCE_OPTS = [
  { id: "all", label: "All" },
  { id: "new", label: "Unattempted" },
  { id: "focus", label: "Unattempted + wrong" },
  { id: "wrong", label: "Wrong book" },
  { id: "bm", label: "Bookmarked" }
] as const;

const DIFF_OPTS: { id: Difficulty | "all"; label: string }[] = [
  { id: "all", label: "Any" }, { id: "easy", label: "Easy" }, { id: "medium", label: "Medium" }, { id: "hard", label: "Hard" }
];

const FB_OPTS = [
  { id: "immediate", label: "Per question" }, { id: "end", label: "At the end" }
] as const;

function segBg(on: boolean) { return on ? "var(--color-accent)" : "transparent"; }
function segFg(on: boolean) { return on ? "var(--color-bg)" : "var(--color-text)"; }
function segBd(on: boolean) { return on ? "var(--color-accent)" : "var(--color-divider)"; }

export default function PracticeSetup({ bp }: { bp: Breakpoints }) {
  const { state, setSource, setDiff, setFeedback, toggleTag, setCount, startPractice, pool } = usePrepDeck();
  const wrongCount = reviewIds(state, "wrong").length;
  const bmCount = reviewIds(state, "bm").length;
  const attemptedCount = Object.keys(state.attempted).length;
  const sourceCounts: Record<string, number> = {
    all: state.catalog.length,
    new: state.catalog.length - attemptedCount,
    wrong: wrongCount,
    focus: state.catalog.filter(q => needsFocusedPractice(q.id, state)).length,
    bm: bmCount
  };

  return (
    <div style={{ maxWidth: 720, animation: "pd-rise .28s ease both" }}>
      <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>Free practice</p>
      <h1 style={{ margin: "0 0 22px", fontSize: 34 }}>Build a session</h1>

      <div className="card elev-sm" style={{ padding: 22, gap: 20 }}>
        <div>
          <span style={{ display: "block", fontSize: 12, color: "color-mix(in srgb, var(--color-text) 70%, transparent)", marginBottom: 8 }}>Draw from</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SOURCE_OPTS.map((o) => {
              const on = state.source === o.id;
              return (
                <button
                  key={o.id} type="button" onClick={() => setSource(o.id)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 15px", borderRadius: 999,
                    cursor: "pointer", font: "inherit", fontSize: 13, whiteSpace: "nowrap",
                    background: on ? "var(--color-accent-200)" : "transparent",
                    color: on ? "var(--color-accent-800)" : "var(--color-text)",
                    border: `1.5px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`
                  }}
                >
                  <span>{o.label}</span>
                  <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{sourceCounts[o.id]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <StudyTagFilter questions={state.catalog} selected={state.tags} onToggle={toggleTag} />

        <div style={{ display: "grid", gridTemplateColumns: bp.phone ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 18 }}>
          <div>
            <span style={{ display: "block", fontSize: 12, color: "color-mix(in srgb, var(--color-text) 70%, transparent)", marginBottom: 8 }}>Difficulty</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {DIFF_OPTS.map((o) => {
                const on = state.diff === o.id;
                return (
                  <button
                    key={o.id} type="button" onClick={() => setDiff(o.id)}
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
          <div>
            <span style={{ display: "block", fontSize: 12, color: "color-mix(in srgb, var(--color-text) 70%, transparent)", marginBottom: 8 }}>Feedback</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {FB_OPTS.map((o) => {
                const on = state.feedback === o.id;
                return (
                  <button
                    key={o.id} type="button" onClick={() => setFeedback(o.id)}
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
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 70%, transparent)" }}>Questions</span>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 20 }}>{state.count}</span>
          </div>
          <input
            type="range" min={5} max={40} step={5} value={state.count}
            onChange={(e) => setCount(parseInt(e.target.value, 10))}
            style={{ width: "100%", accentColor: "var(--color-accent)" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", paddingTop: 4, borderTop: "1px solid var(--color-divider)" }}>
          <span style={{ fontSize: 12, opacity: 0.7, marginRight: "auto" }}>{pool().length} questions match these filters</span>
          <button type="button" className="btn btn-primary" onClick={startPractice}>Start session</button>
        </div>
      </div>

      <p style={{ margin: "16px 4px 0", fontSize: 12, opacity: 0.6 }}>Annotations and notes stay hidden while you answer — they reappear the moment a question is graded.</p>
    </div>
  );
}
