import ComponentQuestionEditor from "./ComponentQuestionEditor";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IMPORT_LIMITS, normalizeTagKey, validateQuestionRow, type Question, type QuestionType, type ValidationIssue } from "@prepdeck/shared";
import { apiFetch, ApiError } from "../lib/api";
import { blankQuestion, formPayload, questionForm, type QuestionForm } from "../lib/questionAuthoring";
import QuestionContent from "./QuestionContent";
import QuestionTagPicker from "./QuestionTagPicker";

// Undo for a type change or option removal. It is offered only while the
// type/options/answers it would restore are exactly as the action left them,
// so an undo can never overwrite later edits.
type Undo = { at: "type" | "options"; message: string; after: string; restore: (form: QuestionForm) => QuestionForm };
const answerState = (f: QuestionForm) => JSON.stringify([f.type, f.options, f.correctAnswers]);
const FIELD_LABELS: Partial<Record<keyof QuestionForm, string>> = {
  type: "Type", stem: "Stem", options: "Options", correctAnswers: "Correct answers", explanation: "Official explanation",
  externalId: "External ID", difficulty: "Difficulty", points: "Points", tags: "Tags", needsReview: "Needs review"
};

function LegacyQuestionEditorDialog({ examId, question, initialType, onClose, onSaved }: {
  examId: string; question: Question | null; initialType: QuestionType;
  onClose: () => void; onSaved: (question: Question, addNext: boolean) => void;
}) {
  // `base` is the revision this draft will be saved against; a stale save can
  // move it to the latest revision while keeping the draft.
  const [base, setBase] = useState(question);
  const [initial, setInitial] = useState(() => question ? questionForm(question) : blankQuestion(initialType));
  const [form, setForm] = useState(initial);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [rebased, setRebased] = useState("");
  const [undo, setUndo] = useState<Undo | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const saving = useRef(false), saved = useRef(false), focusAfter = useRef<string | null>(null);
  // Set by a save attempt only: removing errors while typing must never move focus.
  const focusInvalid = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null), stem = useRef<HTMLTextAreaElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const mayLeave = useCallback(() => !saving.current && (saved.current || !dirty || window.confirm("Discard unsaved question changes?")), [dirty]);
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
  useEffect(() => {
    if (!focusInvalid.current) return;
    focusInvalid.current = false;
    dialog.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [issues]);
  useEffect(() => {
    if (!focusAfter.current) return;
    dialog.current?.querySelector<HTMLElement>(focusAfter.current)?.focus();
    focusAfter.current = null;
  });
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (!saved.current && (dirty || saving.current)) { e.preventDefault(); e.returnValue = ""; } };
    const navigate = (e: Event) => { if (!mayLeave()) e.preventDefault(); };
    window.addEventListener("beforeunload", unload); window.addEventListener("prepdeck:before-navigate", navigate);
    return () => { window.removeEventListener("beforeunload", unload); window.removeEventListener("prepdeck:before-navigate", navigate); };
  }, [dirty, mayLeave]);
  // `$.options` matches only `$.options`, `$.options[…]` and `$.options.…`;
  // `options[1]` must not also match `options[10]`.
  const inField = (field: string, path: string) => path === `$.${field}` || (!field.endsWith("]") && path.startsWith(`$.${field}[`)) || path.startsWith(`$.${field}.`);
  const fieldErrors = (field: string) => issues.filter(i => inField(field, i.path));
  // Editing a field clears its errors; the rest stay until the next save. An
  // option edit clears only that option's errors (see the option textarea).
  const clearErrors = (field: string) => setIssues(list => list.some(i => inField(field, i.path)) ? list.filter(i => !inField(field, i.path)) : list);
  const change = <K extends keyof QuestionForm>(key: K, value: QuestionForm[K]) => { setForm(f => ({ ...f, [key]: value })); if (key !== "options") clearErrors(key); };
  const groupErrors = (field: string) => issues.filter(i => i.path === `$.${field}`);
  const errorId = (field: string) => `error-${field.replace(/\W+/g, "-")}`;
  const errorList = (field: string, list: ValidationIssue[]) => <div id={errorId(field)} className="authoring-errors">{list.map((i, n) => <div key={n}>{i.path.replace("$.", "")}: {i.message}</div>)}</div>;
  const errors = (field: string) => errorList(field, fieldErrors(field));
  const accessibility = (field: string) => ({ "aria-invalid": fieldErrors(field).length > 0, "aria-describedby": errorId(field) });
  const answerInvalid = fieldErrors("correctAnswers").length > 0 || groupErrors("options").length > 0;
  const save = async (addNext: boolean) => {
    if (saving.current) return;
    const body = formPayload(form);
    const problems = validateQuestionRow(body, "$");
    focusInvalid.current = problems.length > 0;
    setIssues(problems); setError(""); setStale(false);
    if (problems.length) return;
    saving.current = true; setBusy(true);
    try {
      const { question: result } = await apiFetch<{ question: Question }>(`/api/exams/${examId}/questions${base ? `/${base.id}` : ""}`, {
        method: base ? "PATCH" : "POST", body: JSON.stringify({ ...body, externalId: form.externalId || null, expectedRevision: base?.revision }) });
      saved.current = true;
      onSaved(result, addNext);
    } catch (err) {
      const details = err instanceof ApiError ? err.body as { issues?: ValidationIssue[]; code?: string } | null : null;
      focusInvalid.current = !!details?.issues?.length;
      setIssues(details?.issues ?? []);
      // 409 also means a duplicate external ID; only a revision conflict offers recovery.
      const conflict = !!base && err instanceof ApiError && err.status === 409 && details?.code === "stale_question";
      setStale(conflict);
      setError(conflict ? "Someone saved a newer version of this question while you were editing." : err instanceof Error ? err.message : "Could not save this question. Your input has been kept.");
    } finally { saving.current = false; setBusy(false); }
  };
  // Stale save recovery: load the latest revision, then either keep the draft
  // (saved against the new revision) or replace it.
  const loadLatest = async (keepDraft: boolean) => {
    if (!base || saving.current) return;
    if (!keepDraft && !window.confirm("Discard your edits and load the latest version?")) return;
    saving.current = true; setBusy(true);
    try {
      const { question: latest } = await apiFetch<{ question: Question }>(`/api/exams/${examId}/questions/${base.id}`);
      const before = questionForm(base), after = questionForm(latest);
      const changed = (Object.keys(after) as (keyof QuestionForm)[]).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(k => FIELD_LABELS[k] ?? k);
      setBase(latest); setInitial(after); setIssues([]); setError(""); setStale(false); setUndo(null);
      if (!keepDraft) setForm(after);
      setRebased(`Loaded revision ${latest.revision}.${changed.length ? ` Changed since you opened it: ${changed.join(", ")}.` : ""}${keepDraft ? " Your edits are kept; review them and save again." : ""}`);
    } catch (err) { setError(err instanceof Error ? `Could not load the latest version: ${err.message}` : "Could not load the latest version."); }
    finally { saving.current = false; setBusy(false); }
  };
  const offerUndo = (at: Undo["at"], message: string, next: QuestionForm, restore: Undo["restore"]) => {
    setForm(next);
    setUndo({ at, message, after: answerState(next), restore });
  };
  const selectType = (type: QuestionType) => {
    const f = form;
    const choice = (t: QuestionType) => t === "single_choice" || t === "multiple_choice";
    // Choice ↔ choice keeps options; single choice keeps one answer.
    const options = choice(f.type) && choice(type) ? f.options : blankQuestion(type).options;
    const ids = new Set(options.map(o => o.id));
    const kept = choice(f.type) && choice(type) ? f.correctAnswers.filter(id => ids.has(id)) : [];
    const correctAnswers = type === "single_choice" && kept.length > 1 ? [] : kept;
    const next = { ...f, type, options, correctAnswers };
    const defaults = JSON.stringify(blankQuestion(f.type).options);
    const lostOptions = options !== f.options && JSON.stringify(f.options) !== defaults && f.options.some(o => o.text.trim());
    const lostAnswers = f.correctAnswers.filter(a => a.trim()).length > correctAnswers.length;
    if (!lostOptions && !lostAnswers) { setForm(next); setUndo(null); return; }
    const label = (t: QuestionType) => t === "single_choice" ? "single choice" : t === "multiple_choice" ? "multiple choice" : t === "true_false" ? "true / false" : "fill in the blank";
    const lost = [lostOptions && "options", lostAnswers && "correct answers"].filter(Boolean).join(" and ");
    offerUndo("type", `Changed to ${label(type)}. ${lost[0]!.toUpperCase()}${lost.slice(1)} were cleared.`, next,
      g => ({ ...g, type: f.type, options: f.options, correctAnswers: f.correctAnswers }));
  };
  const removeOption = (index: number) => {
    const f = form, option = f.options[index]!;
    const wasCorrect = f.correctAnswers.includes(option.id);
    const next = { ...f, options: f.options.filter((_, i) => i !== index), correctAnswers: f.correctAnswers.filter(id => id !== option.id) };
    // Keep focus in the list: the option that took its place, else the one before, else Add option.
    focusAfter.current = next.options.length ? `#option-${Math.min(index, next.options.length - 1)}` : "#add-option";
    offerUndo("options", `Removed option ${option.id}${wasCorrect ? " (a correct answer)" : ""}.`, next, g => ({
      ...g, options: [...g.options.slice(0, index), option, ...g.options.slice(index)],
      correctAnswers: wasCorrect ? [...g.correctAnswers, option.id] : g.correctAnswers
    }));
  };
  // Option IDs are stable references (answers, annotations), so existing ones
  // are never relabelled; a new option takes the next free letter after the last.
  const addOption = () => {
    const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    const used = new Set(form.options.map(o => o.id));
    const last = letters.indexOf(form.options.at(-1)?.id ?? "");
    const id = letters.slice(last + 1).find(l => !used.has(l)) ?? letters.find(l => !used.has(l))!;
    focusAfter.current = `#option-${form.options.length}`;
    setUndo(null);
    change("options", [...form.options, { id, text: "" }]);
  };
  const activeUndo = undo && undo.after === answerState(form) ? undo : null;
  const undoNotice = (at: Undo["at"]) => activeUndo?.at === at && <p role="status" className="authoring-undo">{activeUndo.message}{" "}
    <button type="button" className="btn btn-ghost" onClick={() => {
      setForm(activeUndo.restore); setUndo(null);
      focusAfter.current = at === "type" ? "#question-type" : null;
    }}>Undo</button></p>;
  return <dialog ref={dialog} autoFocus tabIndex={-1} className="question-drawer-backdrop" aria-modal="true" aria-labelledby="question-editor-title"
    onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="question-editor question-drawer">
      <header className="question-drawer-header">
      <div className="authoring-toolbar"><h3 id="question-editor-title" className="dialog-title">{base ? "Edit question" : "Add question"}</h3>
        <button className="btn btn-ghost question-drawer-close" type="button" aria-label="Close question editor" disabled={busy} onClick={close}>×</button></div>
      {base && <p className="authoring-identifier">#{base.sequenceNumber} · {base.id} · revision {base.revision}</p>}
      </header>
      <div className="question-drawer-body">
      {rebased && <p role="status" className="authoring-rebased">{rebased}</p>}
      <button className="btn btn-secondary" type="button" aria-expanded={preview} onClick={() => setPreview(!preview)}>{preview ? "Hide preview" : "Show Markdown preview"}</button>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="field"><label htmlFor="question-type">Type</label><select id="question-type" className="input" value={form.type} onChange={e => selectType(e.target.value as QuestionType)}>
          <option value="single_choice">Single choice</option><option value="multiple_choice">Multiple choice</option><option value="true_false">True / false</option><option value="fill_blank">Fill in the blank</option>
        </select>{undoNotice("type")}{errors("type")}</div>
        <div className="field"><label htmlFor="question-stem">Stem · Markdown</label><textarea ref={stem} id="question-stem" className="input" rows={5} value={form.stem} onChange={e => change("stem", e.target.value)} {...accessibility("stem")} />{errors("stem")}</div>
        {form.type !== "fill_blank" ? <div className="field"><label>Options &amp; correct answers</label><p>Select {form.type === "multiple_choice" ? "at least two correct answers" : "one correct answer"}.</p>
          {errorList("options", groupErrors("options"))}{errors("correctAnswers")}
          {form.options.map((option, index) => {
            const field = `options[${index}]`;
            return <div key={option.id} className="authoring-option-entry"><div className="authoring-option">
              <input aria-label={`Correct answer ${option.id}`} type={form.type === "multiple_choice" ? "checkbox" : "radio"} name="correct-answer" checked={form.correctAnswers.includes(option.id)}
                aria-invalid={answerInvalid} aria-describedby={`${errorId("correctAnswers")} ${errorId("options")}`}
                onChange={() => change("correctAnswers", form.type === "multiple_choice" ? form.correctAnswers.includes(option.id) ? form.correctAnswers.filter(id => id !== option.id) : [...form.correctAnswers, option.id] : [option.id])} />
              <label htmlFor={`option-${index}`}>{option.id}</label>
              <textarea id={`option-${index}`} aria-label={`Option ${option.id} · Markdown`} rows={2} className="input" value={option.text} onChange={e => { change("options", form.options.map((o, i) => i === index ? { ...o, text: e.target.value } : o)); clearErrors(field); }} {...accessibility(field)} />
              {form.type !== "true_false" && <button type="button" className="btn btn-ghost" aria-label={`Remove option ${option.id}`} onClick={() => removeOption(index)}>×</button>}
            </div>{errors(field)}</div>;
          })}
          {undoNotice("options")}
          {form.type !== "true_false" && <button id="add-option" type="button" className="btn btn-secondary" disabled={form.options.length >= IMPORT_LIMITS.maxOptions} onClick={addOption}>Add option</button>}
        </div> : <div className="field"><label htmlFor="accepted-answers">Accepted answers (one per line)</label><textarea id="accepted-answers" className="input" rows={3} value={form.correctAnswers.join("\n")} onChange={e => change("correctAnswers", e.target.value.split("\n"))} {...accessibility("correctAnswers")} />
          <p className="authoring-identifier">Blank lines are ignored.</p>{errors("correctAnswers")}</div>}
        <div className="field"><label htmlFor="official-explanation">Official explanation · Markdown</label><textarea id="official-explanation" className="input" rows={4} value={form.explanation} onChange={e => change("explanation", e.target.value)} {...accessibility("explanation")} />{errors("explanation")}</div>
        <div className="authoring-toolbar">
          <div className="field"><label htmlFor="external-id">External ID (optional, unique in this exam)</label><input id="external-id" className="input" value={form.externalId} onChange={e => change("externalId", e.target.value)} {...accessibility("externalId")} />{errors("externalId")}</div>
          <div className="field"><label htmlFor="question-difficulty">Difficulty</label><select id="question-difficulty" className="input" value={form.difficulty} onChange={e => change("difficulty", e.target.value)}><option value="">Unspecified</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>{errors("difficulty")}</div>
          <div className="field"><label htmlFor="question-points">Points</label><input id="question-points" className="input" type="number" step="any" min={0} max={IMPORT_LIMITS.maxPoints} value={form.points} onChange={e => change("points", e.target.value)} {...accessibility("points")} />{errors("points")}</div>
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
        <p>Correct answers: {formPayload(form).correctAnswers.join(", ") || "Not selected"}</p><QuestionContent src={form.explanation} />
      </section>}
      </div>
      <footer className="question-drawer-footer">
      {error && <div role="alert" className="authoring-errors"><p>{error}{stale && " Your edits are kept."}</p>
        {stale && <div className="authoring-toolbar">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => loadLatest(true)}>Load latest and keep my edits</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => loadLatest(false)}>Discard my edits</button>
        </div>}</div>}
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
