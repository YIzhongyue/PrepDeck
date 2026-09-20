import { reviewIds } from "../lib/reviewLists";
import { useState } from "react";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { Breakpoints } from "../lib/responsive";

export default function ListScreen({ bp }: { bp: Breakpoints }) {
  const { state, begin, practiceList, removeBookmark, markMastered } = usePrepDeck();
  const isBookmarks = state.listMode === "bm";
  const wrongIds = reviewIds(state, "wrong");
  const bmIds = reviewIds(state, "bm");
  const baseIds = isBookmarks ? bmIds : wrongIds;

  // FR-5.2 / FR-6.2: filter this list by category (exam is implicit — the
  // whole app operates on one active exam at a time via state.examId).
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const tags = Array.from(new Set(baseIds.flatMap((id) => state.catalogBy[id]?.tags ?? []))).sort();
  const listIds = activeTags.length
    ? baseIds.filter((id) => state.catalogBy[id]?.tags.some((t) => activeTags.indexOf(t) >= 0))
    : baseIds;
  const toggleTagFilter = (tag: string) => {
    setActiveTags((prev) => (prev.indexOf(tag) >= 0 ? prev.filter((t) => t !== tag) : prev.concat(tag)));
  };

  return (
    <div style={{ animation: "pd-rise .28s ease both" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>{isBookmarks ? "Saved" : "Targeted review"}</p>
          <h1 style={{ margin: 0, fontSize: 34 }}>{isBookmarks ? "Bookmarks" : "Wrong question book"}</h1>
        </div>
        <button type="button" className="btn btn-primary" disabled={!listIds.length} onClick={() => practiceList(listIds)}>Practice these {listIds.length}</button>
      </div>

      {tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          {tags.map((t) => {
            const on = activeTags.indexOf(t) >= 0;
            return (
              <button
                key={t} type="button" onClick={() => toggleTagFilter(t)} className="tag"
                style={{
                  border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`,
                  background: on ? "var(--color-accent-200)" : "transparent",
                  color: on ? "var(--color-accent-800)" : "var(--color-text)",
                  cursor: "pointer", font: "inherit", fontSize: 12, padding: "5px 12px"
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: bp.narrow ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {listIds.map((id) => {
          const qq = state.catalogBy[id];
          if (!qq) return null;
          const w = state.wrong[id];
          return (
            <div key={id} className="card elev-sm" style={{ padding: "18px 20px", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="tag tag-neutral" style={{ whiteSpace: "nowrap" }}>{qq.externalId}</span>
                {qq.tags.map((t) => <span key={t} className="tag tag-accent-2" style={{ whiteSpace: "nowrap" }}>{t}</span>)}
                <span className="tag" style={{ marginLeft: "auto", background: isBookmarks ? "var(--color-neutral-200)" : "var(--color-accent-200)", color: isBookmarks ? "var(--color-neutral-800)" : "var(--color-accent-800)", fontSize: 10.5 }}>
                  {isBookmarks ? "saved" : w ? `${w.c}× wrong · ${new Date(w.at).toLocaleDateString()}` : ""}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, opacity: 0.9 }}>{qq.stem}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                <button type="button" className="btn btn-secondary" onClick={() => begin([id])} style={{ padding: "6px 14px" }}>Review</button>
                <button
                  type="button" className="btn btn-ghost"
                  onClick={() => (isBookmarks ? removeBookmark(id) : markMastered(id))}
                >
                  {isBookmarks ? "Remove bookmark" : "Mark mastered"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {listIds.length === 0 && (
        <div className="card" style={{ padding: 40, alignItems: "center", textAlign: "center", background: "color-mix(in srgb, var(--color-surface) 50%, var(--color-bg))" }}>
          <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--color-accent-2-200)", display: "grid", placeItems: "center", marginBottom: 6 }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-2-800)" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4 10-10" />
            </svg>
          </span>
          <h3 style={{ margin: 0, fontSize: 20 }}>{isBookmarks ? "Nothing saved yet" : "Wrong book is clear"}</h3>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>
            {isBookmarks ? "Bookmark a question while practising and it lands here." : "Every question you missed has been mastered. Nice."}
          </p>
        </div>
      )}
    </div>
  );
}
