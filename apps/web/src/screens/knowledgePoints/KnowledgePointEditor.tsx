// implementation — mockup Screen 2.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Copy01, DotsHorizontal, Download01, InfoCircle, Maximize01, Plus, Trash01, XClose } from "@untitledui/icons";
import type { Breakpoints } from "../../lib/responsive";
import { usePrepDeck } from "../../store/PrepDeckContext";
import { useKnowledgePoints } from "../../store/useKnowledgePoints";
import MarkdownEditor from "../../components/knowledgePoints/MarkdownEditor";
import GroupPicker from "../../components/knowledgePoints/GroupPicker";
import TagPicker from "../../components/knowledgePoints/TagPicker";
import LinkQuestionModal from "../../components/knowledgePoints/LinkQuestionModal";
import DeleteKnowledgePointDialog from "../../components/knowledgePoints/DeleteKnowledgePointDialog";
import { Dropdown, MenuItem } from "../../components/knowledgePoints/EditorMenu";
import "./KnowledgePointEditor.css";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

// One quiet line replaces the old status pill, sync card and error card.
function SaveStatus({ status, lastSavedAt, uploading }: { status: string; lastSavedAt: string | null; uploading: number }) {
  if (status === "saving") return <span className="kp-save"><span className="kp-dot" />{uploading ? "Waiting for image…" : "Saving…"}</span>;
  if (status === "error") return <span className="kp-save kp-save-bad"><span className="kp-dot" />Not saved</span>;
  if (status === "saved") return <span className="kp-save"><span className="kp-dot kp-dot-ok" />Saved{lastSavedAt ? ` · ${timeOf(lastSavedAt)}` : ""}</span>;
  if (status === "unsaved") return <span className="kp-save"><span className="kp-dot" />Unsaved changes</span>;
  return null;
}

// Headings the outline can jump to. Fenced blocks are skipped so a "#"
// comment inside code is not mistaken for a section.
function outlineOf(markdown: string) {
  const headings: { level: number; text: string }[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker[0]!; else if (marker[0] === fence) fence = null; continue; }
    if (fence) continue;
    const match = /^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) headings.push({ level: match[1]!.length, text: match[2]!.replace(/[*_`]|\\(?=.)/g, "") });
  }
  return headings;
}

export default function KnowledgePointEditor({
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
  const { state, openNote } = kp;
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const outline = useMemo(() => outlineOf(state.bodyMarkdown), [state.bodyMarkdown]);

  useEffect(() => {
    openNote(noteId);
  }, [noteId, openNote]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    return (
      <div className="kp-skeleton" aria-busy="true" aria-label="Loading note">
        <span style={{ width: "62%", height: 34 }} /><span style={{ width: 220, height: 30 }} /><span style={{ height: 44 }} />
        <span style={{ width: "96%" }} /><span style={{ width: "88%" }} /><span style={{ width: "70%" }} />
      </div>
    );
  }

  const groupLabel = editing.groupName ?? "Ungrouped";
  const markdownFile = () => `# ${state.title.trim() || "Untitled knowledge point"}\n\n${state.bodyMarkdown}`;
  const copyMarkdown = () => {
    navigator.clipboard?.writeText(markdownFile()).then(() => setNotice("Markdown copied"), () => setNotice("Could not copy. Use Markdown mode to select the text."));
  };
  const downloadMarkdown = () => {
    const url = URL.createObjectURL(new Blob([markdownFile()], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.title.trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").slice(0, 80) || "knowledge-point"}.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const jumpTo = (index: number) => {
    document.querySelectorAll<HTMLElement>(".kp-editor .tiptap :is(h1, h2, h3)")[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const unavailable = editing.linkedQuestions.filter((l) => !l.accessible).length;

  const header = (
    <>
      <input
        type="text"
        className="kp-title-input"
        aria-label="Knowledge point title"
        aria-invalid={!state.title.trim()}
        value={state.title}
        onChange={(e) => kp.setTitle(e.target.value)}
        onCompositionStart={() => kp.setComposing(true)}
        onCompositionEnd={() => kp.setComposing(false)}
        placeholder="Untitled knowledge point"
      />
      {!state.title.trim() && <p role="alert" className="kp-title-error">A title is required before this note can be saved.</p>}
      <div className="kp-props">
        <GroupPicker groups={state.groups} groupId={editing.groupId} groupName={editing.groupName} onSelect={kp.setNoteGroup} />
        {editing.tags.map((t) => (
          <span key={t.id} className="kp-chip kp-chip-tag">
            {t.name}
            <button type="button" className="kp-chip-x" onClick={() => kp.removeTag(t.id)} aria-label={`Remove tag ${t.name}`}><XClose size={14} aria-hidden="true" /></button>
          </span>
        ))}
        <TagPicker existingTags={state.tags} currentTagIds={editing.tags.map((t) => t.id)} onAdd={kp.addTag} />
      </div>
    </>
  );

  return (
    <div className="kp-screen">
      {showLinkModal && <LinkQuestionModal knowledgePointId={editing.id} onClose={() => setShowLinkModal(false)} />}
      {showDeleteDialog && (
        <DeleteKnowledgePointDialog
          note={editing}
          onCancel={() => setShowDeleteDialog(false)}
          onConfirm={() => kp.deleteNote(editing.id).then(() => { setShowDeleteDialog(false); onDeleted(); })}
        />
      )}

      <div className="kp-topbar">
        <nav className="kp-crumbs" aria-label="Breadcrumb">
          <a href="#" onClick={(e) => { e.preventDefault(); backToList(); }}><ArrowLeft size={16} aria-hidden="true" />All notes</a>
          <span aria-hidden="true">/</span>
          <span className="kp-crumb-group">{groupLabel}</span>
        </nav>
        <div className="kp-topbar-actions">
          <span role="status" aria-live="polite">{notice ? <span className="kp-save"><span className="kp-dot kp-dot-ok" />{notice}</span> : <SaveStatus status={state.saveStatus} lastSavedAt={state.lastSavedAt} uploading={state.uploading} />}</span>
          {inSequence && (
            <>
              <span className="kp-tb-sep" aria-hidden="true" />
              <span className="kp-count">{idx + 1} of {state.items.length}</span>
              <button type="button" className="kp-icon-btn kp-icon-btn-lg" disabled={!prevId} onClick={() => prevId && openOther(prevId)} aria-label={`Previous in ${groupLabel}`} title={`Previous in ${groupLabel}`}><ChevronLeft size={18} /></button>
              <button type="button" className="kp-icon-btn kp-icon-btn-lg" disabled={!nextId} onClick={() => nextId && openOther(nextId)} aria-label={`Next in ${groupLabel}`} title={`Next in ${groupLabel}`}><ChevronRight size={18} /></button>
            </>
          )}
          <span className="kp-tb-sep" aria-hidden="true" />
          <button type="button" className="kp-icon-btn kp-icon-btn-lg kp-focus-toggle" aria-pressed={focusMode} aria-label="Focus mode" title="Focus mode: hide the sidebar" onClick={() => setFocusMode((f) => !f)}><Maximize01 size={18} /></button>
          <Dropdown label="More actions" menuLabel="More actions" triggerClassName="kp-icon-btn kp-icon-btn-lg" align="end" width={240} trigger={<DotsHorizontal size={18} aria-hidden="true" />}>
            {(close) => <>
              <MenuItem icon={<Copy01 size={16} aria-hidden="true" />} title="Copy as Markdown" onSelect={() => { close(); copyMarkdown(); }} />
              <MenuItem icon={<Download01 size={16} aria-hidden="true" />} title="Download .md file" onSelect={() => { close(); downloadMarkdown(); }} />
              <div className="kp-menu-sep" role="separator" />
              <MenuItem danger icon={<Trash01 size={16} aria-hidden="true" />} title="Delete note…" onSelect={() => { close(); setShowDeleteDialog(true); }} />
            </>}
          </Dropdown>
        </div>
      </div>

      {navigationError && <p role="alert" className="kp-nav-error">{navigationError}</p>}

      <div className="kp-layout">
        <main className="kp-main">
          <div className="kp-column">
            {state.conflict && (
              <div className="kp-banner kp-banner-warning" role="alert">
                <AlertTriangle size={18} aria-hidden="true" />
                <span className="kp-banner-msg"><strong>This note was saved from another tab or device since you started editing.</strong> Keep your local changes (overwriting the other save) or reload the latest version (discarding yours).</span>
                <span className="kp-banner-actions">
                  <button type="button" className="kp-pill-btn" onClick={kp.reloadAfterConflict}>Reload latest</button>
                  <button type="button" className="kp-pill-btn kp-pill-solid" onClick={kp.keepMineAfterConflict}>Keep mine</button>
                </span>
              </div>
            )}
            {state.saveStatus === "error" && !state.conflict && !state.uploadError && (
              <div className="kp-banner kp-banner-danger" role="alert">
                <AlertTriangle size={18} aria-hidden="true" />
                <span className="kp-banner-msg"><strong>Save failed.</strong> Your text is safe in the editor. {state.saveErrorMessage}</span>
                <span className="kp-banner-actions">
                  {state.metadataError && <button type="button" className="kp-pill-btn" onClick={kp.discardFailedMetadata}>Discard failed metadata change</button>}
                  <button type="button" className="kp-pill-btn kp-pill-solid" onClick={kp.retryNow}>Retry now</button>
                </span>
              </div>
            )}
            <MarkdownEditor key={editing.id} value={state.bodyMarkdown} onChange={kp.setBodyMarkdown} onUploadImage={kp.uploadImage} onCompositionChange={kp.setComposing} onDismissUploadError={kp.dismissUploadError} header={header} />
          </div>
        </main>

        {!focusMode && (
          <aside className="kp-aside" aria-label="Note details">
            {outline.length > 0 && (
              <section className="kp-side-card">
                <span className="kp-kicker">On this page</span>
                <nav className="kp-toc" aria-label="Outline">
                  {outline.map((h, i) => (
                    <button key={i} type="button" className={`kp-toc-l${h.level}`} onClick={() => jumpTo(i)}>{h.text}</button>
                  ))}
                </nav>
              </section>
            )}

            <section className="kp-side-card">
              <div className="kp-side-head">
                <span className="kp-kicker">Related questions</span>
                <span className="kp-count">{editing.linkedQuestions.length}</span>
              </div>
              {editing.linkedQuestions.filter((l) => l.accessible).map((l) => (
                <article key={l.questionId} className="kp-q">
                  <span className="kp-q-meta">{l.examSlug} · {l.externalId ?? l.questionId.slice(0, 8)}</span>
                  <p className="kp-q-stem">{l.stemExcerpt}</p>
                  <span className="kp-q-actions">
                    <button type="button" className="kp-ghost-btn" onClick={() => l.examId && goToQuestionForReview(l.examId, l.questionId)} title="Opens in Learning mode for review. No attempt is recorded.">Review in Learning</button>
                    <button type="button" className="kp-ghost-btn kp-ghost-muted" onClick={() => { void kp.unlinkQuestion(l.questionId).catch(() => {}); }}>Unlink</button>
                  </span>
                </article>
              ))}
              {unavailable > 0 && (
                <p className="kp-q-gone"><InfoCircle size={16} aria-hidden="true" />{unavailable} linked question{unavailable === 1 ? " is" : "s are"} no longer available to you.</p>
              )}
              {editing.linkedQuestions.length === 0 && <p className="kp-side-empty">Link the questions this note explains, so you can review them together.</p>}
              <button type="button" onClick={() => setShowLinkModal(true)} className="btn btn-secondary btn-block">
                <Plus size={16} aria-hidden="true" />
                Link a question
              </button>
            </section>

            <p className="kp-side-meta">
              Created {new Date(editing.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · Edited {timeOf(editing.updatedAt)}
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
