// implementation — mockup Screen 2.

import { useEffect, useMemo, useState } from "react";
import { marked, type Token, type Tokens } from "marked";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Copy01, DotsHorizontal, Download01, InfoCircle, Maximize01, Plus, Trash01, XClose } from "@untitledui/icons";
import type { Breakpoints } from "../../lib/responsive";
import { useWorkspaceActions } from "../../store/PrepDeckContext";
import { useKnowledgePoints } from "../../store/useKnowledgePoints";
import MarkdownEditor from "../../components/knowledgePoints/MarkdownEditor";
import GroupPicker from "../../components/knowledgePoints/GroupPicker";
import TagPicker from "../../components/knowledgePoints/TagPicker";
import LinkQuestionModal from "../../components/knowledgePoints/LinkQuestionModal";
import DeleteKnowledgePointDialog from "../../components/knowledgePoints/DeleteKnowledgePointDialog";
import { Dropdown, MenuItem } from "../../components/knowledgePoints/EditorMenu";
import { prepareMarkdown } from "../../components/knowledgePoints/editorMarkdown";
import "./KnowledgePointEditor.css";
import { formatDate, formatTime, useI18n } from "../../i18n";

const timeOf = (iso: string) => formatTime(iso, { hour: "2-digit", minute: "2-digit" });

// One quiet line replaces the old status pill, sync card and error card.
function SaveStatus({ status, lastSavedAt, uploading }: { status: string; lastSavedAt: string | null; uploading: number }) {
  const { t } = useI18n();
  if (status === "saving") return <span className="kp-save"><span className="kp-dot" />{uploading ? t("kp.editor.waitingImage") : t("common.saving")}</span>;
  if (status === "error") return <span className="kp-save kp-save-bad"><span className="kp-dot" />{t("kp.editor.notSaved")}</span>;
  if (status === "saved") return <span className="kp-save"><span className="kp-dot kp-dot-ok" />{lastSavedAt ? t("kp.editor.savedAt", { time: timeOf(lastSavedAt) }) : t("kp.editor.saved")}</span>;
  if (status === "unsaved") return <span className="kp-save"><span className="kp-dot" />{t("kp.editor.unsaved")}</span>;
  return null;
}

// The outline lists exactly the headings the visual editor renders at the top
// level of the document, in order, so entry N jumps to top-level heading N.
// Both sides read the same prepared Markdown with the same lexer: headings
// nested in quotes or lists, and anything kept as raw source, appear in neither.
const HEADINGS = ".kp-editor .tiptap > :is(h1, h2, h3)";
const plainText = (tokens: readonly Token[]): string => tokens.map((token) =>
  "tokens" in token && token.tokens ? plainText(token.tokens) : "text" in token ? String(token.text) : "").join("");
function outlineOf(markdown: string) {
  return marked.lexer(prepareMarkdown(markdown))
    .filter((token): token is Tokens.Heading => token.type === "heading" && token.depth <= 3)
    .map((token) => ({ level: token.depth, text: plainText(token.tokens).trim() || token.text }));
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
  const { goToQuestionForReview } = useWorkspaceActions();
  const { t } = useI18n();

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
    catch (error) { setNavigationError(error instanceof Error ? error.message : t("kp.editor.leaveFailed")); }
  };

  const openOther = async (id: string) => {
    try { await kp.flushEditor(); setNavigationError(null); onOpenNote(id); }
    catch (error) { setNavigationError(error instanceof Error ? error.message : t("kp.editor.leaveFailed")); }
  };

  if (state.editorError) return <div role="alert"><p>{state.editorError}</p><button type="button" className="btn btn-primary" onClick={() => kp.openNote(noteId)}>{t("kp.editor.retryLoad")}</button><button type="button" className="btn btn-secondary" onClick={onBack}>{t("kp.list.allNotes")}</button></div>;
  if (state.editorLoading || !editing) {
    return (
      <div className="kp-skeleton" aria-busy="true" aria-label={t("kp.editor.loading")}>
        <span style={{ width: "62%", height: 34 }} /><span style={{ width: 220, height: 30 }} /><span style={{ height: 44 }} />
        <span style={{ width: "96%" }} /><span style={{ width: "88%" }} /><span style={{ width: "70%" }} />
      </div>
    );
  }

  const groupLabel = editing.groupName ?? t("kp.ungrouped");
  const markdownFile = () => `# ${state.title.trim() || t("kp.untitled")}\n\n${state.bodyMarkdown}`;
  const copyMarkdown = () => {
    navigator.clipboard?.writeText(markdownFile()).then(() => setNotice(t("kp.editor.copied")), () => setNotice(t("kp.editor.copyFailed")));
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
    document.querySelectorAll<HTMLElement>(HEADINGS)[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const unavailable = editing.linkedQuestions.filter((l) => !l.accessible).length;

  const header = (
    <>
      <input
        type="text"
        className="kp-title-input"
        aria-label={t("kp.editor.titleLabel")}
        aria-invalid={!state.title.trim()}
        value={state.title}
        onChange={(e) => kp.setTitle(e.target.value)}
        onCompositionStart={() => kp.setComposing(true)}
        onCompositionEnd={() => kp.setComposing(false)}
        placeholder={t("kp.untitled")}
      />
      {!state.title.trim() && <p role="alert" className="kp-title-error">{t("kp.editor.titleRequired")}</p>}
      <div className="kp-props">
        <GroupPicker groups={state.groups} groupId={editing.groupId} groupName={editing.groupName} onSelect={kp.setNoteGroup} onCreate={kp.createGroup} />
        {editing.tags.map((tag) => (
          <span key={tag.id} className="kp-chip kp-chip-tag">
            {tag.name}
            <button type="button" className="kp-chip-x" onClick={() => kp.removeTag(tag.id)} aria-label={t("kp.editor.removeTag", { name: tag.name })}><XClose size={14} aria-hidden="true" /></button>
          </span>
        ))}
        <TagPicker existingTags={state.tags} currentTagIds={editing.tags.map((tag) => tag.id)} onAdd={kp.addTag} />
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
        <nav className="kp-crumbs" aria-label={t("nav.breadcrumb")}>
          <a href="#" onClick={(e) => { e.preventDefault(); backToList(); }}><ArrowLeft size={16} aria-hidden="true" />{t("kp.list.allNotes")}</a>
          <span aria-hidden="true">/</span>
          <span className="kp-crumb-group">{groupLabel}</span>
        </nav>
        <div className="kp-topbar-actions">
          <span role="status" aria-live="polite">{notice ? <span className="kp-save"><span className="kp-dot kp-dot-ok" />{notice}</span> : <SaveStatus status={state.saveStatus} lastSavedAt={state.lastSavedAt} uploading={state.uploading} />}</span>
          {inSequence && (
            <>
              <span className="kp-tb-sep" aria-hidden="true" />
              <span className="kp-count">{t("learning.live.position", { n: idx + 1, total: state.items.length })}</span>
              <button type="button" className="kp-icon-btn kp-icon-btn-lg" disabled={!prevId} onClick={() => prevId && openOther(prevId)} aria-label={t("kp.editor.previousIn", { group: groupLabel })} title={t("kp.editor.previousIn", { group: groupLabel })}><ChevronLeft size={18} /></button>
              <button type="button" className="kp-icon-btn kp-icon-btn-lg" disabled={!nextId} onClick={() => nextId && openOther(nextId)} aria-label={t("kp.editor.nextIn", { group: groupLabel })} title={t("kp.editor.nextIn", { group: groupLabel })}><ChevronRight size={18} /></button>
            </>
          )}
          <span className="kp-tb-sep" aria-hidden="true" />
          <button type="button" className="kp-icon-btn kp-icon-btn-lg kp-focus-toggle" aria-pressed={focusMode} aria-label={t("kp.editor.focusMode")} title={t("kp.editor.focusModeTitle")} onClick={() => setFocusMode((f) => !f)}><Maximize01 size={18} /></button>
          <Dropdown label={t("kp.editor.moreActions")} menuLabel={t("kp.editor.moreActions")} triggerClassName="kp-icon-btn kp-icon-btn-lg" align="end" width={240} trigger={<DotsHorizontal size={18} aria-hidden="true" />}>
            {(close) => <>
              <MenuItem icon={<Copy01 size={16} aria-hidden="true" />} title={t("kp.editor.copyMarkdown")} onSelect={() => { close(); copyMarkdown(); }} />
              <MenuItem icon={<Download01 size={16} aria-hidden="true" />} title={t("kp.editor.download")} onSelect={() => { close(); downloadMarkdown(); }} />
              <div className="kp-menu-sep" role="separator" />
              <MenuItem danger icon={<Trash01 size={16} aria-hidden="true" />} title={t("kp.editor.deleteNote")} onSelect={() => { close(); setShowDeleteDialog(true); }} />
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
                <span className="kp-banner-msg"><strong>{t("kp.editor.conflictTitle")}</strong> {t("kp.editor.conflictBody")}</span>
                <span className="kp-banner-actions">
                  <button type="button" className="kp-pill-btn" onClick={kp.reloadAfterConflict}>{t("kp.editor.reloadLatest")}</button>
                  <button type="button" className="kp-pill-btn kp-pill-solid" onClick={kp.keepMineAfterConflict}>{t("kp.editor.keepMine")}</button>
                </span>
              </div>
            )}
            {state.saveStatus === "error" && !state.conflict && !state.uploadError && (
              <div className="kp-banner kp-banner-danger" role="alert">
                <AlertTriangle size={18} aria-hidden="true" />
                <span className="kp-banner-msg"><strong>{t("kp.editor.saveFailed")}</strong> {t("kp.editor.textSafe")} {state.saveErrorMessage}</span>
                <span className="kp-banner-actions">
                  {state.metadataError && <button type="button" className="kp-pill-btn" onClick={kp.discardFailedMetadata}>{t("kp.editor.discardMetadata")}</button>}
                  <button type="button" className="kp-pill-btn kp-pill-solid" onClick={kp.retryNow}>{t("kp.editor.retryNow")}</button>
                </span>
              </div>
            )}
            <MarkdownEditor key={editing.id} value={state.bodyMarkdown} onChange={kp.setBodyMarkdown} onUploadImage={kp.uploadImage} onCompositionChange={kp.setComposing} onDismissUploadError={kp.dismissUploadError} header={header} />
          </div>
        </main>

        {!focusMode && (
          <aside className="kp-aside" aria-label={t("kp.editor.details")}>
            {outline.length > 0 && (
              <section className="kp-side-card">
                <span className="kp-kicker">{t("kp.editor.onThisPage")}</span>
                <nav className="kp-toc" aria-label={t("kp.editor.outline")}>
                  {outline.map((h, i) => (
                    <button key={i} type="button" className={`kp-toc-l${h.level}`} onClick={() => jumpTo(i)}>{h.text}</button>
                  ))}
                </nav>
              </section>
            )}

            <section className="kp-side-card">
              <div className="kp-side-head">
                <span className="kp-kicker">{t("kp.editor.relatedQuestions")}</span>
                <span className="kp-count">{editing.linkedQuestions.length}</span>
              </div>
              {editing.linkedQuestions.filter((l) => l.accessible).map((l) => (
                <article key={l.questionId} className="kp-q">
                  <span className="kp-q-meta">{l.examSlug} · {l.externalId ?? l.questionId.slice(0, 8)}</span>
                  <p className="kp-q-stem">{l.stemExcerpt}</p>
                  <span className="kp-q-actions">
                    <button type="button" className="kp-ghost-btn" onClick={() => l.examId && goToQuestionForReview(l.examId, l.questionId)} title={t("kp.reviewInLearningTitle")}>{t("kp.reviewInLearning")}</button>
                    <button type="button" className="kp-ghost-btn kp-ghost-muted" onClick={() => { void kp.unlinkQuestion(l.questionId).catch(() => {}); }}>{t("kp.unlink")}</button>
                  </span>
                </article>
              ))}
              {unavailable > 0 && (
                <p className="kp-q-gone"><InfoCircle size={16} aria-hidden="true" />{t("kp.editor.unavailable", { count: unavailable })}</p>
              )}
              {editing.linkedQuestions.length === 0 && <p className="kp-side-empty">{t("kp.editor.linkHint")}</p>}
              <button type="button" onClick={() => setShowLinkModal(true)} className="btn btn-secondary btn-block">
                <Plus size={16} aria-hidden="true" />
                {t("kp.editor.linkQuestion")}
              </button>
            </section>

            <p className="kp-side-meta">
              {t("kp.editor.meta", { created: formatDate(editing.createdAt, { month: "short", day: "numeric" }), edited: timeOf(editing.updatedAt) })}
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
