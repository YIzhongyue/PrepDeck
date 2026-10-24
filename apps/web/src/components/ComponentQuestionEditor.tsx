import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { exportComponentPackage, formatAnswerText, type Question } from "@prepdeck/shared";
import { ApiError, apiFetch } from "../lib/api";
import { inspectComponentQuestionDraft } from "../lib/componentQuestionDraft";
import { formatJsonSource, type JsonSelection } from "../lib/formatJsonSource";
import { inspectAnswerControls } from "../lib/componentAnswerControls";
import ComponentAnswerControls, { AnswerOption } from "./ComponentAnswerControls";
import QuestionContent from "./QuestionContent";
import { useQuestionDraftGuard } from "./QuestionDraftGuard";
import { t as translate, useI18n, type TranslationKey } from "../i18n";

type ComponentQuestionEditorProps = {
  examId: string; question: Question; onClose: () => void; onSaved: (q: Question, next: boolean) => void;
};

type JsonPosition = JsonSelection & { top: number; left: number; paneTop: number };
function packageText(examId: string, question: Question) {
  return JSON.stringify(exportComponentPackage({ id: examId, name: examId }, [{ ...question, externalId: question.externalId ?? question.id, options: question.options ?? undefined }]), null, 2);
}
function changedFields(before: Question, after: Question) {
  const fields: [TranslationKey, unknown, unknown][] = [
    ["authoring.fields.externalId", before.externalId, after.externalId],
    ["authoring.component.fields.body", before.content?.body, after.content?.body],
    ["authoring.component.fields.interaction", before.content?.interaction, after.content?.interaction],
    ["authoring.component.fields.stimuli", before.content?.stimuli, after.content?.stimuli],
    ["authoring.component.fields.assets", before.content?.assets, after.content?.assets],
    ["authoring.component.fields.correctResponse", before.correctAnswers, after.correctAnswers],
    ["authoring.fields.explanation", before.explanation, after.explanation],
    ["authoring.fields.tags", before.tags, after.tags], ["authoring.fields.difficulty", before.difficulty, after.difficulty],
    ["authoring.fields.needsReview", before.needsReview, after.needsReview], ["authoring.fields.points", before.points, after.points],
    ["authoring.component.fields.archive", before.archivedAt, after.archivedAt]
  ];
  return fields.filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b)).map(([label]) => translate(label));
}
function restoreJsonPosition(field: HTMLTextAreaElement, pane: HTMLDivElement | null, position: JsonPosition) {
  field.focus({ preventScroll: true });
  field.setSelectionRange(position.start, position.end, position.direction);
  field.scrollTop = position.top; field.scrollLeft = position.left;
  if (pane) pane.scrollTop = position.paneTop;
}

export default function ComponentQuestionEditor(props: ComponentQuestionEditorProps) {
  // A new identity starts a new editing session, including its raw text,
  // baseline, pending confirmation and retained preview.
  return <ComponentQuestionEditorSession key={JSON.stringify([props.examId, props.question.id])} {...props} />;
}

function ComponentQuestionEditorSession({ examId, question, onClose, onSaved }: ComponentQuestionEditorProps) {
  const [openingText] = useState(() => packageText(examId, question));
  const initial = useRef(openingText);
  const [base, setBase] = useState(question), [stale, setStale] = useState(false), [rebased, setRebased] = useState("");
  const [text, setText] = useState(initial.current), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), saving = useRef(false), mounted = useRef(false);
  const backdropPress = useRef(false);
  const feedbackId = useId(), titleId = useId();
  const recovery = useRef<HTMLDivElement>(null), serverFeedback = useRef<HTMLDivElement>(null);
  const requestFailed = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const textarea = useRef<HTMLTextAreaElement>(null), pane = useRef<HTMLDivElement>(null);
  const editScroll = useRef<{ top: number; left: number; paneTop: number } | null>(null);
  const [mode, setMode] = useState<"json" | "answers">("json");
  const [answerMessage, setAnswerMessage] = useState("");
  const jsonView = useRef<HTMLDivElement>(null), answersView = useRef<HTMLDivElement>(null);
  const jsonPosition = useRef<JsonPosition | null>(null), answerFocus = useRef<HTMLElement | null>(null);
  const draft = useMemo(() => inspectComponentQuestionDraft(text), [text]);
  const controls = useMemo(() => inspectAnswerControls(text, draft), [text, draft]);
  const showAnswers = mode === "answers" && Boolean(controls.preview);
  useLayoutEffect(() => {
    if (mode === "answers" && !controls.preview) {
      setMode("json"); textarea.current?.focus({ preventScroll: true });
    }
  }, [mode, controls.preview]);
  const { preview, issues, syntaxError } = draft;
  const lastValidPreview = useRef(preview);
  useLayoutEffect(() => { if (preview) lastValidPreview.current = preview; }, [preview]);
  const shownPreview = preview ?? lastValidPreview.current;
  const invalid = Boolean(syntaxError || issues.length);
  const dirty = text !== initial.current;
  const switchMode = (next: "json" | "answers") => {
    if (saving.current || next === mode) return;
    const field = textarea.current;
    if (next === "answers" && field) {
      jsonPosition.current = { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection,
        top: field.scrollTop, left: field.scrollLeft, paneTop: pane.current?.scrollTop ?? 0 };
    }
    setMode(next);
  };
  useLayoutEffect(() => {
    if (showAnswers) {
      (answerFocus.current?.isConnected ? answerFocus.current : answersView.current)?.focus({ preventScroll: true });
    } else if (jsonPosition.current && textarea.current) {
      restoreJsonPosition(textarea.current, pane.current, jsonPosition.current);
    }
    // Restore only on a view change; typing must keep its native caret.
  }, [showAnswers]);
  const nativeAnswerEdit = (command: "insertText" | "undo" | "redo", next?: string) => {
    const field = textarea.current, wrapper = jsonView.current;
    if (saving.current || !field || !wrapper) return false;
    if (command === "insertText" && next === text) return false;
    const active = document.activeElement as HTMLElement | null;
    const position = { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection,
      top: field.scrollTop, left: field.scrollLeft, paneTop: pane.current?.scrollTop ?? 0 };
    // A display:none textarea cannot receive a native edit. Reveal synchronously
    // for the command and restore before paint; never remount or assign value.
    const hidden = wrapper.hidden;
    wrapper.hidden = false;
    try {
      field.focus({ preventScroll: true });
      if (command === "insertText") field.setSelectionRange(0, field.value.length);
      const applied = typeof document.execCommand === "function" && document.execCommand(command, false, next);
      if (!applied && command === "insertText") throw new Error(translate("authoring.component.answerEditFailed"));
      setText(field.value); setError("");
      if (applied && command !== "insertText") setAnswerMessage(translate(command === "undo" ? "authoring.component.previousRestored" : "authoring.component.nextRestored"));
      return applied;
    } catch {
      setError(translate("authoring.component.answerEditFailed"));
      return false;
    } finally {
      field.setSelectionRange(position.start, position.end, position.direction);
      field.scrollTop = position.top; field.scrollLeft = position.left;
      wrapper.hidden = hidden;
      active?.focus({ preventScroll: true });
      if (pane.current) pane.current.scrollTop = position.paneTop;
    }
  };
  useLayoutEffect(() => {
    // Disabling the active control can move browser focus to the page body.
    // Only request completion moves focus to failure feedback. Formatter errors
    // keep the textarea's native history, selection and restored editing focus.
    if (busy) pane.current?.focus({ preventScroll: true });
    else if (requestFailed.current) { requestFailed.current = false; serverFeedback.current?.focus(); }
  }, [busy, error]);
  useLayoutEffect(() => { if (rebased) recovery.current?.focus(); }, [rebased]);
  const formatText = () => {
    const field = textarea.current;
    if (saving.current || !field) return;
    const selection: JsonSelection = { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection };
    const scroll = document.activeElement !== field && editScroll.current
      ? editScroll.current : { top: field.scrollTop, left: field.scrollLeft, paneTop: pane.current?.scrollTop ?? 0 };
    try {
      const result = formatJsonSource(text, selection);
      const position = { ...(result?.selection ?? selection), ...scroll };
      if (result && result.text !== text) {
        field.focus({ preventScroll: true });
        field.setSelectionRange(0, field.value.length);
        // A native text edit preserves undo/redo. Assigning the textarea value
        // through React would clear that history. There is no value-setter fallback.
        let applied = false;
        try { applied = typeof document.execCommand === "function" && document.execCommand("insertText", false, result.text); } catch { /* Report unsupported native editing below. */ }
        if (!applied) throw new Error(translate("authoring.component.formatUndoFailed"));
        setText(field.value);
      }
      restoreJsonPosition(field, pane.current, position);
      if (result) setError("");
    } catch (e) {
      restoreJsonPosition(field, pane.current, { ...selection, ...scroll });
      setError(e instanceof Error ? e.message : translate("authoring.component.formatFailed"));
    }
  };
  const close = async () => { if (await guard.requestDiscard()) onClose(); };
  useLayoutEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = "hidden";
    // Keep the initial editing focus now that a toolbar action precedes the field.
    textarea.current?.focus({ preventScroll: true });
    return () => { mounted.current = false; element?.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const save = async () => {
    if (saving.current) return;
    // The retained preview is display-only: only the current validated text
    // may supply a save payload. Invalid attempts reveal the current errors.
    if (!preview) { feedback.current?.focus(); return; }
    saving.current = true; setBusy(true); setError("");
    try {
      const result = await apiFetch<{ question: Question }>(`/api/exams/${examId}/questions/${base.id}`, { method: "PATCH", body: JSON.stringify({ ...preview, expectedRevision: base.revision }) });
      if (!mounted.current) return;
      initial.current = text; onSaved(result.question, false);
    } catch (e) { if (mounted.current) {
      requestFailed.current = true;
      setError(e instanceof Error ? e.message : translate("authoring.component.saveFailed"));
      setStale(e instanceof ApiError && e.status === 409 && (e.body as { code?: string } | null)?.code === "stale_question");
    } }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  };
  const guard = useQuestionDraftGuard(dirty, saving, () => { void save(); });
  const loadLatest = async (keepDraft: boolean) => {
    if (saving.current) return;
    if (!keepDraft && !await guard.requestDiscard({ title: translate("authoring.editor.discardLatestTitle"), description: translate("authoring.component.discardLatestBody"), action: translate("authoring.editor.discardLatestAction") })) return;
    if (saving.current || !mounted.current) return;
    saving.current = true; setBusy(true);
    try {
      const { question: latest } = await apiFetch<{ question: Question }>(`/api/exams/${examId}/questions/${base.id}`);
      if (!mounted.current) return;
      // Validate/export before changing any baseline. A failed load or export
      // leaves the raw draft, revision, retained preview and retry actions intact.
      const latestText = packageText(examId, latest), changed = changedFields(base, latest);
      initial.current = latestText; setBase(latest); setError(""); setStale(false);
      if (!keepDraft) setText(latestText);
      setRebased([
        translate("authoring.editor.loadedRevision", { revision: String(latest.revision) }),
        changed.length
          ? translate("authoring.component.changedSinceRevision", { revision: String(base.revision), fields: changed.join(translate("common.listSeparator")) })
          : translate("authoring.component.noChangesSince", { revision: String(base.revision) }),
        translate(keepDraft ? "authoring.component.rawKept" : "authoring.component.draftMatches"),
        translate("authoring.component.reviewThenSave"),
      ].join(" "));
    } catch (e) { if (mounted.current) {
      requestFailed.current = true;
      setError(translate("authoring.editor.loadLatestFailedReason", { reason: e instanceof Error ? e.message : translate("authoring.component.tryAgain") }));
    } }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  };
  return <><dialog ref={dialog} className="question-drawer-backdrop" aria-labelledby={titleId} aria-modal="true" aria-busy={busy} onKeyDown={guard.onKeyDown}
    onCancel={e => { e.preventDefault(); close(); }}
    onPointerDown={e => { backdropPress.current = e.isPrimary && e.button === 0 && e.target === e.currentTarget; }}
    onPointerCancel={() => { backdropPress.current = false; }}
    onClick={e => {
      const startedOutside = backdropPress.current; backdropPress.current = false;
      if (e.target !== e.currentTarget) return;
      e.preventDefault(); e.stopPropagation();
      // A click may target the common ancestor when a selection starts in the
      // editor and ends outside it. Only a press that began on the wash closes.
      if (startedOutside) close();
    }}>
    <div className="question-drawer question-editor">
      <header className="question-drawer-header">
        <div className="authoring-toolbar"><h3 id={titleId} className="dialog-title">{t("authoring.component.title")}</h3>
          <button type="button" className="btn btn-ghost question-drawer-close" aria-label={t("authoring.editor.close")} disabled={busy} onClick={close}>×</button></div>
        <p className="authoring-identifier component-editor-identity"><span>#{base.sequenceNumber}</span><span className="authoring-external-id" title={base.id}>{t("authoring.list.id", { id: base.id })}</span><span>{t("authoring.editor.revision", { revision: String(base.revision) })}</span></p>
      </header>
      <div ref={pane} className="question-drawer-body" tabIndex={-1}>
      <p>{t("authoring.component.intro")}</p>
      <div ref={recovery} tabIndex={-1} hidden={!rebased}><p role="status" className="authoring-rebased">{rebased}</p></div>
      {(error || stale) && <div ref={serverFeedback} role="alert" className="authoring-errors" tabIndex={-1}><p>{error || t("authoring.component.changed")}{stale && ` ${t("authoring.component.rawKept")}`}</p>
        {stale && <div className="authoring-toolbar">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => loadLatest(true)}>{t("authoring.editor.loadKeep")}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => loadLatest(false)}>{t("authoring.editor.discardMine")}</button>
        </div>}</div>}
      <div role="group" aria-label={t("authoring.component.view")} className="authoring-toolbar component-view-toggle">
        <button type="button" className="btn btn-secondary" aria-pressed={!showAnswers} disabled={busy} onClick={() => switchMode("json")}>JSON</button>
        <button type="button" className="btn btn-secondary" aria-pressed={showAnswers} disabled={busy || !controls.preview} onClick={() => switchMode("answers")}>{t("authoring.component.answerControls")}</button>
      </div>
      {!controls.preview && <p>{controls.reason}</p>}
      <div ref={answersView} hidden={!showAnswers} tabIndex={-1} onBlurCapture={event => { answerFocus.current = event.target as HTMLElement; }} onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
          event.preventDefault(); nativeAnswerEdit(event.shiftKey || event.key.toLowerCase() === "y" ? "redo" : "undo");
        }
      }}><ComponentAnswerControls state={controls} raw={text} disabled={busy} change={next => nativeAnswerEdit("insertText", next)} message={answerMessage} announce={setAnswerMessage} /></div>
      <div ref={jsonView} hidden={showAnswers}>
      <div><button type="button" className="btn btn-secondary" disabled={busy} onClick={formatText}>{t("authoring.component.formatJson")}</button></div>
      <label>{t("authoring.component.packageJson")}<textarea ref={textarea} className="input" rows={18} style={{ width: "100%", fontFamily: "monospace" }} value={text} disabled={busy} aria-invalid={invalid} aria-describedby={feedbackId}
        onBlur={e => { editScroll.current = { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft, paneTop: pane.current?.scrollTop ?? 0 }; }}
        onChange={e => { setText(e.target.value); setAnswerMessage(""); }} /></label>
      </div>
      <div ref={feedback} id={feedbackId} className="authoring-errors" role="region" aria-label={t("authoring.component.packageErrors")} tabIndex={-1} aria-live="polite" hidden={!invalid}>
        {syntaxError && <p>{syntaxError.line !== undefined && syntaxError.column !== undefined
          ? t("authoring.component.syntaxErrorAt", { line: String(syntaxError.line), column: String(syntaxError.column), message: syntaxError.message })
          : t("authoring.component.syntaxError", { message: syntaxError.message })}</p>}
        {issues.length > 0 && <><p>{t("authoring.component.validationErrors")}</p><ul>{issues.map((issue, index) => <li key={index}><code>{issue.path}</code>: {issue.message}</li>)}</ul></>}
      </div>
      <section className="component-editor-preview" aria-label={t("authoring.component.preview")}>
        <p role="status" hidden={Boolean(preview)}>{t(shownPreview ? "authoring.component.previewStale" : "authoring.component.previewNone")}</p>
        {shownPreview && <><QuestionContent src={shownPreview.stem} content={shownPreview.content} />{shownPreview.content?.interaction.type === "match" ?
          ([["left", shownPreview.content.interaction.left], ["right", shownPreview.content.interaction.right]] as const).map(([side, options]) => <section key={side} aria-label={t(`authoring.component.${side}PreviewItems`)}>{options.map(option => <div key={option.id}><strong>{t(`authoring.answers.${side}Id`, { id: option.id })}</strong><AnswerOption option={option} content={shownPreview.content!} /></div>)}</section>) :
          shownPreview.options?.map(o => <div key={o.id}><strong>{o.id}</strong><QuestionContent src={o.text} content={shownPreview.content} optionId={o.id} /></div>)}<p>{t("study.structured.correctResponse", { response: formatAnswerText(shownPreview, shownPreview.correctAnswers) })}</p></>}
      </section>
    </div><footer className="question-drawer-footer"><div className="dialog-actions"><p role="status" className="authoring-save-status">{t(dirty ? "kp.editor.unsaved" : "authoring.editor.noUnsaved")}</p><button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>{t("common.cancel")}</button><button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{t("common.save")}</button></div></footer></div>
  </dialog>{guard.confirmation}</>;
}
