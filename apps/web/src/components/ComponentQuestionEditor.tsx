import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { exportComponentPackage, formatAnswerText, type Question } from "@prepdeck/shared";
import { apiFetch } from "../lib/api";
import { inspectComponentQuestionDraft } from "../lib/componentQuestionDraft";
import QuestionContent from "./QuestionContent";
import { useQuestionDraftGuard } from "./QuestionDraftGuard";

export default function ComponentQuestionEditor({ examId, question, onClose, onSaved }: {
  examId: string; question: Question; onClose: () => void; onSaved: (q: Question, next: boolean) => void;
}) {
  const initial = useRef(JSON.stringify(exportComponentPackage({ id: examId, name: examId }, [{ ...question, externalId: question.externalId ?? question.id, options: question.options ?? undefined }]), null, 2));
  const [text, setText] = useState(initial.current), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), saving = useRef(false);
  const backdropPress = useRef(false);
  const feedbackId = useId();
  const { preview, issues, syntaxError } = useMemo(() => inspectComponentQuestionDraft(text), [text]);
  const invalid = Boolean(syntaxError || issues.length);
  const dirty = text !== initial.current;
  const close = async () => { if (await guard.requestDiscard()) onClose(); };
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const save = async () => {
    if (saving.current) return;
    if (!preview) { setError("Enter a valid package with exactly one question. Check component IDs, references and scoring."); return; }
    saving.current = true; setBusy(true); setError("");
    try {
      const result = await apiFetch<{ question: Question }>(`/api/exams/${examId}/questions/${question.id}`, { method: "PATCH", body: JSON.stringify({ ...preview, expectedRevision: question.revision }) });
      initial.current = text; onSaved(result.question, false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save question"); }
    finally { saving.current = false; setBusy(false); }
  };
  const guard = useQuestionDraftGuard(dirty, saving, () => { void save(); });
  return <><dialog ref={dialog} className="question-drawer-backdrop" aria-label="Edit component question" onKeyDown={guard.onKeyDown}
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
    <div className="question-drawer question-editor"><div className="question-drawer-body">
      <h3>Edit component question</h3><p>Edit the structured package. The preview updates when the question is valid.</p>
      <label>Question package JSON<textarea className="input" rows={18} style={{ width: "100%", fontFamily: "monospace" }} value={text} disabled={busy} aria-invalid={invalid} aria-describedby={feedbackId} onChange={e => setText(e.target.value)} /></label>
      <div id={feedbackId} className="authoring-errors" aria-live="polite" hidden={!invalid}>
        {syntaxError && <p>JSON syntax error{syntaxError.line !== undefined && syntaxError.column !== undefined ? ` at line ${syntaxError.line}, column ${syntaxError.column}` : ""}: {syntaxError.message}</p>}
        {issues.length > 0 && <><p>Package validation errors:</p><ul>{issues.map((issue, index) => <li key={index}><code>{issue.path}</code>: {issue.message}</li>)}</ul></>}
      </div>
      {error && <p role="alert">{error}</p>}
      {preview && <section aria-label="Component question preview"><QuestionContent src={preview.stem} content={preview.content} />{preview.options?.map(o => <div key={o.id}><strong>{o.id}</strong><QuestionContent src={o.text} content={preview.content} optionId={o.id} /></div>)}<p>Correct response: {formatAnswerText(preview, preview.correctAnswers)}</p></section>}
    </div><div className="question-drawer-footer"><div className="dialog-actions"><p role="status" className="authoring-save-status">{dirty ? "Unsaved changes" : "No unsaved changes"}</p><button className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy || !preview} onClick={save}>Save</button></div></div></div>
  </dialog>{guard.confirmation}</>;
}
