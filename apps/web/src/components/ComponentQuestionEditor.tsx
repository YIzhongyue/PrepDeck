import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { exportComponentPackage, normalizeImportFile, validateImportFile, type Question } from "@prepdeck/shared";
import { apiFetch } from "../lib/api";
import QuestionContent from "./QuestionContent";

export default function ComponentQuestionEditor({ examId, question, onClose, onSaved }: {
  examId: string; question: Question; onClose: () => void; onSaved: (q: Question, next: boolean) => void;
}) {
  const initial = useRef(JSON.stringify(exportComponentPackage({ id: examId, name: examId }, [{ ...question, externalId: question.externalId ?? question.id, options: question.options ?? undefined }]), null, 2));
  const [text, setText] = useState(initial.current), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), saving = useRef(false), saved = useRef(false);
  const dirty = text !== initial.current;
  const canClose = () => !saving.current && (saved.current || !dirty || window.confirm("Discard unsaved question changes?"));
  const close = () => { if (canClose()) onClose(); };
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.current?.showModal(); document.body.style.overflow = "hidden";
    return () => { dialog.current?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (dirty || saving.current) { e.preventDefault(); e.returnValue = ""; } };
    const navigate = (e: Event) => { if (!canClose()) e.preventDefault(); };
    window.addEventListener("beforeunload", leave); window.addEventListener("prepdeck:before-navigate", navigate);
    return () => { window.removeEventListener("beforeunload", leave); window.removeEventListener("prepdeck:before-navigate", navigate); };
  }, [dirty]);
  let preview: ReturnType<typeof normalizeImportFile>["questions"][number] | undefined;
  try { const data = JSON.parse(text); if (data.schemaVersion === "2.0" && !validateImportFile(data).issues.length && data.questions.length === 1) preview = normalizeImportFile(data).questions[0]; } catch { /* Keep invalid drafts editable. */ }
  const save = async () => {
    if (saving.current) return;
    if (!preview) { setError("Enter a valid package with exactly one question. Check component IDs, references and scoring."); return; }
    saving.current = true; setBusy(true); setError("");
    try {
      const result = await apiFetch<{ question: Question }>(`/api/exams/${examId}/questions/${question.id}`, { method: "PATCH", body: JSON.stringify({ ...preview, expectedRevision: question.revision }) });
      saved.current = true; onSaved(result.question, false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save question"); }
    finally { saving.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="question-drawer-backdrop" aria-label="Edit component question" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="question-drawer question-editor"><div className="question-drawer-body">
      <h3>Edit component question</h3><p>Edit the structured package. The preview updates when the question is valid.</p>
      <label>Question package JSON<textarea className="input" rows={18} style={{ width: "100%", fontFamily: "monospace" }} value={text} disabled={busy} onChange={e => setText(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      {preview && <section aria-label="Component question preview"><QuestionContent src={preview.stem} content={preview.content} />{preview.options?.map(o => <div key={o.id}><strong>{o.id}</strong><QuestionContent src={o.text} content={preview.content} optionId={o.id} /></div>)}<p>Correct response: {preview.correctAnswers.join(", ")}</p></section>}
    </div><div className="question-drawer-footer"><div className="dialog-actions"><button className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy || !preview} onClick={save}>Save</button></div></div></div>
  </dialog>;
}
