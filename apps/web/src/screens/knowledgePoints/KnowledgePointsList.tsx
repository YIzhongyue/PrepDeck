// implementation — mockup Screen 1 (list) plus Screen 5's two empty states.

import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { KnowledgePointSort, KnowledgePointSummary } from "@prepdeck/shared";
import type { Breakpoints } from "../../lib/responsive";
import { useKnowledgePoints } from "../../store/useKnowledgePoints";

const SORTS: { id: KnowledgePointSort; label: string }[] = [
  { id: "updated", label: "Last updated" },
  { id: "title", label: "Title" },
  { id: "created", label: "Created" },
  { id: "custom", label: "Custom order" },
];

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StatIcon({ d }: { d: string }) {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function NoteCard({ item, onOpen, dragHandle }: { item: KnowledgePointSummary; onOpen: () => void; dragHandle?: React.ReactNode }) {
  return (
    <article
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: "18px 20px", borderRadius: 32, background: "var(--color-surface)", boxShadow: "var(--pd-shadow-sm)", textDecoration: "none", color: "inherit", cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {dragHandle}
        <span className="tag" style={{ background: item.groupId ? "var(--color-accent-2-200)" : "var(--color-neutral-200)", color: item.groupId ? "var(--color-accent-2-800)" : "var(--color-neutral-800)", whiteSpace: "nowrap" }}>
          {item.groupName ?? "Ungrouped"}
        </span>
        {item.tags.map((t) => (
          <span key={t.id} className="tag tag-accent" style={{ whiteSpace: "nowrap" }}>{t.name}</span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11.5, opacity: 0.5, whiteSpace: "nowrap" }}>Updated {relativeTime(item.updatedAt)}</span>
      </div>
      <h3 style={{ margin: 0, fontSize: 20 }}><a href="#" onClick={e => { e.preventDefault(); onOpen(); }} style={{ color: "inherit", textDecoration: "none" }}>{item.title || "Untitled knowledge point"}</a></h3>
      {item.excerpt && <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, opacity: 0.72 }}>{item.excerpt}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 11.5, opacity: 0.5 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <StatIcon d="M7 3h8l3 3v15H7z M10 11h6 M10 15h4" />
          {item.linkedQuestionCount > 0 ? `${item.linkedQuestionCount} linked question${item.linkedQuestionCount === 1 ? "" : "s"}` : "No linked questions"}
        </span>
        {item.imageCount > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <StatIcon d="M3 4h18v14H3z M3 14l5-4 4 3 3-2 6 4" />
            {item.imageCount} screenshot{item.imageCount === 1 ? "" : "s"}
          </span>
        )}
        {item.diagramCount > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <StatIcon d="M3 3h7v6H3z M14 15h7v6h-7z M6.5 9v4a2 2 0 002 2H14" />
            {item.diagramCount} diagram{item.diagramCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </article>
  );
}

function SortableNoteCard({ item, onOpen, onUp, onDown, disabled }: { item: KnowledgePointSummary; onOpen: () => void; onUp?: () => void; onDown?: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
      <NoteCard
        item={item}
        onOpen={onOpen}
        dragHandle={
          <span style={{ display: "inline-flex", gap: 4 }}>
          <button
            type="button"
            disabled={disabled}
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${item.title || "note"} with arrow keys, or drag`}
            style={{ display: "grid", placeItems: "center", width: 40, height: 40, touchAction: "none", border: 0, borderRadius: 6, background: "transparent", cursor: "grab", color: "color-mix(in srgb, var(--color-text) 65%, transparent)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01" /></svg>
          </button>
          <button type="button" className="btn btn-secondary" disabled={disabled || !onUp} onClick={onUp} aria-label={`Move ${item.title} up`} style={{ minWidth: 36, minHeight: 40, padding: 6 }}>↑</button>
          <button type="button" className="btn btn-secondary" disabled={disabled || !onDown} onClick={onDown} aria-label={`Move ${item.title} down`} style={{ minWidth: 36, minHeight: 40, padding: 6 }}>↓</button>
          </span>
        }
      />
    </div>
  );
}

export default function KnowledgePointsList({ bp, onOpenNote, onManage }: { bp: Breakpoints; onOpenNote: (id: string) => void; onManage: () => void }) {
  const kp = useKnowledgePoints();
  const { state } = kp;
  const [creating, setCreating] = useState(false);
  const allNotesCount = state.groups.reduce((sum, g) => sum + g.noteCount, 0) + state.ungroupedCount;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = state.items.findIndex((i) => i.id === active.id);
    const newIndex = state.items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(state.items, oldIndex, newIndex);
    const activeNewIndex = reordered.findIndex((i) => i.id === active.id);
    const beforeId = reordered[activeNewIndex + 1]?.id ?? null;
    kp.reorderNote(String(active.id), beforeId);
  };

  const createNote = () => {
    setCreating(true);
    kp.createAndOpenNote(state.groupId).then((id) => { setCreating(false); onOpenNote(id); }).catch(() => setCreating(false));
  };

  const emptyFiltered = state.items.length === 0 && (state.total === 0) && (kp.hasActiveFilters || state.scope === "exam");
  const emptyCollection = state.items.length === 0 && !kp.hasActiveFilters && state.scope === "all" && allNotesCount === 0 && !state.listLoading;

  return (
    <div style={{ animation: "pd-rise .28s ease both" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>Personal knowledge</p>
          <h1 style={{ margin: 0, fontSize: 34 }}>Knowledge points</h1>
          <p style={{ margin: "8px 0 0", maxWidth: 560, fontSize: 13.5, opacity: 0.65 }}>
            Concept-level notes you write and organise yourself. Private to you — link them to any question across your exams.
          </p>
        </div>
        <button type="button" className="btn btn-primary" disabled={creating} onClick={createNote}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14 M5 12h14" /></svg>
          New knowledge point
        </button>
      </div>

      {/* implementation — additive scope toggle over the existing personal
          library: "All personal knowledge points" stays the default (and
          the only option) when there's no active exam workspace. */}
      {state.activeExamId && (
        <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 3, padding: 3, marginBottom: 18, border: "1px solid var(--color-divider)", borderRadius: 22, background: "var(--color-neutral-100)" }}>
          {([
            { id: "all", label: "All personal knowledge points" },
            { id: "exam", label: "Related to this exam" },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => kp.setScope(opt.id)}
              style={{ display: "inline-flex", alignItems: "center", padding: "7px 14px", border: 0, borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", background: state.scope === opt.id ? "var(--color-bg)" : "transparent", color: state.scope === opt.id ? "var(--color-accent-800)" : "color-mix(in srgb, var(--color-text) 60%, transparent)", boxShadow: state.scope === opt.id ? "var(--pd-shadow-sm)" : "none" }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* implementation mobile QA: this block used to be `{!bp.narrow && (...)}`,
          hiding groups/tags filtering — and the only way to reach the
          Groups & Tags management screen — entirely below the 900px
          breakpoint. Always rendered now; only the layout (a fixed 236px
          vertical sidebar vs. a full-width wrapped pill row) is responsive. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 26, alignItems: "flex-start" }}>
        <div style={bp.narrow
          ? { width: "100%", display: "flex", flexDirection: "column", gap: 10 }
          : { flex: "1 1 220px", maxWidth: "100%", width: 236, display: "flex", flexDirection: "column", gap: 2 }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: bp.narrow ? "0 2px" : "0 10px 8px" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.5 }}>Groups</span>
            <button type="button" onClick={onManage} style={{ padding: "2px 6px", border: 0, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 600, color: "var(--color-accent-700)" }}>Manage</button>
          </div>
          <div style={bp.narrow ? { display: "flex", flexWrap: "wrap", gap: 6 } : { display: "flex", flexDirection: "column", gap: 2 }}>
            <button
              type="button"
              onClick={() => kp.setFilterGroup(null, false)}
              style={bp.narrow
                ? { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", border: 0, borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: !state.groupId && !state.ungrouped ? 600 : 400, background: !state.groupId && !state.ungrouped ? "var(--color-accent-200)" : "var(--color-neutral-100)", color: !state.groupId && !state.ungrouped ? "var(--color-accent-800)" : "var(--color-text)" }
                : { display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 11px", border: 0, borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 13.5, textAlign: "left", fontWeight: !state.groupId && !state.ungrouped ? 600 : 400, background: !state.groupId && !state.ungrouped ? "var(--color-accent-200)" : "transparent", color: !state.groupId && !state.ungrouped ? "var(--color-accent-800)" : "var(--color-text)" }}
            >
              All notes<span style={{ marginLeft: bp.narrow ? 0 : "auto", fontSize: 11.5, opacity: bp.narrow ? 0.6 : 1 }}>{bp.narrow ? ` · ${allNotesCount}` : allNotesCount}</span>
            </button>
            {state.groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => kp.setFilterGroup(g.id, false)}
                style={bp.narrow
                  ? { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", border: 0, borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 12.5, background: state.groupId === g.id ? "var(--color-accent-200)" : "var(--color-neutral-100)", color: state.groupId === g.id ? "var(--color-accent-800)" : "var(--color-text)" }
                  : { display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 11px", border: 0, borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 13.5, textAlign: "left", background: state.groupId === g.id ? "var(--color-accent-200)" : "transparent", color: state.groupId === g.id ? "var(--color-accent-800)" : "var(--color-text)" }}
              >
                {g.name}<span style={{ marginLeft: bp.narrow ? 0 : "auto", fontSize: 11.5, opacity: 0.5 }}>{bp.narrow ? ` · ${g.noteCount}` : g.noteCount}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => kp.setFilterGroup(null, true)}
              style={bp.narrow
                ? { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", border: 0, borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 12.5, background: state.ungrouped ? "var(--color-accent-200)" : "var(--color-neutral-100)", color: state.ungrouped ? "var(--color-accent-800)" : "var(--color-text)" }
                : { display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 11px", border: 0, borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 13.5, textAlign: "left", background: state.ungrouped ? "var(--color-accent-200)" : "transparent", color: state.ungrouped ? "var(--color-accent-800)" : "var(--color-text)" }}
            >
              Ungrouped<span style={{ marginLeft: bp.narrow ? 0 : "auto", fontSize: 11.5, opacity: 0.5 }}>{bp.narrow ? ` · ${state.ungroupedCount}` : state.ungroupedCount}</span>
            </button>
          </div>

          <div style={{ height: 1, margin: bp.narrow ? "4px 0" : "14px 10px", background: "var(--color-divider)" }} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: bp.narrow ? "0 2px" : "0 10px 9px" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.5 }}>Tags</span>
            {state.tagIds.length > 1 && <span style={{ fontSize: 11, opacity: 0.45 }}>matches all</span>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: bp.narrow ? 0 : "0 6px" }}>
            {state.tags.map((t) => {
              const on = state.tagIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => kp.toggleFilterTag(t.id)}
                  style={{ display: "inline-flex", alignItems: "center", fontSize: 11.5, padding: "4px 11px", borderRadius: 999, cursor: "pointer", font: "inherit", background: on ? "var(--color-accent-200)" : "transparent", border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`, color: on ? "var(--color-accent-800)" : "var(--color-text)" }}
                >
                  {t.name}{on ? " ✕" : ""}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ flex: "999 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 260px", minWidth: 0, padding: "9px 14px", border: "1px solid var(--color-divider)", borderRadius: 999, background: "var(--color-bg)" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45, flex: "none" }}><path d="M11 4a7 7 0 100 14 7 7 0 000-14z M20 20l-4-4" /></svg>
              <input
                type="text"
                value={state.search}
                onChange={(e) => kp.setSearch(e.target.value)}
                placeholder="Search titles and note text…"
                style={{ width: "100%", minWidth: 0, padding: 0, border: 0, outline: 0, background: "transparent", font: "inherit", fontSize: 13 }}
              />
              <span style={{ flex: "none", fontSize: 11.5, opacity: 0.45, whiteSpace: "nowrap" }}>{state.total} result{state.total === 1 ? "" : "s"}</span>
            </div>
            <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 3, padding: 3, border: "1px solid var(--color-divider)", borderRadius: 22, background: "var(--color-neutral-100)" }}>
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => kp.setSort(s.id)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 13px", border: 0, borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", background: state.sort === s.id ? "var(--color-bg)" : "transparent", color: state.sort === s.id ? "var(--color-accent-800)" : "color-mix(in srgb, var(--color-text) 60%, transparent)", boxShadow: state.sort === s.id ? "var(--pd-shadow-sm)" : "none" }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {state.listError && <div role="alert"><p>{state.listError}</p><button type="button" className="btn btn-secondary" onClick={kp.refreshList}>Reload notes</button></div>}

          {(kp.hasActiveFilters || state.scope === "exam") && state.sort === "custom" && (
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", border: "1px solid var(--color-accent-300)", borderRadius: 18, background: "var(--color-accent-100)" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-700)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}><path d="M12 8h.01 M11 12h1v4h1" /><circle cx={12} cy={12} r={9} /></svg>
              <span style={{ fontSize: 12.5, color: "var(--color-accent-800)" }}>
                {state.scope === "exam" ? "Reordering is off in the exam-filtered view." : "Reordering is off while a search or tag filter is active."}
              </span>
              <button
                type="button"
                onClick={() => { kp.clearFilters(); if (state.scope === "exam") kp.setScope("all"); }}
                style={{ marginLeft: "auto", padding: "4px 10px", border: 0, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--color-accent-700)", whiteSpace: "nowrap" }}
              >
                {state.scope === "exam" ? "Show all notes to reorder" : "Clear filters to reorder"}
              </button>
            </div>
          )}

          {emptyCollection && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 6, padding: "44px 40px", borderRadius: 32, background: "var(--color-neutral-100)" }}>
              <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--color-accent-2-200)", display: "grid", placeItems: "center", marginBottom: 6 }}>
                <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-2-800)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 4.5-8 4.5-8-4.5z M4 12l8 4.5 8-4.5 M4 16.5l8 4.5 8-4.5" /></svg>
              </span>
              <h3 style={{ margin: 0, fontSize: 20 }}>No knowledge points yet</h3>
              <p style={{ margin: "0 0 12px", maxWidth: 420, fontSize: 13, opacity: 0.65 }}>Write one explanation per concept, link the questions it covers, and it becomes your own revision outline.</p>
              <button type="button" className="btn btn-primary" onClick={createNote}>Create your first note</button>
            </div>
          )}

          {emptyFiltered && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 6, padding: "36px 40px", borderRadius: 32, background: "var(--color-surface)" }}>
              <h3 style={{ margin: 0, fontSize: 20 }}>
                {state.search ? `No notes match “${state.search}”` : kp.hasActiveFilters ? "No notes match these tags" : "No notes linked to this exam yet"}
              </h3>
              <p style={{ margin: "0 0 10px", fontSize: 13, opacity: 0.65 }}>
                {kp.hasActiveFilters ? "Try a different search or clear your filters." : "Link a knowledge point to a question in this exam, or browse your full library."}
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { kp.clearFilters(); if (state.scope === "exam") kp.setScope("all"); }}
              >
                {kp.hasActiveFilters ? "Reset filters" : "View all personal knowledge points"}
              </button>
            </div>
          )}

          {kp.canReorder ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={state.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {state.items.map((item, index) => (
                    <SortableNoteCard key={item.id} item={item} onOpen={() => onOpenNote(item.id)} disabled={state.ordering || state.listLoading}
                      onUp={index > 0 ? () => kp.reorderNote(item.id, state.items[index - 1]!.id) : undefined}
                      onDown={index < state.items.length - 1 ? () => kp.reorderNote(item.id, state.items[index + 2]?.id ?? null) : undefined} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {state.items.map((item) => (
                <NoteCard key={item.id} item={item} onOpen={() => onOpenNote(item.id)} />
              ))}
            </div>
          )}

          {state.items.length < state.total && <div><button type="button" className="btn btn-secondary" disabled={state.listLoading} onClick={kp.loadMore}>Load more notes</button>{state.sort === "custom" && <p>Load the complete group before reordering its review sequence.</p>}</div>}

          {kp.canReorder && state.items.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 20px", border: "1px dashed var(--color-divider)", borderRadius: 24 }}>
              <span style={{ fontSize: 12.5, opacity: 0.7 }}>Custom order · drag the grip, use Space then arrow keys on the grip, or use the move buttons.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
