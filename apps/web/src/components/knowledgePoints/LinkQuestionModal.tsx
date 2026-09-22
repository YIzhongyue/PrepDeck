// implementation — mockup Screen 3. Searches questions across every exam the user
// can access (never the answer key — see routes/knowledgePointQuestionSearch.ts)
// and links/unlinks them to the currently open note.

import { useEffect, useState } from "react";
import ModalLayer from "../ModalLayer";
import type { LinkableQuestionSummary } from "@prepdeck/shared";
import { usePrepDeck } from "../../store/PrepDeckContext";
import { useKnowledgePoints } from "../../store/useKnowledgePoints";
import { searchLinkableQuestions } from "../../lib/knowledgePoints";

export default function LinkQuestionModal({ knowledgePointId, onClose }: { knowledgePointId: string; onClose: () => void }) {
  const { state: appState } = usePrepDeck();
  const { linkQuestion, unlinkQuestion } = useKnowledgePoints();
  const [q, setQ] = useState("");
  const [examId, setExamId] = useState<string | null>(null);
  const [results, setResults] = useState<LinkableQuestionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      searchLinkableQuestions({ q: q || undefined, examId: examId ?? undefined, knowledgePointId, limit: 20 })
        .then((res) => { if (!cancelled) { setResults(res.questions); setTotal(res.total); } })
        .catch(() => {});
    }, 250);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [q, examId, knowledgePointId]);

  const toggleLink = (question: LinkableQuestionSummary) => {
    setError(null);
    setBusyId(question.questionId);
    const action = question.linked ? unlinkQuestion(question.questionId) : linkQuestion(question.questionId);
    Promise.resolve(action).then(() => {
      setBusyId(null);
      setResults((rs) => rs.map((r) => (r.questionId === question.questionId ? { ...r, linked: !r.linked } : r)));
    }).catch(() => { setBusyId(null); setError("Could not save the question link. Retry from the note's save status."); });
  };

  return (
    <ModalLayer label="Link a question" onClose={onClose}>
      <div className="dialog" style={{ width: "min(620px, 100%)", maxHeight: "86vh" }}>
        {error && <p role="alert">{error}</p>}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
          <span style={{ width: 40, height: 40, flex: "none", display: "grid", placeItems: "center", borderRadius: 13, background: "var(--color-accent-100)", color: "var(--color-accent-600)" }}>
            <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h8l3 3v15H7z M10 11h6 M10 15h4" /></svg>
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 20, lineHeight: 1.15 }}>Link a question</h3>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, opacity: 0.7 }}>Search by question ID or text across every exam you can access.</p>
          </div>
          <button type="button" aria-label="Close question picker" onClick={onClose} style={{ flex: "none", display: "grid", placeItems: "center", width: 32, height: 32, border: 0, borderRadius: "50%", background: "var(--color-neutral-100)", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", border: "1px solid var(--color-divider)", borderRadius: 999, background: "var(--color-bg)" }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45, flex: "none" }}><path d="M11 4a7 7 0 100 14 7 7 0 000-14z M20 20l-4-4" /></svg>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles and question text…"
            style={{ width: "100%", padding: 0, border: 0, outline: 0, background: "transparent", font: "inherit", fontSize: 13 }}
          />
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setExamId(null)}
            style={{ padding: "5px 12px", border: `1px solid ${examId === null ? "var(--color-accent)" : "var(--color-divider)"}`, borderRadius: 999, background: examId === null ? "var(--color-accent-200)" : "transparent", color: examId === null ? "var(--color-accent-800)" : "inherit", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600 }}
          >
            All exams
          </button>
          {appState.exams.map((exam) => (
            <button
              key={exam.id}
              type="button"
              onClick={() => setExamId(exam.id)}
              title={exam.name}
              style={{ padding: "5px 12px", border: `1px solid ${examId === exam.id ? "var(--color-accent)" : "var(--color-divider)"}`, borderRadius: 999, background: examId === exam.id ? "var(--color-accent-200)" : "transparent", color: examId === exam.id ? "var(--color-accent-800)" : "inherit", cursor: "pointer", font: "inherit", fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {exam.name}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 11.5, opacity: 0.55 }}>{total} matches · showing {results.length}</span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {results.map((r) => (
            <div key={r.questionId} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 15px", border: "1px solid var(--color-divider)", borderRadius: 20, background: "var(--color-bg)" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap", minWidth: 0 }}>
                  <span className="tag tag-accent-2" title={r.examName} style={{ minWidth: 0, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.examName}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, opacity: 0.55 }}>{r.externalId ?? r.questionId.slice(0, 8)}</span>
                </span>
                <span style={{ display: "block", fontSize: 13, lineHeight: 1.55, opacity: 0.85 }}>{r.stemExcerpt}</span>
              </span>
              {r.linked ? (
                <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 13px", borderRadius: 999, background: "var(--color-accent-2-100)", color: "var(--color-accent-2-800)", fontSize: 12, fontWeight: 600 }}>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4 10-10" /></svg>
                  Linked
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => toggleLink(r)}
                disabled={busyId === r.questionId}
                style={{ flex: "none", padding: "6px 14px", border: r.linked ? "1px solid var(--color-divider)" : 0, borderRadius: 999, background: r.linked ? "transparent" : "var(--color-accent)", color: r.linked ? "var(--color-text)" : "var(--color-bg)", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600 }}
              >
                {r.linked ? "Unlink" : "Link"}
              </button>
            </div>
          ))}
          {results.length === 0 && <p style={{ opacity: 0.6, fontSize: 13 }}>No matching questions.</p>}
        </div>

        <div className="dialog-actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ margin: 0, fontSize: 11.5, opacity: 0.55 }}>Opening a linked question goes to review — it never records an attempt.</p>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Done</button>
        </div>
      </div>
    </ModalLayer>
  );
}
