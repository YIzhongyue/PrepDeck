import QuestionClassificationFilters from "./QuestionClassificationFilters";
import { useEffect, useState } from "react";
import type { Question, QuestionType } from "@prepdeck/shared";
import { apiFetch } from "../lib/api";
import { questionBankChanged } from "../lib/questionAuthoring";
import { questionTypeLabel } from "../lib/questionTypes";
import QuestionEditorDialog from "./QuestionEditorDialog";
import QuestionImportDialog from "./QuestionImportDialog";

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
  const [page, setPage] = useState<{ offset: number; questions: Question[]; total: number; query: string }>({ offset: 0, questions: [], total: 0, query: "" });
  const { offset: shownOffset, questions, total } = page;
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  // `needsReview` is "" (no filter), "true" or "false" — the same spelling the
  // API parses, so it goes straight into the query string below.
  const [filters, setFilters] = useState({ q: "", type: "", difficulty: "", tag: "", needsReview: "", classifications: "" });
  const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [editor, setEditor] = useState<{ key: number; question: Question | null; type: QuestionType } | null>(null);
  const [importing, setImporting] = useState(false);
  const limit = 50;
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    const query = new URLSearchParams({ ...filters, limit: String(limit), offset: String(offset) });
    apiFetch<{ questions: Question[]; total: number }>(`/api/exams/${exam.id}/questions?${query}`, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        if (offset && offset >= data.total) {
          setOffset(Math.max(0, Math.floor((data.total - 1) / limit) * limit));
          return;
        }
        setPage({ offset, questions: data.questions, total: data.total, query: query.toString() });
        setLoading(false);
      })
      .catch(err => { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
    return () => controller.abort();
  }, [exam.id, filters, offset, refresh]);
  const requestPage = (nextOffset: number) => {
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
    } catch (e) { setError(e instanceof Error ? e.message : "Could not export questions"); }
  };
  const remove = async (q: Question) => {
    if (!window.confirm("Delete this question permanently? Questions with attempts, bookmarks, notes or other learning records cannot be deleted.")) return;
    try { await apiFetch(`/api/exams/${exam.id}/questions/${q.id}`, { method: "DELETE" }); mutated(`Deleted question #${q.sequenceNumber}.`); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not delete question."); }
  };
  return <div className="admin-question-list">
    <div className="admin-question-list-head"><div style={{ marginRight: "auto" }}><h3>Questions</h3><span>{total ? `${shownOffset + 1}–${Math.min(shownOffset + limit, total)}` : "0"} of {total}</span></div>
      <button type="button" className="btn btn-secondary" disabled={loading || !questions.length} onClick={exportPage}>Export this page</button>
      <button type="button" className="btn btn-secondary" onClick={() => setImporting(true)}>Import JSON</button>
      <button type="button" className="btn btn-primary" onClick={() => setEditor({ key: Date.now(), question: null, type: "single_choice" })}>Add question</button></div>
    <form className="authoring-toolbar authoring-filters" onSubmit={e => { e.preventDefault(); setOffset(0); setFilters(f => ({ ...f, q: search.trim() })); }}>
      <input className="input" aria-label="Search stem or exact internal / external ID" placeholder="Search stem or exact ID…" value={search} onChange={e => setSearch(e.target.value)} />
      <select className="input" aria-label="Filter by type" value={filters.type} onChange={e => { setOffset(0); setFilters(f => ({ ...f, type: e.target.value })); }}><option value="">All types</option><option value="single_choice">Single choice</option><option value="multiple_choice">Multiple choice</option><option value="true_false">True / false</option><option value="fill_blank">Fill in the blank</option><option value="ordering">Ordering</option><option value="matching">Matching</option></select>
      <select className="input" aria-label="Filter by difficulty" value={filters.difficulty} onChange={e => { setOffset(0); setFilters(f => ({ ...f, difficulty: e.target.value })); }}><option value="">All difficulties</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
      <input className="input" aria-label="Filter by exact tag" placeholder="Exact tag" value={filters.tag} onChange={e => { setOffset(0); setFilters(f => ({ ...f, tag: e.target.value })); }} />
      <select className="input" aria-label="Filter by review state" value={filters.needsReview} onChange={e => { setOffset(0); setFilters(f => ({ ...f, needsReview: e.target.value })); }}><option value="">Any review state</option><option value="true">Needs review</option><option value="false">Reviewed</option></select>
      <QuestionClassificationFilters examId={exam.id} revision={catalogRevision} selected={JSON.parse(filters.classifications || "{}")} onChange={selected => { setOffset(0); setFilters(f => ({ ...f, classifications: JSON.stringify(selected) })); }} />
      <button className="btn btn-secondary" type="submit">Search</button>
    </form>
    {notice && <p role="status" className="authoring-feedback">{notice}</p>}
    {error && <p role="alert" className="authoring-errors authoring-feedback">{error} <button type="button" className="btn btn-secondary" onClick={() => setRefresh(n => n + 1)}>Retry</button></p>}
    {loading ? <p className="authoring-feedback">Loading…</p> : <>
      {questions.length === 0 && <p className="authoring-feedback">No questions found. Add a question to start authoring, or adjust the filters.</p>}
      {questions.map(q => <div key={q.id} className="admin-question-row"><span className="admin-question-id">#{q.sequenceNumber}</span>
        <div style={{ flex: 1, minWidth: 0 }}><div className="authoring-toolbar"><span className="tag tag-neutral">{questionTypeLabel({ type: q.type, chooseCount: q.correctAnswers.length })}</span>{q.difficulty && <span className="tag">{q.difficulty}</span>}{q.needsReview && <span className="tag tag-accent-2">Needs review</span>}{q.tags.map((t, i) => <span className="tag" key={i}>{t}</span>)}</div>
          <p className="authoring-identifier">ID: {q.id}{q.externalId && ` · External ID: ${q.externalId}`}</p><span className="admin-question-stem">{q.stem}</span></div>
        <div className="authoring-toolbar"><button type="button" className="btn btn-secondary" onClick={() => setEditor({ key: Date.now(), question: q, type: q.type })}>Edit</button><button type="button" className="btn btn-ghost" onClick={() => remove(q)}>Delete</button></div>
      </div>)}
    </>}
    <div className="authoring-toolbar authoring-feedback"><button type="button" className="btn btn-secondary" disabled={loading || shownOffset === 0} onClick={() => requestPage(Math.max(0, shownOffset - limit))}>Previous</button>
      <span>Page {Math.floor(shownOffset / limit) + 1} of {Math.max(1, Math.ceil(total / limit))}</span><button type="button" className="btn btn-secondary" disabled={loading || shownOffset + limit >= total} onClick={() => requestPage(shownOffset + limit)}>Next</button></div>
    {editor && <QuestionEditorDialog key={editor.key} examId={exam.id} question={editor.question} initialType={editor.type} onClose={() => setEditor(null)} onSaved={(q, next) => {
      mutated(`Saved question #${q.sequenceNumber}${q.externalId ? ` (${q.externalId})` : ""}.`);
      setEditor(next ? { key: editor.key + 1, question: null, type: q.type } : null);
    }} />}
    {importing && <QuestionImportDialog examId={exam.id} onClose={() => setImporting(false)} onImported={() => mutated("Import completed. Review the per-question results in the import dialog.")} />}
  </div>;
}
