// implementation — mockup Screen 2.

import { useEffect, useState } from "react";
import type { Breakpoints } from "../../lib/responsive";
import { usePrepDeck } from "../../store/PrepDeckContext";
import { useKnowledgePoints } from "../../store/useKnowledgePoints";
import MarkdownEditor from "../../components/knowledgePoints/MarkdownEditor";
import GroupPicker from "../../components/knowledgePoints/GroupPicker";
import TagPicker from "../../components/knowledgePoints/TagPicker";
import LinkQuestionModal from "../../components/knowledgePoints/LinkQuestionModal";
import DeleteKnowledgePointDialog from "../../components/knowledgePoints/DeleteKnowledgePointDialog";

function SaveStatusPill({ status, lastSavedAt, message }: { status: string; lastSavedAt: string | null; message: string | null }) {
  if (status === "saving") {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", border: "1px solid var(--color-accent-300)", borderRadius: 999, background: "var(--color-accent-100)", color: "var(--color-accent-800)", fontSize: 12.5, fontWeight: 600 }}>
        Saving…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", border: "1px solid var(--color-danger-border)", borderRadius: 999, background: "var(--color-danger-bg)", color: "var(--color-danger-text)", fontSize: 12.5, fontWeight: 600 }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9 17H3z M12 9v5 M12 17h.01" /></svg>
        {message ?? "Save failed"}
      </div>
    );
  }
  if (status === "saved") {
    const time = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", border: "1px solid var(--color-accent-2-200)", borderRadius: 999, background: "var(--color-accent-2-100)", color: "var(--color-accent-2-800)", fontSize: 12.5, fontWeight: 600 }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4 10-10" /></svg>
        Saved{time ? ` · ${time}` : ""}
      </div>
    );
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", border: "1px solid var(--color-divider)", borderRadius: 999, color: "color-mix(in srgb, var(--color-text) 60%, transparent)", fontSize: 12.5, fontWeight: 600 }}>
      Unsaved changes
    </div>
  );
}

export default function KnowledgePointEditor({
  bp,
  noteId,
  onBack,
  onOpenNote,
  onDeleted,
}: {
  bp: Breakpoints;
  noteId: string;
  onBack: () => void;
  onOpenNote: (id: string) => void;
  onDeleted: () => void;
}) {
  const kp = useKnowledgePoints();
  const { goToQuestionForReview } = usePrepDeck();
  const { state } = kp;
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);

  useEffect(() => {
    kp.openNote(noteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const editing = state.editing;
  const inSequence = kp.canReorder && state.items.some((i) => i.id === noteId);
  const idx = inSequence ? state.items.findIndex((i) => i.id === noteId) : -1;
  const prevId = idx > 0 ? state.items[idx - 1]?.id : undefined;
  const nextId = idx >= 0 && idx < state.items.length - 1 ? state.items[idx + 1]?.id : undefined;

  const backToList = async () => {
    try { await kp.flushEditor(); kp.closeEditor(); kp.refreshList(); onBack(); }
    catch (error) { setNavigationError(error instanceof Error ? error.message : "Your note could not be saved. Please retry before leaving."); }
  };

  const openOther = async (id: string) => {
    try { await kp.flushEditor(); setNavigationError(null); onOpenNote(id); }
    catch (error) { setNavigationError(error instanceof Error ? error.message : "Your note could not be saved. Please retry before leaving."); }
  };

  if (state.editorError) return <div role="alert"><p>{state.editorError}</p><button type="button" className="btn btn-primary" onClick={() => kp.openNote(noteId)}>Retry loading note</button><button type="button" className="btn btn-secondary" onClick={onBack}>All notes</button></div>;
  if (state.editorLoading || !editing) {
    return <p style={{ opacity: 0.6, padding: "40px 0" }}>Loading…</p>;
  }

  const header = (
    <>
      <input
        type="text"
        aria-label="Knowledge point title"
        aria-invalid={!state.title.trim()}
        value={state.title}
        onChange={(e) => kp.setTitle(e.target.value)}
        onCompositionStart={() => kp.setComposing(true)}
        onCompositionEnd={() => kp.setComposing(false)}
        placeholder="Untitled knowledge point"
        style={{ width: "100%", padding: 0, margin: "0 0 10px", border: 0, outline: 0, background: "transparent", fontFamily: "var(--font-heading)", fontSize: "clamp(26px,3.4vw,36px)", lineHeight: 1.1, letterSpacing: "-0.015em", color: "var(--color-text)" }}
      />
      {!state.title.trim() && <p role="alert">A title is required before this note can be saved.</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 22, paddingBottom: 18, borderBottom: "1px solid var(--color-divider)" }}>
        <GroupPicker groups={state.groups} groupId={editing.groupId} groupName={editing.groupName} onSelect={kp.setNoteGroup} />
        {editing.tags.map((t) => (
          <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, padding: "4px 10px", borderRadius: 999, background: "var(--color-accent-100)", color: "var(--color-accent-800)" }}>
            {t.name}
            <button type="button" onClick={() => kp.removeTag(t.id)} aria-label={`Remove tag ${t.name}`} style={{ border: 0, background: "transparent", cursor: "pointer", opacity: 0.5, font: "inherit", fontSize: 11, padding: 0 }}>✕</button>
          </span>
        ))}
        <TagPicker existingTags={state.tags} currentTagIds={editing.tags.map((t) => t.id)} onAdd={kp.addTag} />
        <span style={{ marginLeft: "auto", fontSize: 11.5, opacity: 0.45, whiteSpace: "nowrap" }}>
          Created {new Date(editing.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · Updated {new Date(editing.updatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </>
  );

  return (
    <div style={{ animation: "pd-rise .28s ease both" }}>
      {showLinkModal && <LinkQuestionModal knowledgePointId={editing.id} onClose={() => setShowLinkModal(false)} />}
      {showDeleteDialog && (
        <DeleteKnowledgePointDialog
          note={editing}
          onCancel={() => setShowDeleteDialog(false)}
          onConfirm={() => kp.deleteNote(editing.id).then(() => { setShowDeleteDialog(false); onDeleted(); })}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <a href="#" onClick={(e) => { e.preventDefault(); backToList(); }} style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--color-accent-700)", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          All notes
        </a>
        <span style={{ fontSize: 12.5, opacity: 0.35 }}>/</span>
        <span style={{ fontSize: 12.5, opacity: 0.6 }}>{editing.groupName ?? "Ungrouped"}</span>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span role="status" aria-live="polite"><SaveStatusPill status={state.saveStatus} lastSavedAt={state.lastSavedAt} message={state.saveErrorMessage} /></span>
          {inSequence && (
            <>
              <button type="button" className="btn btn-secondary" disabled={!prevId} onClick={() => prevId && openOther(prevId)}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l5 7-5 7 M20 12H8 M4 4v16" /></svg>
                Previous
              </button>
              <button type="button" className="btn btn-secondary" disabled={!nextId} onClick={() => nextId && openOther(nextId)}>
                Next in {editing.groupName ?? "Ungrouped"}
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
              </button>
            </>
          )}
        </div>
      </div>

      {navigationError && <p role="alert" style={{ color: "var(--color-danger-text)" }}>{navigationError}</p>}

      {state.conflict && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18, padding: "13px 16px", border: "1px solid var(--color-danger-border)", borderRadius: 16, background: "var(--color-danger-bg)" }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--color-danger-text)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: 2 }}><path d="M12 3l9 17H3z M12 9v5 M12 17h.01" /></svg>
          <span style={{ flex: 1, fontSize: 13, color: "var(--color-danger-text)" }}>
            This note was saved from another tab or device since you started editing. Keep your local changes (overwriting the other save) or reload the latest version (discarding yours)?
          </span>
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            <button type="button" onClick={kp.reloadAfterConflict} style={{ padding: "6px 12px", border: "1px solid var(--color-danger-border)", borderRadius: 999, background: "var(--color-bg)", color: "var(--color-danger-text)", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600 }}>
              Reload latest
            </button>
            <button type="button" onClick={kp.keepMineAfterConflict} style={{ padding: "6px 12px", border: 0, borderRadius: 999, background: "var(--color-danger)", color: "#fff", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600 }}>
              Keep mine
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: bp.narrow ? "column" : "row", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: bp.narrow ? "none" : "999 1 520px", minWidth: 0, width: "100%", border: "1px solid var(--color-divider)", borderRadius: 28, background: "var(--color-bg)", boxShadow: "var(--pd-shadow-sm)", overflow: "hidden" }}>
          <MarkdownEditor key={editing.id} value={state.bodyMarkdown} onChange={kp.setBodyMarkdown} onUploadImage={kp.uploadImage} onCompositionChange={kp.setComposing} onDismissUploadError={kp.dismissUploadError} header={header} />
        </div>

        <div style={{ flex: bp.narrow ? "none" : "1 1 280px", minWidth: 0, width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
          {state.saveStatus === "error" && !state.conflict && (
            <div style={{ padding: "16px 18px", border: "1px solid var(--color-danger-border)", borderRadius: 24, background: "var(--color-danger-bg)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "var(--color-danger-text)" }}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9 17H3z M12 9v5 M12 17h.01" /></svg>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Save failed — Retry</span>
              </div>
              <p style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.55, opacity: 0.8 }}>Your text is safe in the editor. {state.saveErrorMessage}</p>
              <button type="button" onClick={kp.retryNow} style={{ padding: "6px 14px", border: 0, borderRadius: 999, background: "var(--color-danger-text)", color: "#fff", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600 }}>
                Retry now
              </button>
              {state.metadataError && <button type="button" className="btn btn-secondary" onClick={kp.discardFailedMetadata}>Discard failed metadata change</button>}
            </div>
          )}

          <div style={{ padding: 18, border: "1px solid var(--color-divider)", borderRadius: 24, background: "var(--color-surface)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>Related questions</span>
              <span style={{ fontSize: 11.5, opacity: 0.45 }}>{editing.linkedQuestions.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {editing.linkedQuestions.filter((l) => l.accessible).map((l) => (
                <div key={l.questionId} style={{ padding: "11px 13px", borderRadius: 16, background: "var(--color-bg)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, opacity: 0.5 }}>{l.examSlug} · {l.externalId ?? l.questionId.slice(0, 8)}</span>
                    <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => l.examId && goToQuestionForReview(l.examId, l.questionId)}
                        title="Open in Learning mode for review — does not record an attempt"
                        style={{ padding: "1px 7px", border: 0, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 11, color: "var(--color-accent-700)" }}
                      >
                        Open
                      </button>
                      <button type="button" onClick={() => { void kp.unlinkQuestion(l.questionId).catch(() => {}); }} style={{ padding: "1px 7px", border: 0, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 11, color: "var(--color-accent-700)" }}>Unlink</button>
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, opacity: 0.8 }}>{l.stemExcerpt}</p>
                </div>
              ))}
              {editing.linkedQuestions.some((l) => !l.accessible) && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", borderRadius: 16, background: "var(--color-neutral-100)" }}>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45, flex: "none" }}><path d="M12 8h.01 M11 12h1v4h1" /><circle cx={12} cy={12} r={9} /></svg>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>
                    {editing.linkedQuestions.filter((l) => !l.accessible).length} linked question{editing.linkedQuestions.filter((l) => !l.accessible).length === 1 ? " is" : "s are"} no longer available to you.
                  </span>
                </div>
              )}
            </div>
            <button type="button" onClick={() => setShowLinkModal(true)} className="btn btn-secondary btn-block">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14 M5 12h14" /></svg>
              Link a question
            </button>
          </div>

          <div style={{ padding: 18, border: "1px solid var(--color-divider)", borderRadius: 24, background: "var(--color-bg)" }}>
            <span style={{ display: "block", marginBottom: 10, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.5 }}>Sync</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12.5, opacity: 0.75 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: state.saveStatus === "saved" ? "var(--color-accent-2-600)" : state.saveStatus === "error" ? "var(--color-danger)" : "var(--color-neutral-400)" }} />
                Body {state.saveStatus === "saved" ? "saved" : state.saveStatus === "saving" ? "saving…" : state.saveStatus === "error" ? "failed to save" : "unsaved"} · rev {editing.revision}
              </span>
              {state.uploading > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#e0961b" }} />
                  {state.uploading} attachment{state.uploading === 1 ? "" : "s"} still uploading
                </span>
              )}
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-neutral-400)" }} />
                Tags &amp; links {state.saveStatus === "saved" ? "up to date" : "syncing with this note"}
              </span>
            </div>
            <div style={{ height: 1, margin: "13px 0", background: "var(--color-divider)" }} />
            <button type="button" onClick={() => setShowDeleteDialog(true)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: 0, border: 0, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--color-danger-text)" }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3" /></svg>
              Delete this note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
