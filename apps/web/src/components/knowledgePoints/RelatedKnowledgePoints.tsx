// implementation — shows the current question's related Knowledge Points inside
// review contexts (per FR-14.7/FR-8.3/FR-11.6 — never shown during live
// practice/mock answering), with actions to link an existing
// note or create a new one with this question preselected. This card lives
// outside the Knowledge Points screen's own <KnowledgePointsProvider>, so it
// talks to the plain API module directly rather than the KP store hook —
// same pattern the KP editor's own LinkQuestionModal already uses for
// question search.

import { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgePointSummary } from "@prepdeck/shared";
import { usePrepDeck } from "../../store/PrepDeckContext";
import { createKnowledgePoint, linkQuestionToKnowledgePoint, listKnowledgePoints } from "../../lib/knowledgePoints";
import LinkExistingKnowledgePointModal from "./LinkExistingKnowledgePointModal";

export default function RelatedKnowledgePoints({ questionId }: { questionId: string }) {
  const { openKnowledgePointNote } = usePrepDeck();
  const visit = useRef(0);
  useEffect(() => { visit.current++; return () => { visit.current++; }; }, [questionId]);
  const [notes, setNotes] = useState<KnowledgePointSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createdNote = useRef<{ questionId: string; id: string } | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);

  const refresh = useCallback(() => {
    const generation = visit.current;
    setError(null);
    listKnowledgePoints({ linkedQuestionId: questionId, limit: 20 })
      .then((res) => { if (generation === visit.current) setNotes(res.knowledgePoints); })
      .catch(() => { if (generation === visit.current) setError("Could not load related notes. Please retry."); })
      .finally(() => { if (generation === visit.current) setLoading(false); });
  }, [questionId]);

  useEffect(() => {
    setLoading(true);
    setCreating(false);
    setNotes([]);
    setError(null);
    refresh();
  }, [refresh]);

  const createNew = async () => {
    if (creating) return;
    const generation = visit.current;
    setCreating(true);
    setError(null);
    try {
      if (createdNote.current?.questionId !== questionId) {
        const { knowledgePoint } = await createKnowledgePoint();
        if (generation !== visit.current) return;
        createdNote.current = { questionId, id: knowledgePoint.id };
      }
      const id = createdNote.current.id;
      await linkQuestionToKnowledgePoint(id, questionId);
      if (generation === visit.current) {
        createdNote.current = null;
        openKnowledgePointNote(id);
      }
    } catch {
      if (generation === visit.current) setError("Could not create and link your note. Retry New note to continue with the same draft.");
    } finally {
      if (generation === visit.current) setCreating(false);
    }
  };

  return (
    <div className="card elev-sm" style={{ padding: 18, gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="card-kicker" style={{ marginRight: "auto" }}>Knowledge points</span>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowLinkModal(true)}>
          Link existing
        </button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} disabled={creating} onClick={createNew}>
          + New note
        </button>
      </div>

      {error && <div role="alert" style={{ fontSize: 12.5 }}>{error}
        <button type="button" className="btn btn-ghost" onClick={refresh}>Reload related notes</button>
      </div>}

      {!loading && notes.length === 0 && (
        <p style={{ margin: 0, fontSize: 12.5, opacity: 0.6 }}>No knowledge points reference this question yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {notes.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => openKnowledgePointNote(n.id)}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 16, border: 0, background: "var(--color-neutral-100)", cursor: "pointer", font: "inherit" }}
          >
            <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{n.title || "Untitled knowledge point"}</span>
            {n.excerpt && <span style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{n.excerpt}</span>}
          </button>
        ))}
      </div>

      {showLinkModal && (
        <LinkExistingKnowledgePointModal
          questionId={questionId}
          onClose={() => {
            setShowLinkModal(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
