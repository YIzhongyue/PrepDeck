import { registerNavigationSave } from "../lib/examWorkspace";
import { useEffect, useState } from "react";
import { MAX_NOTE_LENGTH } from "@prepdeck/shared";
import LengthHint from "./LengthHint";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { Note } from "../types";

// FR-11.7: always show the author's display name and avatar (falling back to
// initials when avatarUrl is unavailable). FR-11.3: only the author (n.me) gets edit/delete controls.
export default function NoteCard({ note }: { note: Note }) {
  const { updateNote, removeNote } = usePrepDeck();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [draftVis, setDraftVis] = useState(note.vis);

  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const t = draft.trim();
    if (!t) throw new Error("A question note cannot be empty.");
    await updateNote(note.id, t, draftVis);
    setError(null);
    setEditing(false);
  };
  useEffect(() => registerNavigationSave(async () => {
    if (editing && (draft !== note.text || draftVis !== note.vis)) await save();
  }), [editing, draft, draftVis, note.text, note.vis, updateNote]);
  const cancel = () => {
    setDraft(note.text);
    setDraftVis(note.vis);
    setError(null);
    setEditing(false);
  };

  return (
    <div style={{ display: "flex", gap: 10, padding: "11px 12px", borderRadius: 16, background: note.me ? "var(--color-neutral-100)" : "var(--color-accent-2-100)" }}>
      {note.avatarUrl ? (
        <img src={note.avatarUrl} alt="" style={{ width: 24, height: 24, flex: "none", borderRadius: "50%", objectFit: "cover" }} />
      ) : (
        <span style={{ width: 24, height: 24, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, background: note.me ? "var(--color-accent-2-300)" : "var(--color-accent-300)", color: note.me ? "var(--color-accent-2-900)" : "var(--color-accent-900)" }}>
          {note.author.split(" ").map((p) => p[0]).join("")}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{note.author}</span>
          <span
            className="tag"
            style={{ fontSize: 9.5, padding: "1px 7px", background: note.vis === "shared" ? "var(--color-accent-200)" : "var(--color-neutral-200)", color: note.vis === "shared" ? "var(--color-accent-800)" : "var(--color-neutral-800)" }}
          >
            {note.vis}
          </span>
          {note.me && !editing && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)} style={{ fontSize: 11, padding: "2px 8px" }}>Edit</button>
              <button type="button" className="btn btn-ghost" onClick={() => removeNote(note.id)} style={{ fontSize: 11, padding: "2px 8px" }}>Delete</button>
            </span>
          )}
        </span>

        {!editing ? (
          <span style={{ display: "block", fontSize: 12.5, lineHeight: 1.5, opacity: 0.85 }}>{note.text}</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {error && <p role="alert">{error}</p>}
            <textarea
              className="input" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={MAX_NOTE_LENGTH} aria-label="Edit note"
              style={{ minHeight: 60, borderRadius: 14, fontSize: 12.5 }}
            />
            <LengthHint length={draft.length} max={MAX_NOTE_LENGTH} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", gap: 6, flex: 1 }}>
                {(["private", "shared"] as const).map((v) => {
                  const on = draftVis === v;
                  return (
                    <button
                      key={v} type="button" onClick={() => setDraftVis(v)}
                      style={{
                        flex: 1, padding: "5px 9px", borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 11.5,
                        background: on ? "var(--color-accent)" : "transparent", color: on ? "var(--color-bg)" : "var(--color-text)",
                        border: `1.5px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`
                      }}
                    >
                      {v === "private" ? "Private" : "Shared"}
                    </button>
                  );
                })}
              </div>
              <button type="button" className="btn btn-ghost" onClick={cancel} style={{ fontSize: 11.5 }}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => { void save().catch(() => setError("Could not save. Your draft is retained; please retry.")); }} style={{ fontSize: 11.5, padding: "6px 12px" }}>Save</button>
            </div>
          </div>
        )}
      </span>
    </div>
  );
}
