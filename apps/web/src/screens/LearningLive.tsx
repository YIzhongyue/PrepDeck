import StructuredResponse from "../components/StructuredResponse";
import { useLayoutEffect, useRef, useState } from "react";
import { CURATED_MODELS } from "@prepdeck/shared";
import { buildLearningPrompt, copyText } from "../lib/practicePrompt";
import { usePrepDeck } from "../store/PrepDeckContext";
import QuestionContent from "../components/QuestionContent";
import QuestionContentGate from "../components/QuestionContentGate";
import AnswerRevisionNotice from "../components/AnswerRevisionNotice";
import MarkdownHighlightedText from "../components/MarkdownHighlightedText";
import NoteCard from "../components/NoteCard";
import UnlockKeyPrompt from "../components/UnlockKeyPrompt";
import RelatedKnowledgePoints from "../components/knowledgePoints/RelatedKnowledgePoints";
import type { Breakpoints } from "../lib/responsive";
import { questionTypeLabel } from "../lib/questionTypes";
import type { Question } from "../types";

function modelLabelFor(provider: "anthropic" | "openai", modelId: string): string {
  return CURATED_MODELS[provider].find((m) => m.id === modelId)?.label ?? modelId;
}

// docs/requirements/practice-and-learning-modes.md — Learning Mode. Unlike PracticeLive, there is no answer to
// pick or submit: the correct answer, this user's own answer history, any
// AI/official explanation, and notes/annotations are all shown as soon as
// the question loads (FR-14.3–FR-14.6) — this screen is a read-through, not
// a quiz. No attempt is created (FR-14.7): toggleBookmark/capture/addNote
// below are the same actions PracticeLive uses, since Learning Mode is a
// "review context" per FR-8.3/FR-11.6.
export default function LearningLive({ bp }: { bp: Breakpoints }) {
  const {
    state, width, learningQ, learningNext, learningPrev, learningGotoSequence, go, toggleBookmark, capture,
    genAi, useAlternateAi, setNoteDraft, addNote, setNoteVis, removeMark
  } = usePrepDeck();
  const q = learningQ();
  const detail = q ? state.lDetail[q.id] : undefined;
  const aiRec = q ? state.ai[q.id] : undefined;
  const [jumpText, setJumpText] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const copyRequest = useRef(0);
  useLayoutEffect(() => {
    setCopyStatus("idle");
    // Ignore clipboard completions after navigating away, including back to this question.
    return () => { copyRequest.current += 1; };
  }, [q?.id]);

  const desktop = width >= 1100;
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!desktop) { setGridHeight(null); return; }
    const el = gridRef.current;
    if (!el) return;
    const compute = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setGridHeight(Math.max(360, window.innerHeight - top - 40));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [desktop, width, q?.id]);

  if (!q) return null;

  const ready = detail?.status === "ready";
  const correctAnswers = detail?.correctAnswers ?? [];
  const providerLabel = state.provider === "anthropic" ? "Anthropic" : "OpenAI";
  const modelLabel = modelLabelFor(state.provider, state.model);
  const qNotes = state.notes.filter((n) => n.qid === q.id && (n.me || (n.vis === "shared" && state.showShared)));
  const liveCols = desktop ? "minmax(0, 1.65fr) minmax(300px, 1fr)" : "1fr";
  const atEnd = state.lIdx + 1 >= state.lQueue.length;
  const copyAsPrompt = async () => {
    if (!ready || !detail?.correctAnswers) return;
    const request = ++copyRequest.current;
    const examName = state.exams.find((exam) => exam.id === state.examId)?.name ?? "Unknown exam";
    try {
      await copyText(buildLearningPrompt(q, examName, {
        correctAnswers: detail.correctAnswers,
        explanation: detail.explanation ?? null
      }));
      if (request === copyRequest.current) setCopyStatus("copied");
    } catch {
      if (request === copyRequest.current) setCopyStatus("error");
    }
  };

  const jumpToInput = () => {
    const n = parseInt(jumpText, 10);
    if (Number.isFinite(n) && n >= 1) learningGotoSequence(n);
    setJumpText("");
  };

  return (
    <div className="learning-live">
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" onClick={() => go("learning")} style={{ padding: "6px 14px" }}>End</button>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4, fontSize: 12, marginBottom: 6 }}>
            <span style={{ fontWeight: 600 }}>Question {state.lIdx + 1} of {state.lQueue.length} · #{q.sequenceNumber}</span>
            <span style={{ color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>Learning mode · read-through</span>
          </div>
          <div style={{ height: 7, borderRadius: 999, background: "var(--color-neutral-300)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round(((state.lIdx + 1) / state.lQueue.length) * 100)}%`, background: "var(--color-accent)", borderRadius: 999, transition: "width .3s ease" }} />
          </div>
        </div>
        <button
          type="button" onClick={() => toggleBookmark(q.id)} className="btn btn-secondary btn-icon" title="Bookmark"
          style={{ background: state.bookmarks[q.id] ? "var(--color-accent-200)" : "transparent", color: state.bookmarks[q.id] ? "var(--color-accent-800)" : "var(--color-text)" }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill={state.bookmarks[q.id] ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4h10v16l-5-4-5 4z" />
          </svg>
        </button>
      </div>

      <div
        ref={gridRef}
        className="learning-grid"
        style={{ display: "grid", gridTemplateColumns: liveCols, gap: 20, alignItems: gridHeight ? "stretch" : "start", height: gridHeight ?? undefined, minHeight: 0 }}
      >
        <div className="card elev-sm" style={{ padding: bp.phone ? 18 : "26px 28px", minWidth: 0, minHeight: 0, overflowY: gridHeight ? "auto" : "visible", overscrollBehavior: "contain" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="tag tag-neutral">{q.externalId}</span>
            <span className="tag tag-outline">
              {questionTypeLabel(q)}
            </span>
            {q.tags.map((t) => <span key={t} className="tag tag-accent-2">{t}</span>)}
            {ready && detail?.correctAnswers && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={copyAsPrompt}
                style={{ padding: "5px 10px", fontSize: 11, marginLeft: "auto" }}
                aria-label="Copy question and answers as a Markdown prompt"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
                </svg>
                {copyStatus === "copied" ? "Copied!" : copyStatus === "error" ? "Copy failed" : "copy as prompt"}
              </button>
            )}
          </div>
          <span className="sr-only" aria-live="polite">
            {copyStatus === "copied" ? "Markdown prompt copied to clipboard." : copyStatus === "error" ? "Could not copy the Markdown prompt." : ""}
          </span>
          <QuestionContentGate question={q} learning>
            <div onMouseUp={() => capture(q.id, "stem")} style={{ margin: "14px 0 20px", fontSize: bp.phone ? 15 : 16.5, lineHeight: 1.6, textWrap: "pretty" }}>
              <QuestionContent src={q.stem} content={q.content} annotations={state.anns} qid={q.id} target="stem" show={true} onRemoveMark={removeMark} />
            </div>

            <AnswerRevisionNotice revisedAt={detail?.answerRevisedAt} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {q.content && (q.type === "ordering" || q.type === "matching") ? <StructuredResponse content={q.content} selected={ready ? correctAnswers : []} onChange={() => {}} disabled correct={ready ? correctAnswers : undefined} /> : q.options
                ? optionRows(q, state, correctAnswers, ready, capture, removeMark)
                : (
                  <div style={{ padding: "13px 15px", borderRadius: 20, background: "var(--color-accent-2-100)", border: "1.5px solid var(--color-accent-2-500)" }}>
                    <span style={{ display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.7, marginBottom: 6 }}>Accepted answer(s)</span>
                    {ready ? (
                      <span style={{ fontSize: 14.5 }}>{correctAnswers.join(" · ") || "—"}</span>
                    ) : (
                      <span style={{ fontSize: 13, opacity: 0.6 }}>Loading…</span>
                    )}
                  </div>
                )}
            </div>

          </QuestionContentGate>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" onClick={learningPrev} disabled={state.lIdx === 0} style={{ padding: "8px 14px" }}>Back</button>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number" min={1} className="input" placeholder="Jump to #"
                value={jumpText} onChange={(e) => setJumpText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") jumpToInput(); }}
                style={{ width: 100, padding: "6px 10px" }}
              />
              <button type="button" className="btn btn-secondary" onClick={jumpToInput} style={{ padding: "7px 12px" }}>Go</button>
            </div>
            <button type="button" className="btn btn-primary" onClick={learningNext} disabled={atEnd} style={{ marginLeft: "auto" }}>
              {atEnd ? "Last question" : "Next question"}
            </button>
          </div>
        </div>

        <div
          className="learning-panels"
          style={{
            minWidth: 0, minHeight: 0,
            overflowY: gridHeight ? "auto" : "visible", overscrollBehavior: "contain"
          }}
        >
          <div className="card elev-sm learning-history" style={{ padding: 18, gap: 10 }}>
            <span className="card-kicker">Your history</span>
            {!ready && <span style={{ fontSize: 12.5, opacity: 0.7 }}>Loading…</span>}
            {ready && !detail?.history?.length && (
              <p style={{ margin: 0, fontSize: 12.5, opacity: 0.7 }}>Not yet attempted in Practice or Mock mode.</p>
            )}
            {ready && detail?.history?.map((h, i) => (
              <div
                key={`${h.attemptId}-${i}`}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 14, background: "var(--color-neutral-100)", fontSize: 12.5, flexWrap: "wrap" }}
              >
                <span
                  className="tag"
                  style={{ background: h.isCorrect ? "var(--color-accent-2-200)" : "var(--color-accent-200)", color: h.isCorrect ? "var(--color-accent-2-900)" : "var(--color-accent-800)", fontSize: 10.5, textTransform: "capitalize" }}
                >
                  {h.mode}
                </span>
                <span style={{ flex: 1, minWidth: 120 }}>{h.isCorrect ? "Correct" : "Incorrect"} · answered {h.selectedAnswer.join(", ") || "—"}</span>
                <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>{new Date(h.answeredAt).toLocaleDateString()}</span>
                <AnswerRevisionNotice revisedAt={detail?.answerRevisedAt} historical={h.answerRevision == null || h.answerRevision < (detail?.answerRevision ?? 1)} gradedAnswers={h.gradedAnswers} />
              </div>
            ))}
          </div>

          <div className="card elev-sm" style={{ padding: 18, gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="card-kicker" style={{ marginRight: "auto" }}>Explanation</span>
              <span
                className="tag"
                style={{
                  background: aiRec && aiRec.status === "ready" ? "var(--color-accent-2-100)" : "var(--color-neutral-200)",
                  color: aiRec && aiRec.status === "ready" ? "var(--color-accent-2-800)" : "var(--color-neutral-800)", fontSize: 10
                }}
              >
                {aiRec && aiRec.status === "ready" && aiRec.provider && aiRec.model
                  ? (aiRec.cached ? `cached · ${modelLabelFor(aiRec.provider, aiRec.model)}` : `generated · ${modelLabelFor(aiRec.provider, aiRec.model)}`)
                  : "not cached"}
              </span>
            </div>
            {!!detail?.explanation && (
              <div style={{ margin: 0, fontSize: 13, lineHeight: 1.6, padding: "12px 14px", borderRadius: 16, background: "var(--color-neutral-100)" }}><QuestionContent src={detail.explanation} /></div>
            )}

            {aiRec && aiRec.status === "ready" && (
              <>
                <MarkdownHighlightedText
                  src={aiRec.content ?? ""} annotations={state.anns} qid={q.id} target="ai" show
                  onMouseUp={() => capture(q.id, "ai")}
                  onRemoveMark={removeMark}
                />
                {aiRec.canManage && (
                  <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start", fontSize: 12 }} onClick={() => genAi(q, true)}>
                    Regenerate
                  </button>
                )}
              </>
            )}

            {(!aiRec || aiRec.status === "checking" || aiRec.status === "generating") && (
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, opacity: 0.7 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" style={{ animation: "pd-spin 1s linear infinite" }}>
                  <path d="M12 3a9 9 0 019 9" />
                </svg>
                <span>{aiRec?.status === "generating" ? `Relaying to ${providerLabel} …` : "Checking the shared cache …"}</span>
              </span>
            )}

            {aiRec && (aiRec.status === "idle" || aiRec.status === "error") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {!!aiRec.alternates?.length && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {aiRec.alternates.map((alt) => (
                      <div key={`${alt.provider}:${alt.model}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 14, background: "var(--color-neutral-100)" }}>
                        <span style={{ fontSize: 12, flex: 1 }}>Already explained with <strong>{modelLabelFor(alt.provider, alt.model)}</strong></span>
                        <button type="button" className="btn btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => useAlternateAi(q, alt)}>Show it</button>
                      </div>
                    ))}
                  </div>
                )}
                {aiRec.status === "error" && (
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-danger, #c0392b)" }}>{aiRec.error}</p>
                )}
                {state.hasSessionKey ? (
                  <>
                    <p style={{ margin: 0, fontSize: 12.5, opacity: 0.7 }}>
                      No cached explanation for {providerLabel} · {modelLabel} yet.
                    </p>
                    <button type="button" className="btn btn-primary btn-block" onClick={() => genAi(q)}>
                      Generate explanation
                    </button>
                  </>
                ) : state.keyMode === "encrypted" && state.hasStoredKey ? (
                  <UnlockKeyPrompt onUnlock={() => genAi(q)} />
                ) : (
                  <>
                    <p style={{ margin: 0, fontSize: 12.5, opacity: 0.7 }}>
                      No key loaded — add one in Settings to generate a fresh explanation.
                    </p>
                    <button type="button" className="btn btn-primary btn-block" disabled>
                      Generate explanation
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="card elev-sm" style={{ padding: 18, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="card-kicker" style={{ marginRight: "auto" }}>Notes</span>
              <span style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 50%, transparent)" }}>{qNotes.length} visible</span>
            </div>
            {qNotes.map((n) => <NoteCard key={n.id} note={n} />)}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                className="input" placeholder="Write a note for this question…" value={state.noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)} style={{ minHeight: 70, borderRadius: 18 }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", gap: 6, flex: 1 }}>
                  {(["private", "shared"] as const).map((v) => {
                    const on = state.noteVis === v;
                    return (
                      <button
                        key={v} type="button" onClick={() => setNoteVis(v)}
                        style={{ flex: 1, padding: "7px 10px", borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 12.5, whiteSpace: "nowrap", background: on ? "var(--color-accent)" : "transparent", color: on ? "var(--color-bg)" : "var(--color-text)", border: `1.5px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}` }}
                      >
                        {v === "private" ? "Private" : "Shared"}
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="btn btn-primary" onClick={() => addNote(q.id)} style={{ padding: "8px 16px" }}>Save</button>
              </div>
            </div>
          </div>

          <div className="learning-related"><RelatedKnowledgePoints questionId={q.id} /></div>
        </div>
      </div>
    </div>
  );
}

function optionRows(
  q: Question,
  state: ReturnType<typeof usePrepDeck>["state"],
  correctAnswers: string[],
  ready: boolean,
  capture: ReturnType<typeof usePrepDeck>["capture"],
  removeMark: ReturnType<typeof usePrepDeck>["removeMark"]
) {
  return (q.options ?? []).map((o) => {
    const right = ready && correctAnswers.indexOf(o.id) >= 0;
    let bg = "var(--color-neutral-100)", bd = "var(--color-divider)", badgeBg = "var(--color-neutral-200)", badgeFg = "var(--color-neutral-800)", mark: string = o.id;
    if (right) { bg = "var(--color-accent-2-100)"; bd = "var(--color-accent-2-500)"; badgeBg = "var(--color-accent-2-600)"; badgeFg = "var(--color-accent-2-100)"; mark = "✓"; }
    return (
      <div
        key={o.id}
        onMouseUp={() => capture(q.id, `opt:${o.id}`)}
        style={{
          display: "flex", alignItems: "flex-start", gap: 13, width: "100%", padding: "13px 15px",
          borderRadius: 20, fontSize: 14.5, lineHeight: 1.5,
          background: bg, border: `1.5px solid ${bd}`, color: "var(--color-text)"
        }}
      >
        <span style={{ width: 26, height: 26, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12.5, background: badgeBg, color: badgeFg }}>{mark}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <QuestionContent src={o.text} content={q.content} optionId={o.id} annotations={state.anns} qid={q.id} target={`opt:${o.id}`} show={true} onRemoveMark={removeMark} />
        </div>
      </div>
    );
  });
}
