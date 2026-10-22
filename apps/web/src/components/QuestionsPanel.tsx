import QuestionClassificationFilters from "./QuestionClassificationFilters";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Question, QuestionType } from "@prepdeck/shared";
import { apiFetch } from "../lib/api";
import { questionBankChanged } from "../lib/questionAuthoring";
import { questionTypeLabel } from "../lib/questionTypes";
import QuestionEditorDialog from "./QuestionEditorDialog";
import QuestionImportDialog from "./QuestionImportDialog";
import QuestionPageNavigation from "./QuestionPageNavigation";
import { difficultyLabel } from "../lib/labels";
import { t as translate, useI18n } from "../i18n";

const defaultFilters = { q: "", type: "", difficulty: "", tag: "", needsReview: "", archived: "", classifications: "" };
const QUESTION_TYPES = ["single_choice", "multiple_choice", "true_false", "fill_blank", "ordering", "matching"] as const satisfies QuestionType[];

export default function QuestionsPanel({ exam }: { exam: { id: string } }) {
  // Changing exams discards the old exam's filter/page/draft state before any
  // new requests, rather than sending its classification IDs to another bank.
  return <ExamQuestionsPanel key={exam.id} exam={exam} />;
}

function ExamQuestionsPanel({ exam }: { exam: { id: string } }) {
  // `offset` is the page being FETCHED; `page` is the page on screen. They were
  // one value, so clicking Next re-rendered the "Page 5 of 5" label and the
  // 201–205 range over page 4's rows for the frame between the click and the
  // effect that loads them. Keeping the rows, their offset and their total in
  // one state object means no label can describe a page that is not rendered.
  const [page, setPage] = useState<{ offset: number; questions: Question[]; total: number; query: string; bankEmpty: boolean }>({ offset: 0, questions: [], total: 0, query: "", bankEmpty: false });
  const { offset: shownOffset, questions, total } = page;
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  // `needsReview` and `archived` are "" (no filter), "true" or "false" — the
  // same spelling the API parses, so they go straight into the query string.
  // Archived questions are listed by default, marked, so archiving a row
  // leaves it in place with its Restore button rather than making it vanish.
  const [filters, setFilters] = useState(defaultFilters);
  const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [editor, setEditor] = useState<{ key: number; question: Question | null; type: QuestionType } | null>(null);
  const editControls = useRef(new Map<string, HTMLButtonElement>()), returnToQuestion = useRef<string | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const closeEditor = () => { returnToQuestion.current = editor?.question?.id ?? null; setEditor(null); };
  useLayoutEffect(() => {
    // Saving refreshes the list and can replace the original opening button
    // while the standard editor remains open. Return to its current control.
    if (!editor && returnToQuestion.current) {
      // A saved edit can stop matching the active filters. Keep those filters
      // and return to a stable place in this list when its row has disappeared
      // or is loading. Do it now; a later refresh must not steal focus again.
      (editControls.current.get(returnToQuestion.current) ?? listHeading.current)?.focus({ preventScroll: true });
      returnToQuestion.current = null;
    }
  }, [editor, loading]);
  const [importing, setImporting] = useState(false);
  const { t, formatDateTime } = useI18n();
  const limit = 50;
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    const query = new URLSearchParams({ ...filters, limit: String(limit), offset: String(offset) });
    apiFetch<{ questions: Question[]; total: number }>(`/api/exams/${exam.id}/questions?${query}`, { signal: controller.signal })
      .then(async data => {
        if (controller.signal.aborted) return;
        if (offset && offset >= data.total) {
          setOffset(Math.max(0, Math.floor((data.total - 1) / limit) * limit));
          return;
        }
        // A zero-match response says nothing about whether the bank is empty.
        // Check the unfiltered bank only when needed, including archived rows,
        // with the same cancellation/error handling as the displayed request.
        let bankEmpty = data.total === 0;
        if (bankEmpty && Object.values(filters).some(Boolean)) {
          const bank = await apiFetch<{ total: number }>(`/api/exams/${exam.id}/questions?limit=1&offset=0`, { signal: controller.signal });
          if (controller.signal.aborted) return;
          bankEmpty = bank.total === 0;
        }
        setPage({ offset, questions: data.questions, total: data.total, query: query.toString(), bankEmpty });
        setLoading(false);
      })
      .catch(err => { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
    return () => controller.abort();
  }, [exam.id, filters, offset, refresh]);
  const requestPage = (nextOffset: number) => {
    if (loading || nextOffset === shownOffset || nextOffset < 0 || nextOffset >= total) return;
    setLoading(true);
    setOffset(nextOffset);
    // A failed request leaves the same target offset ready to retry.
    setRefresh(n => n + 1);
  };
  const mutated = (message: string) => { setNotice(message); setRefresh(n => n + 1); setCatalogRevision(n => n + 1); questionBankChanged(); };
  const exportPage = async () => {
    try {
      // Export the successfully displayed selection, including after a newer
      // filter request failed and the previous page remains on screen.
      const { file } = await apiFetch<{ file: unknown }>(`/api/exams/${exam.id}/questions/export?${page.query}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `${exam.id}-questions-${shownOffset + 1}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : translate("authoring.list.exportFailed")); }
  };
  // Issues #92/#93: the reversible alternative to Delete, and the only one
  // for a question learners have already answered.
  const setArchived = async (q: Question, archived: boolean) => {
    const sequence = String(q.sequenceNumber);
    if (archived && !window.confirm(translate("authoring.list.archiveConfirm", { sequence }))) return;
    try {
      await apiFetch(`/api/exams/${exam.id}/questions/${q.id}/${archived ? "archive" : "unarchive"}`, { method: "POST" });
      mutated(translate(archived ? "authoring.list.archived" : "authoring.list.restored", { sequence }));
    } catch (err) { setError(err instanceof Error ? err.message : translate(archived ? "authoring.list.archiveFailed" : "authoring.list.restoreFailed")); }
  };
  const remove = async (q: Question) => {
    if (!window.confirm(translate("authoring.list.deleteConfirm"))) return;
    try { await apiFetch(`/api/exams/${exam.id}/questions/${q.id}`, { method: "DELETE" }); mutated(translate("authoring.list.deleted", { sequence: String(q.sequenceNumber) })); }
    catch (err) { setError(err instanceof Error ? err.message : translate("authoring.list.deleteFailed")); }
  };
  return <div className="admin-question-list">
    <div className="admin-question-list-head"><div className="admin-question-list-title"><h3 ref={listHeading} tabIndex={-1}>{t("setup.summary.questions")}</h3><span>{t("authoring.list.range", { range: total ? `${shownOffset + 1}–${Math.min(shownOffset + limit, total)}` : "0", total })}</span></div>
      <button type="button" className="btn btn-secondary" disabled={loading || !questions.length} onClick={exportPage}>{t("authoring.list.export")}</button>
      <button type="button" className="btn btn-secondary" onClick={() => setImporting(true)}>{t("authoring.list.import")}</button>
      <button type="button" className="btn btn-primary" onClick={() => setEditor({ key: Date.now(), question: null, type: "single_choice" })}>{t("authoring.list.add")}</button></div>
    <form className="authoring-toolbar authoring-filters" onSubmit={e => { e.preventDefault(); setOffset(0); setFilters(f => ({ ...f, q: search.trim() })); }}>
      <input className="input admin-question-search" aria-label={t("authoring.list.searchLabel")} placeholder={t("authoring.list.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} />
      <select className="input" aria-label={t("authoring.list.filterType")} value={filters.type} onChange={e => { setOffset(0); setFilters(f => ({ ...f, type: e.target.value })); }}><option value="">{t("authoring.list.allTypes")}</option>{QUESTION_TYPES.map(type => <option key={type} value={type}>{t(`authoring.types.${type}`)}</option>)}</select>
      <select className="input" aria-label={t("authoring.list.filterDifficulty")} value={filters.difficulty} onChange={e => { setOffset(0); setFilters(f => ({ ...f, difficulty: e.target.value })); }}><option value="">{t("authoring.list.allDifficulties")}</option><option value="easy">{t("common.difficulty.easy")}</option><option value="medium">{t("common.difficulty.medium")}</option><option value="hard">{t("common.difficulty.hard")}</option></select>
      <input className="input" aria-label={t("authoring.list.filterTag")} placeholder={t("authoring.list.exactTag")} value={filters.tag} onChange={e => { setOffset(0); setFilters(f => ({ ...f, tag: e.target.value })); }} />
      <select className="input" aria-label={t("authoring.list.filterReview")} value={filters.needsReview} onChange={e => { setOffset(0); setFilters(f => ({ ...f, needsReview: e.target.value })); }}><option value="">{t("authoring.list.anyReview")}</option><option value="true">{t("authoring.list.needsReview")}</option><option value="false">{t("authoring.list.reviewed")}</option></select>
      <select className="input" aria-label={t("authoring.list.filterArchived")} value={filters.archived} onChange={e => { setOffset(0); setFilters(f => ({ ...f, archived: e.target.value })); }}><option value="">{t("authoring.list.anyStatus")}</option><option value="false">{t("authoring.list.activeOnly")}</option><option value="true">{t("authoring.list.archivedOnly")}</option></select>
      <QuestionClassificationFilters examId={exam.id} revision={catalogRevision} selected={JSON.parse(filters.classifications || "{}")} onChange={selected => { setOffset(0); setFilters(f => ({ ...f, classifications: JSON.stringify(selected) })); }} />
      <button className="btn btn-secondary" type="submit">{t("common.search")}</button>
      <button className="btn btn-secondary" type="button" onClick={() => { setSearch(""); setFilters({ ...defaultFilters }); setOffset(0); }}>{t("tagFilter.clear")}</button>
    </form>
    {notice && <p role="status" className="authoring-feedback">{notice}</p>}
    {error && <p role="alert" className="authoring-errors authoring-feedback">{error} <button type="button" className="btn btn-secondary" onClick={() => setRefresh(n => n + 1)}>{t("common.retry")}</button></p>}
    {loading ? <p className="authoring-feedback">{t("common.loading")}</p> : <>
      {!error && questions.length === 0 && <p className="authoring-feedback">{t(page.bankEmpty ? "authoring.list.bankEmpty" : "authoring.list.noMatch")}</p>}
      {questions.map(q => <div key={q.id} className={q.archivedAt ? "admin-question-row is-archived" : "admin-question-row"}><span className="admin-question-id">#{q.sequenceNumber}</span>
        <div className="admin-question-summary"><div className="authoring-toolbar">{q.archivedAt && <span className="tag tag-warning" title={t("authoring.list.archivedAt", { when: formatDateTime(q.archivedAt) })}>{t("authoring.list.archivedTag")}</span>}<span className="tag tag-neutral">{questionTypeLabel({ type: q.type, chooseCount: q.correctAnswers.length })}</span>{q.difficulty && <span className="tag">{difficultyLabel(q.difficulty)}</span>}{q.needsReview && <span className="tag tag-accent-2">{t("authoring.list.needsReview")}</span>}{q.tags.map((tag, i) => <span className="tag" key={i}>{tag}</span>)}</div>
          <p className="authoring-identifier">{t("authoring.list.id", { id: q.id })}{q.externalId && ` · ${t("authoring.list.externalId", { id: q.externalId })}`}</p><span className="admin-question-stem">{q.stem}</span></div>
        <div className="authoring-toolbar admin-question-actions"><button ref={element => { if (element) editControls.current.set(q.id, element); else editControls.current.delete(q.id); }} type="button" className="btn btn-secondary" onClick={() => setEditor({ key: Date.now(), question: q, type: q.type })}>{t("common.edit")}</button><button type="button" className="btn btn-secondary" onClick={() => setArchived(q, !q.archivedAt)}>{t(q.archivedAt ? "admin.users.restore" : "admin.exams.archive")}</button><button type="button" className="btn btn-ghost" onClick={() => remove(q)}>{t("common.delete")}</button></div>
      </div>)}
    </>}
    <QuestionPageNavigation offset={shownOffset} total={total} limit={limit} loading={loading} onRequest={requestPage} />
    {editor && <QuestionEditorDialog key={editor.key} examId={exam.id} question={editor.question} initialType={editor.type} onClose={closeEditor} onSaved={(q, next) => {
      mutated(q.externalId ? translate("authoring.list.savedWithId", { sequence: String(q.sequenceNumber), id: q.externalId }) : translate("authoring.list.saved", { sequence: String(q.sequenceNumber) }));
      if (editor.question?.content && !next) {
        // Component Save closes immediately as the list refreshes. Focus the
        // stable list fallback before its old opening control is replaced.
        setLoading(true); closeEditor(); return;
      }
      setEditor(next ? { key: editor.key + 1, question: null, type: q.type }
        : editor.question && !editor.question.content ? { ...editor, question: q } : null);
    }} />}
    {importing && <QuestionImportDialog examId={exam.id} onClose={() => setImporting(false)} onImported={() => mutated(translate("authoring.list.imported"))} />}
  </div>;
}
