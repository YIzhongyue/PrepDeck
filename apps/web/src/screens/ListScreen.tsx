import { reviewIds } from "../lib/reviewLists";
import { filterByTags, pruneTags, tagFacets } from "../lib/tagFilter";
import TagFilterBar from "../components/TagFilterBar";
import { useEffect, useState } from "react";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { Breakpoints } from "../lib/responsive";

export default function ListScreen({ bp }: { bp: Breakpoints }) {
  const { state, begin, practiceList, removeBookmark, markMastered } = usePrepDeck();
  const isBookmarks = state.listMode === "bm";
  const wrongIds = reviewIds(state, "wrong");
  const bmIds = reviewIds(state, "bm");
  const baseIds = isBookmarks ? bmIds : wrongIds;
  const questions = baseIds.flatMap((id) => {
    const question = state.catalogBy[id];
    return question ? [question] : [];
  });

  // FR-5.2 / FR-6.2: filter this list by category (exam is implicit — the
  // whole app operates on one active exam at a time via state.examId).
  // `lib/tagFilter.ts` owns the rules; both lists render the same bar.
  const [selectedTags, setSelectedTags] = useState<readonly string[]>([]);
  const available = tagFacets(questions);
  // Bookmarks and the wrong book share this component and this state, and
  // either collection changes under it (mastering, un-bookmarking, switching
  // lists or exams). Prune while rendering so a tag that is no longer on offer
  // cannot filter the page down to nothing for a frame, then settle the state.
  const activeTags = pruneTags(selectedTags, available);
  const availableKey = available.map((facet) => facet.name).join("\u0000");
  useEffect(() => {
    // `pruneTags` hands back the same array when nothing was dropped, so this
    // is a no-op state write in the common case.
    setSelectedTags((previous) => pruneTags(previous, available));
    // `available` is a fresh array every render; its membership is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableKey]);

  // Every active tag still has at least one question behind it, so a filtered
  // page is never empty: the last question of a tag takes the tag with it.
  const listQuestions = filterByTags(questions, activeTags);
  const listIds = listQuestions.map((question) => question.id);
  const toggleTagFilter = (tag: string) => {
    setSelectedTags((previous) => (previous.indexOf(tag) >= 0 ? previous.filter((t) => t !== tag) : previous.concat(tag)));
  };

  return (
    <div style={{ animation: "pd-rise .28s ease both" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>{isBookmarks ? "Saved" : "Targeted review"}</p>
          <h1 style={{ margin: 0, fontSize: 34 }}>{isBookmarks ? "Bookmarks" : "Wrong question book"}</h1>
        </div>
        {/* Practice exactly what the page is showing, filters included. */}
        <button type="button" className="btn btn-primary" disabled={!listIds.length} onClick={() => practiceList(listIds)}>Practice these {listIds.length}</button>
      </div>

      <TagFilterBar
        questions={questions} selected={activeTags} resultCount={listIds.length}
        onToggle={toggleTagFilter} onClear={() => setSelectedTags([])}
      />

      <div style={{ display: "grid", gridTemplateColumns: bp.narrow ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {listQuestions.map((qq) => {
          const id = qq.id;
          const w = state.wrong[id];
          return (
            <div key={id} className="card elev-sm" style={{ padding: "18px 20px", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="tag tag-neutral" style={{ whiteSpace: "nowrap" }}>{qq.externalId}</span>
                {/* Card tags are metadata, not controls: no border, no count, and
                    the ones the filter matched carry the accent ring so a
                    multi-tag result explains itself. */}
                {qq.tags.map((t) => (
                  <span
                    key={t} className="tag tag-accent-2"
                    style={{ whiteSpace: "nowrap", ...(activeTags.indexOf(t) >= 0 ? { boxShadow: "inset 0 0 0 1px var(--color-accent)" } : null) }}
                  >
                    {t}
                  </span>
                ))}
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

      {!questions.length && (
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
