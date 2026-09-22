// implementation — "Link existing" from Learning Mode's related-knowledge-points
// card: search the user's Knowledge Points by title/body text and link the
// chosen one to the current question. Mirrors LinkQuestionModal.tsx's
// search-and-act pattern, inverted (searching notes, not questions).

import { useEffect, useState } from "react";
import ModalLayer from "../ModalLayer";
import type { KnowledgePointSummary } from "@prepdeck/shared";
import { linkQuestionToKnowledgePoint, listKnowledgePoints } from "../../lib/knowledgePoints";

export default function LinkExistingKnowledgePointModal({ questionId, onClose }: { questionId: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<KnowledgePointSummary[]>([]);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      listKnowledgePoints({ q: q || undefined, limit: 20 })
        .then((res) => { if (!cancelled) setResults(res.knowledgePoints); })
        .catch(() => {});
    }, 250);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [q]);

  const link = (noteId: string) => {
    setBusyId(noteId);
    linkQuestionToKnowledgePoint(noteId, questionId)
      .then(() => setLinkedIds((s) => new Set(s).add(noteId)))
      .catch(() => setError("Could not link this note. Please retry."))
      .finally(() => setBusyId(null));
  };

  return (
    <ModalLayer label="Link an existing note" onClose={onClose}>
      <div className="dialog" style={{ width: "min(560px, 100%)", maxHeight: "80vh" }}>
        {error && <p role="alert">{error}</p>}
        <span className="dialog-title">Link an existing note</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", border: "1px solid var(--color-divider)", borderRadius: 999, background: "var(--color-bg)" }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45, flex: "none" }}><path d="M11 4a7 7 0 100 14 7 7 0 000-14z M20 20l-4-4" /></svg>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your knowledge points…"
            style={{ width: "100%", padding: 0, border: 0, outline: 0, background: "transparent", font: "inherit", fontSize: 13 }}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {results.map((n) => {
            const linked = linkedIds.has(n.id);
            return (
              <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 13px", border: "1px solid var(--color-divider)", borderRadius: 16 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{n.title || "Untitled knowledge point"}</span>
                  {n.excerpt && <span style={{ display: "block", fontSize: 12, opacity: 0.7, marginTop: 2 }}>{n.excerpt}</span>}
                </span>
                {linked ? (
                  <span style={{ flex: "none", fontSize: 12, fontWeight: 600, color: "var(--color-accent-2-800)" }}>Linked</span>
                ) : (
                  <button type="button" disabled={busyId === n.id} onClick={() => link(n.id)} className="btn btn-primary" style={{ flex: "none", padding: "5px 12px", fontSize: 12 }}>
                    Link
                  </button>
                )}
              </div>
            );
          })}
          {results.length === 0 && <p style={{ opacity: 0.6, fontSize: 13 }}>No matching knowledge points.</p>}
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Done</button>
        </div>
      </div>
    </ModalLayer>
  );
}
