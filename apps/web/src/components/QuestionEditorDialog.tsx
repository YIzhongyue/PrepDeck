import ComponentQuestionEditor from "./ComponentQuestionEditor";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IMPORT_LIMITS, normalizeTagKey, validateQuestionRow, type Question, type QuestionType, type ValidationIssue } from "@prepdeck/shared";
import { apiFetch, ApiError } from "../lib/api";
import { blankQuestion, formPayload, questionForm, type QuestionForm } from "../lib/questionAuthoring";
import QuestionContent from "./QuestionContent";
import QuestionTagPicker from "./QuestionTagPicker";

function LegacyQuestionEditorDialog({ examId, question, initialType, onClose, onSaved }: {
  examId: string; question: Question | null; initialType: QuestionType;
  onClose: () => void; onSaved: (question: Question, addNext: boolean) => void;
}) {
  const [initial] = useState(() => question ? questionForm(question) : blankQuestion(initialType));
  const [form, setForm] = useState(initial);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const saving = useRef(false), saved = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null), stem = useRef<HTMLTextAreaElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const mayLeave = () => !saving.current && (saved.current || !dirty || window.confirm("Discard unsaved question changes?"));
  const close = () => { if (mayLeave()) onClose(); };
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    // The browser's top layer escapes transformed/contained admin layouts
    // while retaining inherited theme tokens and making the background inert.
    element?.showModal();
    document.body.style.overflow = "hidden";
    stem.current?.focus({ preventScroll: true });
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => { if (issues.length) dialog.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(); }, [issues]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (!saved.current && (dirty || saving.current)) { e.preventDefault(); e.returnValue = ""; } };
    const navigate = (e: Event) => { if (!mayLeave()) e.preventDefault(); };
    window.addEventListener("beforeunload", unload); window.addEventListener("prepdeck:before-navigate", navigate);
    return () => { window.removeEventListener("beforeunload", unload); window.removeEventListener("prepdeck:before-navigate", navigate); };
  }, [dirty]);
  const change = <K extends keyof QuestionForm>(key: K, value: QuestionForm[K]) => setForm(f => ({ ...f, [key]: value }));
  const fieldErrors = (field: string) => issues.filter(i => i.path === `$.${field}` || i.path.startsWith(`$.${field}[`) || i.path.startsWith(`$.${field}.`));
  const errors = (field: string) => <div id={`error-${field}`} className="authoring-errors">{fieldErrors(field).map((i, n) => <div key={n}>{i.path.replace("$.", "")}: {i.message}</div>)}</div>;
  const accessibility = (field: string) => ({ "aria-invalid": fieldErrors(field).length > 0, "aria-describedby": `error-${field}` });
  const save = async (addNext: boolean) => {
    if (saving.current) return;
    const body = formPayload(form);
    const problems = validateQuestionRow(body, "$");
    setIssues(problems); setError("");
    if (problems.length) { dialog.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(); return; }
    saving.current = true; setBusy(true);
    try {
      const { question: result } = await apiFetch<{ question: Question }>(`/api/exams/${examId}/questions${question ? `/${question.id}` : ""}`, {
        method: question ? "PATCH" : "POST", body: JSON.stringify({ ...body, externalId: form.externalId || null, expectedRevision: question?.revision }) });
      saved.current = true;
      onSaved(result, addNext);
    } catch (err) {
      const details = err instanceof ApiError ? err.body as { issues?: ValidationIssue[] } : null;
      setIssues(details?.issues ?? []);
      setError(err instanceof Error ? err.message : "Could not save this question. Your input has been kept.");
    } finally { saving.current = false; setBusy(false); }
  };
  const selectType = (type: QuestionType) => setForm(f => ({ ...f, type, options:
    type === "true_false" || type === "fill_blank" || f.type === "true_false" || f.type === "fill_blank"
      ? blankQuestion(type).options : f.options, correctAnswers: [] }));
  return <dialog ref={dialog} autoFocus tabIndex={-1} className="question-drawer-backdrop" aria-modal="true" aria-labelledby="question-editor-title"
    onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="question-editor question-drawer">
      <header className="question-drawer-header">
      <div className="authoring-toolbar"><h3 id="question-editor-title" className="dialog-title">{question ? "Edit question" : "Add question"}</h3>
        <button className="btn btn-ghost question-drawer-close" type="button" aria-label="Close question editor" disabled={busy} onClick={close}>×</button></div>
      {question && <p className="authoring-identifier">#{question.sequenceNumber} · {question.id} · revision {question.revision}</p>}
      </header>
      <div className="question-drawer-body">
      <button className="btn btn-secondary" type="button" aria-expanded={preview} onClick={() => setPreview(!preview)}>{preview ? "Hide preview" : "Show Markdown preview"}</button>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="field"><label htmlFor="question-type">Type</label><select id="question-type" className="input" value={form.type} onChange={e => selectType(e.target.value as QuestionType)}>
          <option value="single_choice">Single choice</option><option value="multiple_choice">Multiple choice</option><option value="true_false">True / false</option><option value="fill_blank">Fill in the blank</option>
        </select>{errors("type")}</div>
        <div className="field"><label htmlFor="question-stem">Stem · Markdown</label><textarea ref={stem} id="question-stem" className="input" rows={5} value={form.stem} onChange={e => change("stem", e.target.value)} {...accessibility("stem")} />{errors("stem")}</div>
        {form.type !== "fill_blank" ? <div className="field"><label>Options &amp; correct answers</label><p>Select {form.type === "multiple_choice" ? "at least two correct answers" : "one correct answer"}.</p>
          {form.options.map((option, index) => <div key={option.id} className="authoring-option">
            <input aria-label={`Correct answer ${option.id}`} type={form.type === "multiple_choice" ? "checkbox" : "radio"} name="correct-answer" checked={form.correctAnswers.includes(option.id)} onChange={() => change("correctAnswers", form.type === "multiple_choice" ? form.correctAnswers.includes(option.id) ? form.correctAnswers.filter(id => id !== option.id) : [...form.correctAnswers, option.id] : [option.id])} />
            <label htmlFor={`option-${index}`}>{option.id}</label>
            <textarea id={`option-${index}`} aria-label={`Option ${option.id} · Markdown`} rows={2} className="input" value={option.text} onChange={e => change("options", form.options.map((o, i) => i === index ? { ...o, text: e.target.value } : o))} {...accessibility("options")} />
            {form.type !== "true_false" && <button type="button" className="btn btn-ghost" aria-label={`Remove option ${option.id}`} onClick={() => setForm(f => ({ ...f, options: f.options.filter(o => o.id !== option.id), correctAnswers: f.correctAnswers.filter(id => id !== option.id) }))}>×</button>}
          </div>)}
          {form.type !== "true_false" && <button type="button" className="btn btn-secondary" disabled={form.options.length >= IMPORT_LIMITS.maxOptions} onClick={() => {
            const id = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).find(id => !form.options.some(o => o.id === id))!;
            change("options", [...form.options, { id, text: "" }]);
          }}>Add option</button>}{errors("options")}{errors("correctAnswers")}
        </div> : <div className="field"><label htmlFor="accepted-answers">Accepted answers (one per line)</label><textarea id="accepted-answers" className="input" rows={3} value={form.correctAnswers.join("\n")} onChange={e => change("correctAnswers", e.target.value.split("\n"))} {...accessibility("correctAnswers")} />{errors("correctAnswers")}</div>}
        <div className="field"><label htmlFor="official-explanation">Official explanation · Markdown</label><textarea id="official-explanation" className="input" rows={4} value={form.explanation} onChange={e => change("explanation", e.target.value)} {...accessibility("explanation")} />{errors("explanation")}</div>
        <div className="authoring-toolbar">
          <div className="field"><label htmlFor="external-id">External ID (optional, unique in this exam)</label><input id="external-id" className="input" value={form.externalId} onChange={e => change("externalId", e.target.value)} {...accessibility("externalId")} />{errors("externalId")}</div>
          <div className="field"><label htmlFor="question-difficulty">Difficulty</label><select id="question-difficulty" className="input" value={form.difficulty} onChange={e => change("difficulty", e.target.value)}><option value="">Unspecified</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>{errors("difficulty")}</div>
          <div className="field"><label htmlFor="question-points">Points</label><input id="question-points" className="input" type="number" step="any" value={form.points} onChange={e => change("points", e.target.value)} {...accessibility("points")} />{errors("points")}</div>
        </div>
        <div className="field"><label htmlFor="question-tags">Tags</label><QuestionTagPicker tags={form.tags} invalid={fieldErrors("tags").length > 0}
          onAdd={name => setForm(f => f.tags.length >= IMPORT_LIMITS.maxTags || f.tags.some(tag => normalizeTagKey(tag) === normalizeTagKey(name)) ? f : { ...f, tags: [...f.tags, name] })}
          onRemove={name => setForm(f => ({ ...f, tags: f.tags.filter(tag => tag !== name) }))} />{errors("tags")}</div>
        <div className="field"><label className="authoring-checkbox" htmlFor="question-needs-review">
          <input id="question-needs-review" type="checkbox" checked={form.needsReview} onChange={e => change("needsReview", e.target.checked)} />
          <span>Needs review</span></label>
          <p className="authoring-identifier">Review state is stored on the question itself, not as a tag. Imports set it; clear it once the question has been checked.</p>{errors("needsReview")}</div>
      </fieldset>
      {preview && <section className="authoring-preview" aria-label="Markdown preview"><h4>Preview</h4><QuestionContent src={form.stem} />
        {form.type !== "fill_blank" && form.options.map(o => <div key={o.id}><strong>{o.id}{form.correctAnswers.includes(o.id) ? " ✓" : ""}</strong><QuestionContent src={o.text} /></div>)}
        <p>Correct answers: {form.correctAnswers.join(", ") || "Not selected"}</p><QuestionContent src={form.explanation} />
      </section>}
      </div>
      <footer className="question-drawer-footer">
      {error && <p role="alert" className="authoring-errors">{error}</p>}
      {issues.length > 0 && <p role="alert" className="authoring-errors">Check the highlighted fields. Your input has been kept.</p>}
      <div className="dialog-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => save(true)}>Save &amp; add next</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(false)}>{busy ? "Saving…" : "Save"}</button></div>
      </footer>
    </div>
  </dialog>;
}

export default function QuestionEditorDialog(props: Parameters<typeof LegacyQuestionEditorDialog>[0]) {
  return props.question?.content ? <ComponentQuestionEditor {...props} question={props.question} /> : <LegacyQuestionEditorDialog {...props} />;
}
