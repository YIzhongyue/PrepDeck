import AnswerRevisionNotice from "../components/AnswerRevisionNotice";
import { useState } from "react";
import RelatedKnowledgePoints from "../components/knowledgePoints/RelatedKnowledgePoints";
import { usePrepDeck } from "../store/PrepDeckContext";

export default function MockResults() {
  const { state, practiceWrong, go, toggleBookmark } = usePrepDeck();
  const result = state.mockResult;
  const [reviewQuestionId, setReviewQuestionId] = useState<string | null>(null);
  if (!result) return null;

  const score = result.score;
  const pass = result.passed;
  const scoreDash = ((score / 100) * 376.9).toFixed(1) + " 376.9";
  const examName = state.exams.find((e) => e.id === state.examId)?.name ?? "";
  const minutesUsed = Math.round(result.durationSeconds / 60);

  return (
    <div style={{ animation: "pd-rise .28s ease backwards" }}>
      <div className="card elev-sm" style={{ padding: 26, marginBottom: 16, position: "relative", overflow: "hidden" }}>
        <span style={{ position: "absolute", left: -80, bottom: -110, width: 240, height: 240, borderRadius: "50%", background: pass === false ? "var(--color-accent-200)" : "var(--color-accent-2-200)", opacity: 0.45 }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 140, height: 140, flex: "none" }}>
            <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="70" cy="70" r="60" fill="none" stroke="var(--color-neutral-300)" strokeWidth="14" />
              <circle cx="70" cy="70" r="60" fill="none" stroke={pass === false ? "var(--color-accent)" : "var(--color-accent-2-600)"} strokeWidth="14" strokeLinecap="round" strokeDasharray={scoreDash} />
            </svg>
            <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 34 }}>{score}%</span>
            </span>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <span className="card-kicker">Mock exam{examName ? ` · ${examName}` : ""}</span>
            <h1 style={{ margin: "4px 0 8px", fontSize: 34 }}>{pass === false ? "Below the pass mark" : pass === true ? "Pass" : "Complete"}</h1>
            <p style={{ margin: "0 0 16px", fontSize: 14, opacity: 0.75 }}>
              {minutesUsed} min used · {result.totalQuestions} questions · {result.correctCount} correct
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" onClick={practiceWrong}>Practice the misses</button>
              <button type="button" className="btn btn-secondary" onClick={() => go("mock", { newMock: true })}>New mock</button>
            </div>
          </div>
        </div>
      </div>

      <div className="card elev-sm" style={{ padding: "8px 18px 14px" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>#</th><th>Question</th><th>Yours</th><th>Correct</th><th>Result</th><th></th></tr></thead>
            <tbody>
              {result.breakdown.map((row, i) => {
                const qq = state.catalogBy[row.questionId];
                const yours = row.selectedAnswer.join(", ") || "—";
                const bookmarked = !!state.bookmarks[row.questionId];
                return (
                  <tr key={row.questionId}>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>{i + 1}</td>
                    <td style={{ maxWidth: 460 }}><span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{qq?.stem ?? ""}</span></td>
                    <td style={{ fontWeight: 600 }}>{yours}</td>
                    <td>{row.correctAnswers.join(", ")}<AnswerRevisionNotice revisedAt={row.answerRevisedAt} historical={row.answerRevision == null || row.answerRevision < row.currentAnswerRevision} gradedAnswers={row.gradedAnswers} /></td>
                    <td><span className="tag" style={{ background: row.isCorrect ? "var(--color-accent-2-100)" : "var(--color-accent-200)", color: row.isCorrect ? "var(--color-accent-2-800)" : "var(--color-accent-800)", fontSize: 10.5 }}>{row.isCorrect ? "Correct" : "Missed"}</span></td>
                    <td>
                      <button type="button" className="btn btn-ghost" onClick={() => setReviewQuestionId(row.questionId)}>Knowledge points</button>
                      <button
                        type="button" className="btn btn-ghost btn-icon" title="Bookmark"
                        onClick={() => toggleBookmark(row.questionId)}
                        style={{ color: bookmarked ? "var(--color-accent-800)" : "var(--color-text)" }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill={bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M7 4h10v16l-5-4-5 4z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {reviewQuestionId && <section style={{ marginTop: 16 }} aria-label="Question knowledge points">
        <h2 style={{ fontSize: 20 }}>{state.catalogBy[reviewQuestionId]?.externalId ?? "Question"}</h2>
        <RelatedKnowledgePoints key={reviewQuestionId} questionId={reviewQuestionId} />
      </section>}
    </div>
  );
}
