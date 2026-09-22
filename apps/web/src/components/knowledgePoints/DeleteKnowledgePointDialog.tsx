import type { KnowledgePointDetail } from "@prepdeck/shared";
import { useState } from "react";
import ModalLayer from "../ModalLayer";

export default function DeleteKnowledgePointDialog({
  note,
  onCancel,
  onConfirm,
}: {
  note: KnowledgePointDetail;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageCount = note.images.filter((i) => i.status !== "orphaned").length;
  const linkedCount = note.linkedQuestions.length;

  return (
    <ModalLayer label="Delete knowledge point" onClose={() => { if (!busy) onCancel(); }}>
      <div className="dialog">
        {error && <p role="alert">{error}</p>}
        <span className="dialog-title">Delete &ldquo;{note.title || "Untitled knowledge point"}&rdquo;?</span>
        <div className="dialog-body">
          <p style={{ margin: "0 0 10px" }}>
            This removes the note{imageCount > 0 ? `, its ${imageCount} screenshot${imageCount === 1 ? "" : "s"}` : ""}
            {linkedCount > 0 ? ` and its links to ${linkedCount} question${linkedCount === 1 ? "" : "s"}` : ""}.
          </p>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
            The questions{note.groupName ? `, the ${note.groupName} group,` : ""} and your tags are not deleted.
          </p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setBusy(true); void onConfirm().catch(() => { setBusy(false); setError("Could not delete this note. Please retry."); }); }}
            style={{ padding: "8.8px 16px", border: 0, borderRadius: 999, background: "var(--color-danger)", color: "#fff", cursor: "pointer", fontFamily: "var(--font-heading)", fontSize: 14 }}
          >
            Delete note
          </button>
        </div>
      </div>
    </ModalLayer>
  );
}
