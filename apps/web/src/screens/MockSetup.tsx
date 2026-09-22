import { MAX_ATTEMPT_QUESTIONS } from "@prepdeck/shared";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { Breakpoints } from "../lib/responsive";

export default function MockSetup({ bp }: { bp: Breakpoints }) {
  const { state, setMockCount, setMockMinutes, beginMock } = usePrepDeck();
  // The API caps an attempt at MAX_ATTEMPT_QUESTIONS, so never offer more
  // than that even for an exam with a larger bank.
  const total = Math.min(state.catalog.length, MAX_ATTEMPT_QUESTIONS);
  const resumable = !!state.activeMockAttempt;

  return (
    <div style={{ maxWidth: 640, animation: "pd-rise .28s ease backwards" }}>
      <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>Mock exam</p>
      <h1 style={{ margin: "0 0 22px", fontSize: 34 }}>Simulate the real thing</h1>
      <div className="card elev-sm" style={{ padding: 22, gap: 18 }}>
        {resumable ? (
          <div style={{ display: "flex", gap: 10, padding: "14px 16px", borderRadius: 20, background: "var(--color-accent-2-100)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-2-700)" strokeWidth="2.75" strokeLinecap="round" style={{ flex: "none", marginTop: 2 }}>
              <path d="M12 4a8 8 0 100 16 8 8 0 000-16z" />
              <path d="M12 8v4l3 2" />
            </svg>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-accent-2-900)" }}>You have an exam already in progress. Pick up where you left off, or start a new one below.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: bp.phone ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 18 }}>
            <div className="field">
              <label>Questions</label>
              <input
                className="input" type="number" min={1} max={Math.max(1, total)} value={state.mockCount}
                onChange={(e) => setMockCount(Math.max(1, Math.min(total || 1, parseInt(e.target.value, 10) || 1)))}
              />
            </div>
            <div className="field">
              <label>Time limit (minutes)</label>
              <input
                className="input" type="number" min={5} max={300} value={state.mockMinutes}
                onChange={(e) => setMockMinutes(Math.max(5, Math.min(300, parseInt(e.target.value, 10) || 5)))}
              />
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, padding: "14px 16px", borderRadius: 20, background: "var(--color-accent-2-100)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-2-700)" strokeWidth="2.75" strokeLinecap="round" style={{ flex: "none", marginTop: 2 }}>
            <path d="M12 4a8 8 0 100 16 8 8 0 000-16z" />
            <path d="M12 8v4l3 2" />
          </svg>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-accent-2-900)" }}>The clock is kept server-side. Answers save as you go, so a dropped connection never costs the attempt.</p>
        </div>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>Random draw, no repeats · no feedback until you submit.</p>
        <button type="button" className="btn btn-primary btn-block" onClick={beginMock} disabled={!resumable && total === 0}>
          {resumable ? "Resume in-progress exam" : "Begin exam"}
        </button>
      </div>
    </div>
  );
}
