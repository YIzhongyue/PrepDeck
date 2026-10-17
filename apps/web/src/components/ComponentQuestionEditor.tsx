import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { exportComponentPackage, formatAnswerText, type Question } from "@prepdeck/shared";
import { ApiError, apiFetch } from "../lib/api";
import { inspectComponentQuestionDraft } from "../lib/componentQuestionDraft";
import { formatJsonSource, type JsonSelection } from "../lib/formatJsonSource";
import QuestionContent from "./QuestionContent";
import { useQuestionDraftGuard } from "./QuestionDraftGuard";

type ComponentQuestionEditorProps = {
  examId: string; question: Question; onClose: () => void; onSaved: (q: Question, next: boolean) => void;
};

type JsonPosition = JsonSelection & { top: number; left: number; paneTop: number };
function packageText(examId: string, question: Question) {
  return JSON.stringify(exportComponentPackage({ id: examId, name: examId }, [{ ...question, externalId: question.externalId ?? question.id, options: question.options ?? undefined }]), null, 2);
}
function changedFields(before: Question, after: Question) {
  const fields: [string, unknown, unknown][] = [
    ["External ID", before.externalId, after.externalId],
    ["Question body", before.content?.body, after.content?.body],
    ["Interaction", before.content?.interaction, after.content?.interaction],
    ["Shared material", before.content?.stimuli, after.content?.stimuli],
    ["Assets", before.content?.assets, after.content?.assets],
    ["Correct response", before.correctAnswers, after.correctAnswers],
    ["Official explanation", before.explanation, after.explanation],
    ["Tags", before.tags, after.tags], ["Difficulty", before.difficulty, after.difficulty],
    ["Needs review", before.needsReview, after.needsReview], ["Points", before.points, after.points],
    ["Archive status", before.archivedAt, after.archivedAt]
  ];
  return fields.filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b)).map(([label]) => label);
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
  const textarea = useRef<HTMLTextAreaElement>(null), pane = useRef<HTMLDivElement>(null);
  const editScroll = useRef<{ top: number; left: number; paneTop: number } | null>(null);
  const { preview, issues, syntaxError } = useMemo(() => inspectComponentQuestionDraft(text), [text]);
  const lastValidPreview = useRef(preview);
  useLayoutEffect(() => { if (preview) lastValidPreview.current = preview; }, [preview]);
  const shownPreview = preview ?? lastValidPreview.current;
  const invalid = Boolean(syntaxError || issues.length);
  const dirty = text !== initial.current;
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
        if (!applied) throw new Error("Could not format JSON while preserving undo history. Your source has been kept.");
        setText(field.value);
      }
      restoreJsonPosition(field, pane.current, position);
      if (result) setError("");
    } catch (e) {
      restoreJsonPosition(field, pane.current, { ...selection, ...scroll });
      setError(e instanceof Error ? e.message : "Could not format JSON. Your source has been kept.");
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
      setError(e instanceof Error ? e.message : "Could not save question");
      setStale(e instanceof ApiError && e.status === 409 && (e.body as { code?: string } | null)?.code === "stale_question");
    } }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  };
  const guard = useQuestionDraftGuard(dirty, saving, () => { void save(); });
  const loadLatest = async (keepDraft: boolean) => {
    if (saving.current) return;
    if (!keepDraft && !await guard.requestDiscard({ title: "Discard edits and load latest?", description: "Your raw JSON will be replaced with the latest saved question.", action: "Discard and load latest" })) return;
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
      setRebased(`Loaded revision ${latest.revision}. ${changed.length ? `Changed since revision ${base.revision}: ${changed.join(", ")}.` : `No content changes since revision ${base.revision}.`} ${keepDraft ? "Your raw JSON is kept." : "Your draft now matches the latest saved question."} Review the question, then Save when ready.`);
    } catch (e) { if (mounted.current) {
      requestFailed.current = true;
      setError(`Could not load the latest version: ${e instanceof Error ? e.message : "Please try again."}`);
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
        <div className="authoring-toolbar"><h3 id={titleId} className="dialog-title">Edit component question</h3>
          <button type="button" className="btn btn-ghost question-drawer-close" aria-label="Close question editor" disabled={busy} onClick={close}>×</button></div>
        <p className="authoring-identifier component-editor-identity"><span>#{base.sequenceNumber}</span><span className="authoring-external-id" title={base.id}>ID: {base.id}</span><span>revision {base.revision}</span></p>
      </header>
      <div ref={pane} className="question-drawer-body" tabIndex={-1}>
      <p>Edit the structured package. The preview updates when the question is valid.</p>
      <div ref={recovery} tabIndex={-1} hidden={!rebased}><p role="status" className="authoring-rebased">{rebased}</p></div>
      {(error || stale) && <div ref={serverFeedback} role="alert" className="authoring-errors" tabIndex={-1}><p>{error || "This question has changed."}{stale && " Your raw JSON is kept."}</p>
        {stale && <div className="authoring-toolbar">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => loadLatest(true)}>Load latest and keep my edits</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => loadLatest(false)}>Discard my edits</button>
        </div>}</div>}
      <div><button type="button" className="btn btn-secondary" disabled={busy} onClick={formatText}>Format JSON</button></div>
      <label>Question package JSON<textarea ref={textarea} className="input" rows={18} style={{ width: "100%", fontFamily: "monospace" }} value={text} disabled={busy} aria-invalid={invalid} aria-describedby={feedbackId}
        onBlur={e => { editScroll.current = { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft, paneTop: pane.current?.scrollTop ?? 0 }; }}
        onChange={e => setText(e.target.value)} /></label>
      <div ref={feedback} id={feedbackId} className="authoring-errors" role="region" aria-label="Question package errors" tabIndex={-1} aria-live="polite" hidden={!invalid}>
        {syntaxError && <p>JSON syntax error{syntaxError.line !== undefined && syntaxError.column !== undefined ? ` at line ${syntaxError.line}, column ${syntaxError.column}` : ""}: {syntaxError.message}</p>}
        {issues.length > 0 && <><p>Package validation errors:</p><ul>{issues.map((issue, index) => <li key={index}><code>{issue.path}</code>: {issue.message}</li>)}</ul></>}
      </div>
      <section aria-label="Component question preview">
        <p role="status" hidden={Boolean(preview)}>{shownPreview ? "Preview is out of date. Showing the most recent valid draft." : "No valid preview yet. Correct the package errors to see a preview."}</p>
        {shownPreview && <><QuestionContent src={shownPreview.stem} content={shownPreview.content} />{shownPreview.options?.map(o => <div key={o.id}><strong>{o.id}</strong><QuestionContent src={o.text} content={shownPreview.content} optionId={o.id} /></div>)}<p>Correct response: {formatAnswerText(shownPreview, shownPreview.correctAnswers)}</p></>}
      </section>
    </div><footer className="question-drawer-footer"><div className="dialog-actions"><p role="status" className="authoring-save-status">{dirty ? "Unsaved changes" : "No unsaved changes"}</p><button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={save}>Save</button></div></footer></div>
  </dialog>{guard.confirmation}</>;
}
