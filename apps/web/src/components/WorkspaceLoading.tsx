/** Mascot loader shown across the viewport while an exam's data is
 * fetched. Fills the viewport-height flex parent in App.tsx so the scene
 * centers without content-column padding or navigation taking up space.
 * Purely decorative — the sr-only text
 * carries the accessible status. */
export default function WorkspaceLoading() {
  return (
    <div role="status" style={{ position: "relative", flex: 1, minHeight: 280, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26, overflow: "hidden" }}>
      <span className="sr-only">Loading this exam…</span>
      <div aria-hidden="true" data-pd-geo style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-16%", right: "-18%", width: "min(70%, 440px)", aspectRatio: "1 / 1", animation: "pd-orbit 64s linear infinite" }}>
          <svg viewBox="0 0 420 420" width="100%" height="100%">
            <circle cx={210} cy={210} r={205} fill="none" stroke="var(--color-accent-300)" strokeWidth={1.5} opacity={0.55} />
            <circle cx={210} cy={210} r={148} fill="none" stroke="var(--color-accent-2-400)" strokeWidth={1.5} opacity={0.5} strokeDasharray="10 14" />
          </svg>
        </div>
        <div style={{ position: "absolute", left: "-14%", bottom: "-16%", width: "min(65%, 420px)", aspectRatio: "1 / 1", borderRadius: "50%", background: "var(--color-accent-100)" }} />
      </div>

      <img
        aria-hidden="true"
        src="/mascot/3D-Chibi/normal.png"
        alt=""
        style={{ position: "relative", zIndex: 1, width: "clamp(160px, 34vw, 240px)", height: "auto", filter: "drop-shadow(0 22px 30px color-mix(in srgb, var(--color-text) 16%, transparent))", animation: "pd-bob 2.6s ease-in-out infinite" }}
      />
      <div aria-hidden="true" style={{ position: "relative", zIndex: 1, width: "clamp(180px, 46vw, 280px)", height: 6, borderRadius: 999, background: "var(--color-neutral-200)", overflow: "hidden" }}>
        <div style={{ width: "40%", height: "100%", borderRadius: 999, background: "var(--color-accent)", animation: "pd-track 1.6s ease-in-out infinite" }} />
      </div>
    </div>
  );
}
