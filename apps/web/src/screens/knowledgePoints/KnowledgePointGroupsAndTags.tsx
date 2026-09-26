// implementation — mockup Screen 4.

import { useState } from "react";
import type { KnowledgePointGroup, KnowledgePointTag } from "@prepdeck/shared";
import { useKnowledgePoints } from "../../store/useKnowledgePoints";

function EditableRow<T extends { id: string; name: string; noteCount: number }>({
  item,
  onRename,
  onDelete,
  deleteConfirmMessage,
  pillClassName,
}: {
  item: T;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  deleteConfirmMessage: string;
  pillClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);

  if (editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 8px 14px", border: "1.5px solid var(--color-accent)", borderRadius: 16, background: "var(--color-bg)" }}>
        <input
          type="text"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onRename(item.id, draft); setEditing(false); }
            if (e.key === "Escape") { setDraft(item.name); setEditing(false); }
          }}
          style={{ flex: 1, minWidth: 0, padding: "4px 0", border: 0, outline: 0, background: "transparent", font: "inherit", fontSize: 13.5, fontWeight: 600 }}
        />
        <button type="button" onClick={() => { onRename(item.id, draft); setEditing(false); }} style={{ padding: "5px 13px", border: 0, borderRadius: 999, background: "var(--color-accent)", color: "var(--color-bg)", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600 }}>Save</button>
        <button type="button" onClick={() => { setDraft(item.name); setEditing(false); }} style={{ padding: "5px 11px", border: 0, borderRadius: 999, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12, color: "var(--color-text-muted)" }}>Cancel</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: pillClassName ? "9px 14px" : "11px 14px", borderRadius: 16, background: "var(--color-bg)" }}>
      {pillClassName ? <span className={pillClassName}>{item.name}</span> : <span style={{ fontSize: 13.5, fontWeight: 600 }}>{item.name}</span>}
      <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>{pillClassName ? `on ${item.noteCount} note${item.noteCount === 1 ? "" : "s"}` : `${item.noteCount} note${item.noteCount === 1 ? "" : "s"}`}</span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
        <button type="button" onClick={() => setEditing(true)} style={{ padding: "3px 10px", border: 0, borderRadius: 999, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 11.5, color: "var(--color-accent-700)" }}>Rename</button>
        <button
          type="button"
          onClick={() => { if (window.confirm(deleteConfirmMessage)) onDelete(item.id); }}
          style={{ padding: "3px 10px", border: 0, borderRadius: 999, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 11.5, color: "var(--color-danger-text)" }}
        >
          Delete
        </button>
      </span>
    </div>
  );
}

export default function KnowledgePointGroupsAndTags({ onBack }: { onBack: () => void }) {
  const kp = useKnowledgePoints();
  const { state } = kp;
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupError, setNewGroupError] = useState<string | null>(null);

  const addGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    kp.createGroup(name)
      .then(() => { setNewGroupName(""); setNewGroupError(null); })
      .catch((err) => setNewGroupError(err instanceof Error ? err.message : "Could not create group"));
  };

  const totalNotes = state.groups.reduce((sum: number, g: KnowledgePointGroup) => sum + g.noteCount, 0) + state.ungroupedCount;

  return (
    <div style={{ animation: "pd-rise .28s ease backwards" }}>
      <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }} style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 16, fontSize: 12.5, fontWeight: 600, color: "var(--color-accent-700)", textDecoration: "none" }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        Knowledge points
      </a>
      <h1 style={{ margin: "0 0 6px", fontSize: 34 }}>Groups &amp; tags</h1>
      <p style={{ margin: "0 0 24px", maxWidth: 560, fontSize: 13.5, color: "var(--color-text-muted)" }}>
        Groups are flat — a note belongs to at most one. Tags overlap freely. Both are private to you and separate from the question bank&rsquo;s tags.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", gap: 16, alignItems: "start" }}>
        <div style={{ padding: 22, border: "1px solid var(--color-divider)", borderRadius: 24, background: "var(--color-surface)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Groups</h3>
            <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>{state.groups.length} group{state.groups.length === 1 ? "" : "s"} · {totalNotes} note{totalNotes === 1 ? "" : "s"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {state.groups.map((g) => (
              <EditableRow
                key={g.id}
                item={g}
                onRename={kp.renameGroup}
                onDelete={kp.deleteGroup}
                deleteConfirmMessage={`Delete "${g.name}"? Its ${g.noteCount} note${g.noteCount === 1 ? "" : "s"} will move to Ungrouped and keep their content, tags, and question links.`}
              />
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 16, background: "var(--color-neutral-100)" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text-muted)" }}>Ungrouped</span>
              <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>{state.ungroupedCount} notes</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-muted)" }}>built-in</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => { setNewGroupName(e.target.value); setNewGroupError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") addGroup(); }}
              placeholder="New group name"
              className="input"
              style={{ flex: 1, minWidth: 0 }}
            />
            <button type="button" onClick={addGroup} className="btn btn-primary">Add group</button>
          </div>
          {newGroupError && <p style={{ margin: "8px 2px 0", fontSize: 12, color: "var(--color-danger-text)" }}>{newGroupError}</p>}
          <p style={{ margin: "10px 2px 0", fontSize: 11.5, color: "var(--color-text-muted)" }}>Names must be unique and non-blank. Deleting a group moves its notes to Ungrouped, keeping their order.</p>
        </div>

        <div style={{ padding: 22, border: "1px solid var(--color-divider)", borderRadius: 24, background: "var(--color-surface)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Tags</h3>
            <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>case-insensitive</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {state.tags.map((t: KnowledgePointTag) => (
              <EditableRow
                key={t.id}
                item={t}
                onRename={kp.renameTag}
                onDelete={kp.deleteTag}
                deleteConfirmMessage={`Delete the tag "${t.name}"? This removes it from ${t.noteCount} note${t.noteCount === 1 ? "" : "s"} — the notes themselves are not affected.`}
                pillClassName="tag tag-accent"
              />
            ))}
            {state.tags.length === 0 && <p style={{ fontSize: 12.5, color: "var(--color-text-muted)", margin: 0 }}>No tags yet — add one from a note.</p>}
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 14, padding: "12px 14px", border: "1px solid var(--color-accent-2-200)", borderRadius: 16, background: "var(--color-accent-2-100)" }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-2-800)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: 1 }}><path d="M12 8h.01 M11 12h1v4h1" /><circle cx={12} cy={12} r={9} /></svg>
            <span style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-accent-2-800)" }}>Renaming updates every note that uses the tag. Deleting removes the association only — the notes stay.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
