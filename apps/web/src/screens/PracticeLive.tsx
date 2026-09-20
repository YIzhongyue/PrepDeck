import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CURATED_MODELS, hasAnswer } from "@prepdeck/shared";
import { usePrepDeck } from "../store/PrepDeckContext";
import { SHOW_KEYBOARD_HINTS } from "../data/constants";
import { buildPracticePrompt, copyText } from "../lib/practicePrompt";
import { questionTypeLabel } from "../lib/questionTypes";
import QuestionContent from "../components/QuestionContent";
import AnswerRevisionNotice from "../components/AnswerRevisionNotice";
import MarkdownHighlightedText from "../components/MarkdownHighlightedText";
import NoteCard from "../components/NoteCard";
import RelatedKnowledgePoints from "../components/knowledgePoints/RelatedKnowledgePoints";
import UnlockKeyPrompt from "../components/UnlockKeyPrompt";
import type { Breakpoints } from "../lib/responsive";
import type { GradedAnswer, Question } from "../types";

const SHORTCUTS = [
  { key: "1 – 4", what: "select an option" },
  { key: "A – D", what: "select by letter" },
  { key: "Enter", what: "check / next" },
  { key: "B", what: "bookmark" }
];

function modelLabelFor(provider: "anthropic" | "openai", modelId: string): string {
  return CURATED_MODELS[provider].find((m) => m.id === modelId)?.label ?? modelId;
}

export default function PracticeLive({ bp }: { bp: Breakpoints }) {
  const {
    state, curQ, pick, submit, next, prevQ, endSession, toggleBookmark, capture,
    checkAiCache, genAi, useAlternateAi, setNoteDraft, addNote, setNoteVis, removeMark
  } = usePrepDeck();
  const q = curQ();

  const graded = q ? state.done[q.id] : undefined;
  const aiRec = q ? state.ai[q.id] : undefined;

  // FR-7.2: check the shared cache as soon as this question's review panel
  // opens (an answer has been committed), before ever prompting for a key.
  useEffect(() => {
    if (q && graded && !aiRec) checkAiCache(q);
  }, [q, graded, aiRec, checkAiCache]);

  // Desktop: cap the two-column area to the remaining viewport height so a
  // long AI explanation scrolls inside its own panel instead of stretching
  // the page (the question panel would otherwise end far above a big blank
  // gap below it). Mobile stays a single natural-height column.
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => setCopyStatus("idle"), [q?.id]);
  useLayoutEffect(() => {
    if (bp.narrow) { setGridHeight(null); return; }
    const el = gridRef.current;
    if (!el) return;
    const compute = () => {
      const top = el.getBoundingClientRect().top;
      setGridHeight(Math.max(360, window.innerHeight - top - 40));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [bp.narrow, q?.id, graded]);

  if (!q) return null;

  const gradedAnswer = state.graded[q.id];
  const chosen = state.sel[q.id] || [];
  const need = q.type === "multiple_choice" ? (q.chooseCount || 1) : 1;
  const providerLabel = state.provider === "anthropic" ? "Anthropic" : "OpenAI";
  const modelLabel = modelLabelFor(state.provider, state.model);
  const qNotes = state.notes.filter((n) => n.qid === q.id && (n.me || (n.vis === "shared" && state.showShared)));
  const rail = !bp.narrow && state.screen === "practice";
  const liveCols = !bp.narrow ? "minmax(0, 1.65fr) minmax(300px, 1fr)" : "1fr";
  const copyAsPrompt = async () => {
    if (!gradedAnswer) return;
    try {
      await copyText(buildPracticePrompt(q, chosen, gradedAnswer));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  return (
    <div style={{ animation: "pd-rise .22s ease both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" onClick={endSession} style={{ padding: "6px 14px" }}>End</button>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
            <span style={{ fontWeight: 600 }}>Question {state.idx + 1} of {state.queue.length}</span>
            <span style={{ color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>Free practice · no timer</span>
          </div>
          <div style={{ height: 7, borderRadius: 999, background: "var(--color-neutral-300)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round((state.idx / state.queue.length) * 100)}%`, background: "var(--color-accent)", borderRadius: 999, transition: "width .3s ease" }} />
          </div>
        </div>
        <button
          type="button" onClick={() => toggleBookmark()} className="btn btn-secondary btn-icon" title="Bookmark"
          style={{ background: state.bookmarks[q.id] ? "var(--color-accent-200)" : "transparent", color: state.bookmarks[q.id] ? "var(--color-accent-800)" : "var(--color-text)" }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill={state.bookmarks[q.id] ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4h10v16l-5-4-5 4z" />
          </svg>
        </button>
      </div>

      <div
        ref={gridRef}
        style={{
          display: "grid", gridTemplateColumns: liveCols, gap: 20,
          alignItems: gridHeight ? "stretch" : "start",
          height: gridHeight ?? undefined,
          minHeight: 0
        }}
      >
        <div
          className="card elev-sm"
          style={{
            padding: bp.phone ? 18 : "26px 28px",
            minHeight: 0,
            overflowY: gridHeight ? "auto" : "visible",
            overscrollBehavior: "contain"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="tag tag-neutral" style={{ whiteSpace: "nowrap" }}>{q.externalId}</span>
            <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>{questionTypeLabel(q)}</span>
            {q.tags.map((t) => <span key={t} className="tag tag-accent-2" style={{ whiteSpace: "nowrap" }}>{t}</span>)}
            {!!graded && (
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
          <div onMouseUp={() => { if (graded) capture(q.id, "stem"); }} style={{ margin: "14px 0 20px", fontSize: bp.phone ? 15 : 16.5, lineHeight: 1.6, textWrap: "pretty" }}>
            <QuestionContent src={q.stem} annotations={state.anns} qid={q.id} target="stem" show={!!graded} onRemoveMark={removeMark} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <AnswerRevisionNotice revisedAt={gradedAnswer?.answerRevisedAt} />
            {q.type === "fill_blank" ? <label>Your answer<input className="input" value={chosen[0] ?? ""} disabled={!!graded} onChange={e => pick(q, e.target.value)} />{graded && <p>Accepted answers: {gradedAnswer?.correctAnswers.join(", ")}</p>}</label> : optionRows(q, state, graded, gradedAnswer, pick, capture, removeMark)}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" onClick={prevQ} style={{ padding: "8px 14px" }}>Back</button>
            {!graded && (
              <button type="button" className="btn btn-primary" onClick={submit} disabled={chosen.length !== need || !hasAnswer(q.type, chosen)} style={{ marginLeft: "auto" }}>
                {q.type === "multiple_choice" ? `Check (${chosen.length}/${need})` : "Check answer"}
              </button>
            )}
            {graded && (
              <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                <span className="tag" style={{ background: graded === "ok" ? "var(--color-accent-2-200)" : "var(--color-accent-200)", color: graded === "ok" ? "var(--color-accent-2-900)" : "var(--color-accent-800)", fontSize: 12, padding: "5px 12px" }}>
                  {graded === "ok" ? "Correct" : "Incorrect — added to wrong book"}
                </span>
                <button type="button" className="btn btn-primary" onClick={next}>{state.idx + 1 >= state.queue.length ? "Finish" : "Next question"}</button>
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex", flexDirection: "column", gap: 14,
            position: gridHeight ? "static" : rail ? "sticky" : "static",
            top: 18,
            minHeight: 0,
            overflowY: gridHeight ? "auto" : "visible",
            overscrollBehavior: "contain"
          }}
        >
          {!graded && (
            <div className="card" style={{ padding: 18, background: "color-mix(in srgb, var(--color-surface) 55%, var(--color-bg))", gap: 10 }}>
              <span className="card-kicker">Answering</span>
              <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>Explanations, highlights and notes are hidden until you commit an answer.</p>
              {SHOW_KEYBOARD_HINTS && !bp.phone && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4, fontSize: 12 }}>
                  {SHORTCUTS.map((k) => (
                    <span key={k.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <kbd style={{ font: "inherit", fontSize: 10.5, padding: "2px 7px", borderRadius: 6, border: "1px solid var(--color-divider)", background: "var(--color-neutral-100)" }}>{k.key}</kbd>
                      <span style={{ opacity: 0.7 }}>{k.what}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {!!graded && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="card elev-sm" style={{ padding: 18, gap: 10 }}>
                <div
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    position: gridHeight ? "sticky" : "static",
                    top: gridHeight ? -18 : undefined,
                    margin: gridHeight ? "-18px -18px 0" : undefined,
                    padding: gridHeight ? "18px 18px 10px" : undefined,
                    background: gridHeight ? "var(--color-surface)" : undefined,
                    borderTopLeftRadius: gridHeight ? "inherit" : undefined,
                    borderTopRightRadius: gridHeight ? "inherit" : undefined,
                    zIndex: gridHeight ? 1 : undefined
                  }}
                >
                  <span className="card-kicker" style={{ marginRight: "auto" }}>Explanation</span>
                  {/* <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={copyAsPrompt}
                    style={{ padding: "5px 10px", fontSize: 11 }}
                    aria-label="Copy question and answers as a Markdown prompt"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="9" y="9" width="11" height="11" rx="2" />
                      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
                    </svg>
                    {copyStatus === "copied" ? "Copied!" : copyStatus === "error" ? "Copy failed" : "copy as prompt"}
                  </button> */}
                  <span className="tag" style={{ background: aiRec && aiRec.status === "ready" ? "var(--color-accent-2-100)" : "var(--color-neutral-200)", color: aiRec && aiRec.status === "ready" ? "var(--color-accent-2-800)" : "var(--color-neutral-800)", fontSize: 10 }}>
                    {aiRec && aiRec.status === "ready" && aiRec.provider && aiRec.model
                      ? (aiRec.cached ? `cached · ${modelLabelFor(aiRec.provider, aiRec.model)}` : `generated · ${modelLabelFor(aiRec.provider, aiRec.model)}`)
                      : "not cached"}
                  </span>
                </div>
                <span className="sr-only" aria-live="polite">
                  {copyStatus === "copied" ? "Markdown prompt copied to clipboard." : copyStatus === "error" ? "Could not copy the Markdown prompt." : ""}
                </span>
                {!!gradedAnswer?.explanation && (
                  <div style={{ margin: 0, fontSize: 13, lineHeight: 1.6, padding: "12px 14px", borderRadius: 16, background: "var(--color-neutral-100)" }}><QuestionContent src={gradedAnswer.explanation} /></div>
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
              <RelatedKnowledgePoints key={q.id} questionId={q.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function optionRows(
  q: Question,
  state: ReturnType<typeof usePrepDeck>["state"],
  graded: "ok" | "no" | undefined,
  gradedAnswer: GradedAnswer | undefined,
  pick: ReturnType<typeof usePrepDeck>["pick"],
  capture: ReturnType<typeof usePrepDeck>["capture"],
  removeMark: ReturnType<typeof usePrepDeck>["removeMark"]
) {
  const chosen = state.sel[q.id] || [];
  const correctAnswers = gradedAnswer?.correctAnswers ?? [];
  return (q.options ?? []).map((o, i) => {
    const on = chosen.indexOf(o.id) >= 0;
    const right = correctAnswers.indexOf(o.id) >= 0;
    let bg = "var(--color-neutral-100)", bd = "var(--color-divider)", badgeBg = "var(--color-neutral-200)", badgeFg = "var(--color-neutral-800)", mark: string = o.id;
    if (!graded && on) { bg = "var(--color-accent-100)"; bd = "var(--color-accent)"; badgeBg = "var(--color-accent)"; badgeFg = "var(--color-bg)"; }
    if (graded && right) { bg = "var(--color-accent-2-100)"; bd = "var(--color-accent-2-500)"; badgeBg = "var(--color-accent-2-600)"; badgeFg = "var(--color-accent-2-100)"; mark = "✓"; }
    if (graded && on && !right) { bg = "var(--color-accent-200)"; bd = "var(--color-accent-600)"; badgeBg = "var(--color-accent-700)"; badgeFg = "var(--color-accent-100)"; mark = "✕"; }
    return (
      <div
        key={o.id}
        role={!graded ? "button" : undefined}
        tabIndex={!graded ? 0 : undefined}
        onClick={() => { if (!graded) pick(q, o.id); }}
        onKeyDown={(e) => { if (!graded && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(q, o.id); } }}
        onMouseUp={() => { if (graded) capture(q.id, `opt:${o.id}`); }}
        style={{
          display: "flex", alignItems: "flex-start", gap: 13, textAlign: "left", width: "100%", padding: "13px 15px",
          borderRadius: 20, cursor: graded ? "default" : "pointer", font: "inherit", fontSize: 14.5, lineHeight: 1.5,
          background: bg, border: `1.5px solid ${bd}`, color: "var(--color-text)", transition: "background .15s ease, border-color .15s ease"
        }}
      >
        <span style={{ width: 26, height: 26, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12.5, background: badgeBg, color: badgeFg }}>{mark}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <QuestionContent src={o.text} annotations={state.anns} qid={q.id} target={`opt:${o.id}`} show={!!graded} onRemoveMark={removeMark} />
        </div>
        {!graded && (
          <span style={{ flex: "none", fontSize: 10, padding: "2px 7px", borderRadius: 6, border: "1px solid var(--color-divider)", color: "color-mix(in srgb, var(--color-text) 50%, transparent)" }}>{i + 1}</span>
        )}
      </div>
    );
  });
}
