import { useEffect, useState } from "react";
import { MARK_STYLES, type AnnotationsListResponse, type MarkStyle } from "@prepdeck/shared";
import { HL } from "../data/constants";
import { segsFor } from "../lib/annotations";
import { annotationsQueryString, isDefaultView, type MarkSortOrder } from "../lib/annotationFilters";
import { apiFetch } from "../lib/api";
import { usePrepDeck } from "../store/PrepDeckContext";
import HighlightedText from "../components/HighlightedText";
import NoteCard from "../components/NoteCard";

// Known FR-8.4 gap: this list uses placeholder text for AI-targeted marks.
// Other review screens load real explanations; see docs/requirements/review-notes-and-annotations.md.
const AI_PLACEHOLDER = "AI explanations aren't wired up yet — this is a placeholder.";

export default function Notes() {
  const { state, capture, setMarkNote, saveMarkNote, removeMark } = usePrepDeck();

  const [markFilter, setMarkFilter] = useState<MarkStyle[]>([]);
  const [markSort, setMarkSort] = useState<MarkSortOrder>("asc");
  // null = default view (no filter, oldest-first) — just use state.anns as-is.
  // Otherwise, the ordered set of annotation ids the server says match the
  // current filter/sort; annotation content itself always comes from
  // state.anns so edits/removals made elsewhere stay in sync.
  const [filteredIds, setFilteredIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (isDefaultView(markFilter, markSort)) { setFilteredIds(null); return; }
    let cancelled = false;
    apiFetch<AnnotationsListResponse>(`/api/annotations?${annotationsQueryString(markFilter, markSort, state.examId ?? "")}`)
      .then(({ annotations }) => { if (!cancelled) setFilteredIds(annotations.map((a) => a.id)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [markFilter, markSort, state.examId]);

  const annsById = new Map(state.anns.map((a) => [a.id, a]));
  const visibleAnns = filteredIds === null
    ? state.anns
    : filteredIds.map((id) => annsById.get(id)).filter((a): a is (typeof state.anns)[number] => !!a);

  const annQids: string[] = [];
  visibleAnns.forEach((a) => { if (annQids.indexOf(a.qid) < 0) annQids.push(a.qid); });
  state.notes.forEach((n) => { if (annQids.indexOf(n.qid) < 0) annQids.push(n.qid); });

  return (
    <div style={{ animation: "pd-rise .28s ease both" }}>
      <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>Review</p>
      <h1 style={{ margin: "0 0 6px", fontSize: 34 }}>My annotations</h1>
      <p style={{ margin: "0 0 22px", fontSize: 13.5, opacity: 0.7, maxWidth: 620 }}>
        Select any text below to highlight, underline or bold it. Marks are private to you and never appear while you answer.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16, maxWidth: 900 }}>
        <span style={{ fontSize: 12, opacity: 0.65, marginRight: 4 }}>Filter:</span>
        {MARK_STYLES.map((style) => {
          const on = markFilter.includes(style);
          return (
            <button
              key={style}
              type="button"
              onClick={() => setMarkFilter((prev) => (prev.includes(style) ? prev.filter((s) => s !== style) : prev.concat(style)))}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                font: "inherit", fontSize: 12.5, background: on ? "var(--color-accent-100)" : "transparent",
                border: `1.5px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 3, background: HL[style]?.background }} />
              {state.markAliases[style]}
            </button>
          );
        })}
        {markFilter.length > 0 && (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setMarkFilter([])}>Clear filter</button>
        )}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
          {(["asc", "desc"] as const).map((order) => {
            const on = markSort === order;
            return (
              <button
                key={order}
                type="button"
                onClick={() => setMarkSort(order)}
                style={{
                  padding: "6px 14px", borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 12.5,
                  background: on ? "var(--color-accent)" : "transparent", color: on ? "var(--color-bg)" : "var(--color-text)",
                  border: `1.5px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`
                }}
              >
                {order === "asc" ? "Oldest first" : "Newest first"}
              </button>
            );
          })}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
        {annQids.map((qid) => {
          const qq = state.catalogBy[qid];
          if (!qq) return null;
          const marks = visibleAnns.filter((a) => a.qid === qid);
          const notes = state.notes.filter((n) => n.qid === qid && (n.me || (n.vis === "shared" && state.showShared)));
          const stemSegs = segsFor(qq.stem, visibleAnns, qid, "stem", true);
          const hasAiMark = marks.some((a) => a.target === "ai");
          return (
            <div key={qid} className="card elev-sm" style={{ padding: 22, gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="tag tag-neutral" style={{ whiteSpace: "nowrap" }}>{qq.externalId}</span>
                {qq.tags.map((t) => <span key={t} className="tag tag-accent-2" style={{ whiteSpace: "nowrap" }}>{t}</span>)}
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 50%, transparent)" }}>
                  {marks.length} mark{marks.length === 1 ? "" : "s"}
                </span>
              </div>
              <p onMouseUp={() => capture(qid, "stem")} style={{ margin: 0, fontSize: 15, lineHeight: 1.6, textWrap: "pretty" }}>
                <HighlightedText segs={stemSegs} />
              </p>
              {(qq.options ?? []).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(qq.options ?? []).map((o) => (
                    <p
                      key={o.id}
                      onMouseUp={() => capture(qid, `opt:${o.id}`)}
                      style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, padding: "8px 11px", borderRadius: 14, background: "var(--color-neutral-100)" }}
                    >
                      <HighlightedText segs={segsFor(o.text, visibleAnns, qid, `opt:${o.id}`, true)} />
                    </p>
                  ))}
                </div>
              )}
              {hasAiMark && (
                <p onMouseUp={() => capture(qid, "ai")} style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, opacity: 0.85 }}>
                  <HighlightedText segs={segsFor(AI_PLACEHOLDER, visibleAnns, qid, "ai", true)} />
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {marks.map((a) => {
                  const src = a.target === "stem" ? qq.stem : a.target === "ai" ? AI_PLACEHOLDER : (qq.options?.find((o) => `opt:${o.id}` === a.target)?.text || "");
                  const quote = src.slice(a.start, a.end);
                  return (
                    <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 13px", borderRadius: 16, background: "var(--color-neutral-100)" }}>
                      <span style={{ width: 12, height: 12, flex: "none", marginTop: 5, borderRadius: 4, background: HL[a.style]?.background || "var(--color-accent)", border: "1px solid var(--color-divider)" }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 11, fontWeight: 600, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          {state.markAliases[a.style as MarkStyle] ?? a.style}
                        </span>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, margin: "2px 0 4px" }}>&ldquo;{quote}&rdquo;</span>
                        <input
                          className="input" type="text" placeholder="Add a note to this mark…" value={a.note}
                          onChange={(e) => setMarkNote(a.id, e.target.value)}
                          onBlur={() => saveMarkNote(a.id)}
                          style={{ fontSize: 12.5, minHeight: 32 }}
                        />
                      </span>
                      <button type="button" className="btn btn-ghost" onClick={() => removeMark(a.id)} style={{ fontSize: 12 }}>Remove</button>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid var(--color-divider)" }}>
                {notes.map((n) => <NoteCard key={n.id} note={n} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
