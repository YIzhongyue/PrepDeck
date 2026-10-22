import ComponentQuestionEditor from "./ComponentQuestionEditor";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { IMPORT_LIMITS, normalizeTagKey, validateQuestionRow, type Question, type QuestionType, type ValidationIssue } from "@prepdeck/shared";
import { apiFetch, ApiError } from "../lib/api";
import { blankQuestion, formPayload, questionForm, type QuestionForm } from "../lib/questionAuthoring";
import QuestionDraftPreview from "./QuestionDraftPreview";
import QuestionTagPicker from "./QuestionTagPicker";
import { useQuestionDraftGuard } from "./QuestionDraftGuard";
import { t as translate, useI18n, type TranslationKey } from "../i18n";

// Undo for a type change or option removal. It is offered only while the
// type/options/answers it would restore are exactly as the action left them,
// so an undo can never overwrite later edits.
type Undo = { at: "type" | "options"; message: string; after: string; restore: (form: QuestionForm) => QuestionForm };
const answerState = (f: QuestionForm) => JSON.stringify([f.type, f.options, f.correctAnswers]);
const FIELD_LABELS: Partial<Record<keyof QuestionForm, TranslationKey>> = {
  type: "authoring.fields.type", stem: "authoring.fields.stem", options: "authoring.fields.options", correctAnswers: "authoring.fields.correctAnswers",
  explanation: "authoring.fields.explanation", externalId: "authoring.fields.externalId", difficulty: "authoring.fields.difficulty",
  points: "authoring.fields.points", tags: "authoring.fields.tags", needsReview: "authoring.fields.needsReview"
};
const LEGACY_TYPES = ["single_choice", "multiple_choice", "true_false", "fill_blank"] as const satisfies QuestionType[];

function OptionTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const element = textarea.current;
    // Hidden compact panes have no measurable width. ResizeObserver fits the
    // same mounted field when Edit returns, or its column reflows on zoom.
    if (!element || !element.clientWidth) return;
    const pane = element.closest(".question-editor-pane");
    const scrollTop = pane?.scrollTop ?? 0;
    const style = getComputedStyle(element);
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
    // Measuring a shorter field can clamp or anchor its scroll container.
    // Keep the user's pane position; neither value nor selection is rewritten.
    if (pane) pane.scrollTop = scrollTop;
  }, []);
  useLayoutEffect(fit, [fit, props.value]);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    let width = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        fit();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);
  return <textarea {...props} ref={textarea} />;
}

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
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const { t } = useI18n();
  // Keep this query in step with the workspace layout in app.css.
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1100px)").matches);
  // Avoid hidden Markdown work before first use, then retain preview scroll.
  const [previewMounted, setPreviewMounted] = useState(wide);
  const previousWide = useRef(wide);
  const fields = useRef<HTMLDivElement>(null), previewPane = useRef<HTMLElement>(null), viewSwitch = useRef<HTMLDivElement>(null);
  const lastField = useRef<HTMLElement | null>(null), editScroll = useRef(0);
  const restorePaneFocus = useRef<"edit" | "preview" | null>(null);
  const saving = useRef(false), focusAfter = useRef<string | null>(null);
  // Set by a save attempt only: removing errors while typing must never move focus.
  const focusInvalid = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null), stem = useRef<HTMLTextAreaElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const close = async () => { if (await guard.requestDiscard()) onClose(); };
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
    const media = window.matchMedia("(min-width: 1100px)");
    const resize = () => {
      const active = document.activeElement;
      // Reflow/zoom must not hide the field or preview that has keyboard focus.
      if (!media.matches) {
        if (fields.current?.contains(active)) setPreview(false);
        else if (previewPane.current?.contains(active)) setPreview(true);
      } else if (viewSwitch.current?.contains(active)) {
        if (fields.current && !fields.current.hidden) editScroll.current = fields.current.scrollTop;
        restorePaneFocus.current = active?.getAttribute("aria-controls") === "question-preview" ? "preview" : "edit";
      }
      if (media.matches) setPreviewMounted(true);
      setWide(media.matches);
    };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useLayoutEffect(() => {
    const target = restorePaneFocus.current;
    restorePaneFocus.current = null;
    if (target === "preview") previewPane.current?.focus({ preventScroll: true });
    if (target === "edit") {
      const field = lastField.current?.isConnected ? lastField.current : stem.current;
      field?.focus({ preventScroll: true });
      if (fields.current) fields.current.scrollTop = editScroll.current;
    }
    // A narrower column can move the focused field below the viewport. Keep
    // that editing location visible after reflow, without moving it on switches.
    if (wide !== previousWide.current && fields.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).scrollIntoView({ block: "nearest" });
    }
    previousWide.current = wide;
  }, [preview, wide]);
  const switchView = (next: boolean) => {
    if (next === preview) return;
    if (next) { setPreviewMounted(true); editScroll.current = fields.current?.scrollTop ?? 0; }
    else restorePaneFocus.current = "edit";
    setPreview(next);
  };
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
    if (problems.length) { setPreview(false); return; }
    saving.current = true; setBusy(true);
    try {
      const { question: result } = await apiFetch<{ question: Question }>(`/api/exams/${examId}/questions${base ? `/${base.id}` : ""}`, {
        method: base ? "PATCH" : "POST", body: JSON.stringify({ ...body, externalId: form.externalId || null, expectedRevision: base?.revision }) });
      const canonical = questionForm(result);
      setBase(result); setInitial(canonical); setForm(canonical);
      setSavedRevision(result.revision); setRebased("");
      onSaved(result, addNext);
    } catch (err) {
      const details = err instanceof ApiError ? err.body as { issues?: ValidationIssue[]; code?: string } | null : null;
      focusInvalid.current = !!details?.issues?.length;
      if (focusInvalid.current) setPreview(false);
      setIssues(details?.issues ?? []);
      // 409 also means a duplicate external ID; only a revision conflict offers recovery.
      const conflict = !!base && err instanceof ApiError && err.status === 409 && details?.code === "stale_question";
      setStale(conflict);
      setError(conflict ? translate("authoring.editor.stale") : err instanceof Error ? err.message : translate("authoring.editor.saveFailed"));
    } finally { saving.current = false; setBusy(false); }
  };
  const guard = useQuestionDraftGuard(dirty, saving, () => { void save(false); });
  // Stale save recovery: load the latest revision, then either keep the draft
  // (saved against the new revision) or replace it.
  const loadLatest = async (keepDraft: boolean) => {
    if (!base || saving.current) return;
    if (!keepDraft && !await guard.requestDiscard({ title: translate("authoring.editor.discardLatestTitle"), description: translate("authoring.editor.discardLatestBody"), action: translate("authoring.editor.discardLatestAction") })) return;
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      const { question: latest } = await apiFetch<{ question: Question }>(`/api/exams/${examId}/questions/${base.id}`);
      const before = questionForm(base), after = questionForm(latest);
      const changed = (Object.keys(after) as (keyof QuestionForm)[]).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(k => FIELD_LABELS[k] ? translate(FIELD_LABELS[k]) : k);
      setBase(latest); setInitial(after); setIssues([]); setError(""); setStale(false); setUndo(null); setSavedRevision(null);
      setPreview(false);
      if (!keepDraft) setForm(after);
      setRebased([
        translate("authoring.editor.loadedRevision", { revision: String(latest.revision) }),
        changed.length ? translate("authoring.editor.changedSince", { fields: changed.join(translate("common.listSeparator")) }) : "",
        keepDraft ? translate("authoring.editor.editsKept") : "",
      ].filter(Boolean).join(" "));
    } catch (err) { setError(err instanceof Error ? translate("authoring.editor.loadLatestFailedReason", { reason: err.message }) : translate("authoring.editor.loadLatestFailed")); }
    finally { saving.current = false; setBusy(false); }
  };
  const offerUndo = (at: Undo["at"], message: string, next: QuestionForm, restore: Undo["restore"]) => {
    setForm(next);
    setUndo({ at, message, after: answerState(next), restore });
  };
  const selectType = (type: QuestionType) => {
    const f = form;
    const choice = (kind: QuestionType) => kind === "single_choice" || kind === "multiple_choice";
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
    const lost = translate(lostOptions && lostAnswers ? "authoring.editor.clearedBoth" : lostOptions ? "authoring.editor.clearedOptions" : "authoring.editor.clearedAnswers");
    offerUndo("type", translate("authoring.editor.changedType", { type: translate(`authoring.typesInline.${type as (typeof LEGACY_TYPES)[number]}`), cleared: lost }), next,
      g => ({ ...g, type: f.type, options: f.options, correctAnswers: f.correctAnswers }));
  };
  const removeOption = (index: number) => {
    const f = form, option = f.options[index]!;
    const wasCorrect = f.correctAnswers.includes(option.id);
    const next = { ...f, options: f.options.filter((_, i) => i !== index), correctAnswers: f.correctAnswers.filter(id => id !== option.id) };
    // Keep focus in the list: the option that took its place, else the one before, else Add option.
    focusAfter.current = next.options.length ? `#option-${Math.min(index, next.options.length - 1)}` : "#add-option";
    offerUndo("options", translate(wasCorrect ? "authoring.editor.removedCorrectOption" : "authoring.editor.removedOption", { id: option.id }), next, g => ({
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
    }}>{t("kp.toolbar.undo")}</button></p>;
  return <><dialog ref={dialog} autoFocus tabIndex={-1} className="question-drawer-backdrop" aria-modal="true" aria-labelledby="question-editor-title" onKeyDown={guard.onKeyDown}
    onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="question-editor question-drawer question-editor-responsive">
      <header className="question-drawer-header">
      <div className="authoring-toolbar"><h3 id="question-editor-title" className="dialog-title">{t(base ? "authoring.editor.editTitle" : "authoring.list.add")}</h3>
        <button className="btn btn-ghost question-drawer-close" type="button" aria-label={t("authoring.editor.close")} disabled={busy} onClick={close}>×</button></div>
      {base && <p className="authoring-identifier">#{base.sequenceNumber} · {base.id} · {t("authoring.editor.revision", { revision: String(base.revision) })}</p>}
      {form.externalId && <p className="authoring-identifier authoring-external-id" title={form.externalId}>{t("authoring.list.externalId", { id: form.externalId })}</p>}
      {(base?.archivedAt || form.needsReview) && <div className="authoring-question-status">
        {base?.archivedAt && <span>{t("authoring.list.archivedTag")}</span>}{form.needsReview && <span>{t("authoring.list.needsReview")}</span>}
      </div>}
      <div ref={viewSwitch} className="question-editor-view-switch" role="group" aria-label={t("authoring.editor.view")} hidden={wide}>
        <button className="btn btn-secondary" type="button" aria-pressed={!preview} aria-controls="question-fields" onClick={() => switchView(false)}>{t("common.edit")}</button>
        <button className="btn btn-secondary" type="button" aria-pressed={preview} aria-controls="question-preview" onClick={() => switchView(true)}>{t("kp.diagram.preview")}</button>
      </div>
      </header>
      <div className="question-drawer-body question-editor-workspace">
      <div ref={fields} id="question-fields" className="question-editor-fields question-editor-pane" hidden={!wide && preview}
        onFocusCapture={e => { lastField.current = e.target as HTMLElement; }}>
      {rebased && <p role="status" className="authoring-rebased">{rebased}</p>}
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="field"><label htmlFor="question-type">{t("authoring.fields.type")}</label><select id="question-type" className="input" value={form.type} onChange={e => selectType(e.target.value as QuestionType)}>
          {LEGACY_TYPES.map(type => <option key={type} value={type}>{t(`authoring.types.${type}`)}</option>)}
        </select>{undoNotice("type")}{errors("type")}</div>
        <div className="field"><label htmlFor="question-stem">{t("authoring.editor.stemMarkdown")}</label><textarea ref={stem} id="question-stem" className="input" rows={5} value={form.stem} onChange={e => change("stem", e.target.value)} {...accessibility("stem")} />{errors("stem")}</div>
        {form.type !== "fill_blank" ? <div className="field"><label>{t("authoring.editor.optionsAnswers")}</label><p>{t(form.type === "multiple_choice" ? "authoring.editor.selectAtLeastTwo" : "authoring.editor.selectOne")}</p>
          {errorList("options", groupErrors("options"))}{errors("correctAnswers")}
          {form.options.map((option, index) => {
            const field = `options[${index}]`;
            return <div key={option.id} className="authoring-option-entry"><div className="authoring-option">
              <label className="authoring-option-label" htmlFor={`option-${index}`}>{t("authoring.editor.option", { id: option.id })}</label>
              <label className="authoring-correct-answer" htmlFor={`correct-answer-${index}`}><input id={`correct-answer-${index}`} aria-label={t("authoring.editor.correctAnswerFor", { id: option.id })} type={form.type === "multiple_choice" ? "checkbox" : "radio"} name="correct-answer" checked={form.correctAnswers.includes(option.id)}
                aria-invalid={answerInvalid} aria-describedby={`${errorId("correctAnswers")} ${errorId("options")}`}
                onChange={() => change("correctAnswers", form.type === "multiple_choice" ? form.correctAnswers.includes(option.id) ? form.correctAnswers.filter(id => id !== option.id) : [...form.correctAnswers, option.id] : [option.id])} /><span>{t("study.optionStatus.correct")}</span></label>
              {form.type !== "true_false" && <button type="button" className="btn btn-ghost authoring-remove-option" aria-label={t("authoring.editor.removeOption", { id: option.id })} onClick={() => removeOption(index)}>×</button>}
              <OptionTextarea id={`option-${index}`} aria-label={t("authoring.editor.optionMarkdown", { id: option.id })} rows={2} className="input" value={option.text} onChange={e => { change("options", form.options.map((o, i) => i === index ? { ...o, text: e.target.value } : o)); clearErrors(field); }} {...accessibility(field)} />
            </div>{errors(field)}</div>;
          })}
          {undoNotice("options")}
          {form.type !== "true_false" && <button id="add-option" type="button" className="btn btn-secondary" disabled={form.options.length >= IMPORT_LIMITS.maxOptions} onClick={addOption}>{t("authoring.editor.addOption")}</button>}
        </div> : <div className="field"><label htmlFor="accepted-answers">{t("authoring.editor.acceptedAnswers")}</label><textarea id="accepted-answers" className="input" rows={3} value={form.correctAnswers.join("\n")} onChange={e => change("correctAnswers", e.target.value.split("\n"))} {...accessibility("correctAnswers")} />
          <p className="authoring-identifier">{t("authoring.editor.blankLines")}</p>{errors("correctAnswers")}</div>}
        <div className="field"><label htmlFor="official-explanation">{t("authoring.editor.explanationMarkdown")}</label><textarea id="official-explanation" className="input" rows={4} value={form.explanation} onChange={e => change("explanation", e.target.value)} {...accessibility("explanation")} />{errors("explanation")}</div>
        <div className="authoring-metadata">
          <div className="field"><label htmlFor="external-id">{t("authoring.editor.externalIdLabel")}</label><input id="external-id" className="input" value={form.externalId} onChange={e => change("externalId", e.target.value)} {...accessibility("externalId")} />{errors("externalId")}</div>
          <div className="field"><label htmlFor="question-difficulty">{t("authoring.fields.difficulty")}</label><select id="question-difficulty" className="input" value={form.difficulty} onChange={e => change("difficulty", e.target.value)}><option value="">{t("common.difficulty.unspecified")}</option><option value="easy">{t("common.difficulty.easy")}</option><option value="medium">{t("common.difficulty.medium")}</option><option value="hard">{t("common.difficulty.hard")}</option></select>{errors("difficulty")}</div>
          <div className="field"><label htmlFor="question-points">{t("authoring.fields.points")}</label><input id="question-points" className="input" type="number" step="any" min={0} max={IMPORT_LIMITS.maxPoints} value={form.points} onChange={e => change("points", e.target.value)} {...accessibility("points")} />{errors("points")}</div>
        </div>
        <div className="field"><label htmlFor="question-tags">{t("authoring.fields.tags")}</label><QuestionTagPicker tags={form.tags} invalid={fieldErrors("tags").length > 0}
          onAdd={name => setForm(f => f.tags.length >= IMPORT_LIMITS.maxTags || f.tags.some(tag => normalizeTagKey(tag) === normalizeTagKey(name)) ? f : { ...f, tags: [...f.tags, name] })}
          onRemove={name => setForm(f => ({ ...f, tags: f.tags.filter(tag => tag !== name) }))} />{errors("tags")}</div>
        <div className="field authoring-review-field"><label className="authoring-checkbox" htmlFor="question-needs-review">
          <input id="question-needs-review" type="checkbox" checked={form.needsReview} aria-describedby="question-needs-review-help" onChange={e => change("needsReview", e.target.checked)} />
          <span>{t("authoring.list.needsReview")}</span></label>
          <p id="question-needs-review-help">{t("authoring.editor.needsReviewHelp")}</p>{errors("needsReview")}</div>
      </fieldset>
      </div>
      <section ref={previewPane} id="question-preview" className="authoring-preview question-editor-pane" aria-label={t("authoring.editor.markdownPreview")} tabIndex={0} hidden={!wide && !preview}>
        {(wide || previewMounted) && <><h4>{t("kp.diagram.preview")}</h4><QuestionDraftPreview form={form} /></>}
      </section>
      </div>
      <footer className="question-drawer-footer">
      {error && <div role="alert" className="authoring-errors"><p>{error}{stale && ` ${t("authoring.editor.yourEditsKept")}`}</p>
        {stale && <div className="authoring-toolbar">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => loadLatest(true)}>{t("authoring.editor.loadKeep")}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => loadLatest(false)}>{t("authoring.editor.discardMine")}</button>
        </div>}</div>}
      {issues.length > 0 && <p role="alert" className="authoring-errors">{t("authoring.editor.checkFields")}</p>}
      <div className="dialog-actions"><p role="status" className="authoring-save-status">{dirty ? t("kp.editor.unsaved") : savedRevision !== null ? t("authoring.editor.savedRevision", { revision: String(savedRevision) }) : t("authoring.editor.noUnsaved")}</p><button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>{t("common.cancel")}</button>
        {!base && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => save(true)}>{t("authoring.editor.saveAddNext")}</button>}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(false)}>{busy ? t("common.saving") : t("common.save")}</button></div>
      </footer>
    </div>
  </dialog>{guard.confirmation}</>;
}

export default function QuestionEditorDialog(props: Parameters<typeof LegacyQuestionEditorDialog>[0]) {
  return props.question?.content ? <ComponentQuestionEditor {...props} question={props.question} /> : <LegacyQuestionEditorDialog {...props} />;
}
