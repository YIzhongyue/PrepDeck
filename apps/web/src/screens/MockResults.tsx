import AnswerRevisionNotice from "../components/AnswerRevisionNotice";
import { useState } from "react";
import RelatedKnowledgePoints from "../components/knowledgePoints/RelatedKnowledgePoints";
import { IC, Icon } from "../components/study/StudyKit";
import { breakpointsFor } from "../lib/responsive";
import { usePrepDeck } from "../store/PrepDeckContext";

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

type Filter = "all" | "missed" | "correct";

export default function MockResults() {
  const { state, width, practiceWrong, go, toggleBookmark } = usePrepDeck();
  const result = state.mockResult;
  const [reviewQuestionId, setReviewQuestionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  if (!result) return null;

  const bp = breakpointsFor(width);
  const score = result.score;
  const pass = result.passed;
  const examName = state.exams.find((e) => e.id === state.examId)?.name ?? "";
  const minutesUsed = Math.round(result.durationSeconds / 60);
  const total = result.totalQuestions;
  const missed = result.breakdown.filter((r) => !r.isCorrect).length;
  const unanswered = result.breakdown.filter((r) => !r.isCorrect && r.selectedAnswer.length === 0).length;
  const correctRows = result.breakdown.length - missed;
  const rows = result.breakdown
    .map((row, i) => ({ row, n: i + 1 }))
    .filter(({ row }) => filter === "all" || (filter === "missed" ? !row.isCorrect : row.isCorrect));
  const pace = total ? (result.durationSeconds / 60 / total).toFixed(1) : "0";

  const metrics = [
    { k: "Correct", v: String(result.correctCount), sub: `of ${total}`, icon: IC.circleCheck, tone: "ok" },
    { k: "Missed", v: String(missed), sub: unanswered ? `${unanswered} left unanswered` : "to review", icon: IC.circleX, tone: "bad" },
    { k: "Time used", v: `${minutesUsed} min`, sub: `${pace} min / question`, icon: IC.clock, tone: "" }
  ];

  return (
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      <div className="st-results">
        <div className="st-card st-hero">
          <div className="st-ring" data-pass={pass === false ? "false" : "true"}>
            <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden="true">
              <circle className="st-ring-track" cx="64" cy="64" r={RING_R} fill="none" strokeWidth="12" />
              <circle className="st-ring-value" cx="64" cy="64" r={RING_R} fill="none" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${((Math.max(0, Math.min(100, score)) / 100) * RING_C).toFixed(1)} ${RING_C.toFixed(2)}`} />
            </svg>
            <span className="st-ring-label">{score}%</span>
          </div>
          <div className="st-hero-text">
            <div className="st-hero-kicker">
              <span>Mock exam{examName ? ` · ${examName}` : ""}</span>
              {pass === true && <span className="st-badge st-badge--ok"><Icon d={IC.trophy} size={12} />Passed</span>}
              {pass === false && <span className="st-badge st-badge--bad"><Icon d={IC.target} size={12} />Not passed</span>}
            </div>
            <h1>{pass === false ? "Below the pass mark" : pass === true ? "Above the pass mark" : "Exam complete"}</h1>
            <p className="st-hero-sub">{minutesUsed} min used · {total} questions · {result.correctCount} correct</p>
          </div>
          <div className="st-hero-actions">
            <button type="button" className="st-btn" onClick={() => go("mock", { newMock: true })}><Icon d={IC.rotate} />New mock</button>
            <button type="button" className="st-btn st-btn--primary" onClick={practiceWrong} disabled={missed === 0}>
              <Icon d={IC.target} />{missed === 0 ? "No misses to practice" : `Practice the ${missed} ${missed === 1 ? "miss" : "misses"}`}
            </button>
          </div>
        </div>

        <div className="st-metrics" style={{ gridTemplateColumns: bp.narrow ? "minmax(0, 1fr)" : "repeat(3, minmax(0, 1fr))" }}>
          {metrics.map((m) => (
            <div key={m.k} className="st-card st-metric">
              <div className="st-metric-k"><span className={`st-metric-icon${m.tone ? ` st-metric-icon--${m.tone}` : ""}`}><Icon d={m.icon} /></span>{m.k}</div>
              <div className="st-metric-v"><span>{m.v}</span><span>{m.sub}</span></div>
            </div>
          ))}
        </div>

        <div className="st-card st-breakdown">
          <div className="st-breakdown-head">
            <div>
              <h2 className="st-breakdown-title">Question breakdown</h2>
              <div className="st-breakdown-sub">Bookmark anything worth revisiting, or open its knowledge points.</div>
            </div>
            <div className="st-segmented" role="group" aria-label="Filter questions">
              {([["all", `All ${result.breakdown.length}`], ["missed", `Missed ${missed}`], ["correct", `Correct ${correctRows}`]] as const).map(([k, label]) => (
                <button key={k} type="button" className="st-seg-btn" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="st-table-wrap">
            <table className="st-table">
              <thead><tr><th>#</th><th>Question</th><th>Domain</th><th>Yours</th><th>Correct</th><th>Result</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map(({ row, n }) => {
                  const qq = state.catalogBy[row.questionId];
                  const yours = row.selectedAnswer.join(", ") || "—";
                  const bookmarked = !!state.bookmarks[row.questionId];
                  return (
                    <tr key={row.questionId}>
                      <td className="st-num">{n}</td>
                      <td className="st-stem"><span title={qq?.stem}>{qq?.stem ?? ""}</span></td>
                      <td style={{ whiteSpace: "nowrap" }}>{qq?.tags.join(", ") || "—"}</td>
                      <td className="st-yours">{yours}</td>
                      <td>{row.correctAnswers.join(", ")}<AnswerRevisionNotice revisedAt={row.answerRevisedAt} historical={row.answerRevision == null || row.answerRevision < row.currentAnswerRevision} gradedAnswers={row.gradedAnswers} /></td>
                      <td>
                        <span className={`st-badge ${row.isCorrect ? "st-badge--ok" : "st-badge--bad"}`} style={{ whiteSpace: "nowrap" }}>
                          <Icon d={row.isCorrect ? IC.circleCheck : IC.circleX} size={12} />{row.isCorrect ? "Correct" : "Missed"}
                        </span>
                      </td>
                      <td className="st-actions">
                        <button type="button" className="st-icon-btn" title="Knowledge points" aria-label="Knowledge points" aria-pressed={reviewQuestionId === row.questionId} onClick={() => setReviewQuestionId(row.questionId)}>
                          <Icon d={IC.lightbulb} size={18} />
                        </button>
                        <button type="button" className="st-icon-btn" title="Bookmark" aria-label="Bookmark" aria-pressed={bookmarked} onClick={() => toggleBookmark(row.questionId)}>
                          <Icon d={IC.bookmark} size={18} fill={bookmarked ? "currentColor" : "none"} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <div className="st-table-empty">No questions in this view.</div>}
          </div>
        </div>

        {reviewQuestionId && (
          <section className="st-card" aria-label="Question knowledge points">
            <div className="st-card-title">{state.catalogBy[reviewQuestionId]?.externalId ?? "Question"}</div>
            <RelatedKnowledgePoints key={reviewQuestionId} questionId={reviewQuestionId} embedded />
          </section>
        )}
      </div>
    </div>
  );
}
