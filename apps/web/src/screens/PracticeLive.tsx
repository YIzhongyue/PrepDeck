import StructuredResponse from "../components/StructuredResponse";
import { useEffect, useState } from "react";
import { usePrepDeck } from "../store/PrepDeckContext";
import { SHOW_KEYBOARD_HINTS } from "../data/constants";
import { buildPracticePrompt, copyText } from "../lib/practicePrompt";
import { canCheckAnswer, practiceShortcutHints, requiredSelections } from "../lib/practiceShortcuts";
import { questionTypeLabel } from "../lib/questionTypes";
import QuestionContent from "../components/QuestionContent";
import QuestionContentGate from "../components/QuestionContentGate";
import AnswerRevisionNotice from "../components/AnswerRevisionNotice";
import RelatedKnowledgePoints from "../components/knowledgePoints/RelatedKnowledgePoints";
import {
  BookmarkButton, CopyPromptButton, ExplanationPanel, IC, Icon, NotesPanel, OptionRow, QuestionBadges, ReviewTabs, usePinnedCard, visibleNotes,
  type OptionState
} from "../components/study/StudyKit";
import type { Breakpoints } from "../lib/responsive";
import type { GradedAnswer, Question } from "../types";

// Longer sessions fall back to a plain bar: segments under ~6px stop reading as questions.
const MAX_SEGMENTS = 60;

export default function PracticeLive({ bp }: { bp: Breakpoints }) {
  const {
    state, curQ, pick, submit, next, prevQ, endSession, toggleBookmark, capture, checkAiCache, removeMark
  } = usePrepDeck();
  const q = curQ();

  const graded = q ? state.done[q.id] : undefined;
  const aiRec = q ? state.ai[q.id] : undefined;

  // FR-7.2: check the shared cache as soon as this question's review panel
  // opens (an answer has been committed), before ever prompting for a key.
  useEffect(() => {
    if (q && graded && !aiRec) checkAiCache(q);
  }, [q, graded, aiRec, checkAiCache]);

  // Every newly graded question opens on its explanation.
  const [tab, setTab] = useState("exp");
  useEffect(() => setTab("exp"), [q?.id, graded]);

  // Desktop: cap the two-column area to the remaining viewport height so a
  // long AI explanation scrolls inside its own panel. Narrow screens size only
  // the question card, with the review panels following below it on the page.
  // Either way the card keeps its header and footer on screen while only the
  // stem and answers scroll.
  const { gridRef, bodyRef, fitHeight } = usePinnedCard(q?.id, bp.phone, [graded, state.workspaceNotice, state.actionError]);
  const gridHeight = bp.narrow ? null : fitHeight;
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => setCopyStatus("idle"), [q?.id]);

  if (!q) return null;

  const gradedAnswer = state.graded[q.id];
  const contentPending = !!q.hasContent && !q.content;
  const chosen = state.sel[q.id] || [];
  const need = requiredSelections(q);
  const canCheck = canCheckAnswer(q, chosen);
  const liveCols = !bp.narrow ? "minmax(0, 1.65fr) minmax(300px, 1fr)" : "minmax(0, 1fr)";
  const bookmarked = !!state.bookmarks[q.id];
  const last = state.idx + 1 >= state.queue.length;
  const results = state.queue.map((id) => state.done[id]);
  const okCount = results.filter((r) => r === "ok").length;
  const noCount = results.filter((r) => r === "no").length;
  const noteCount = visibleNotes(state, q.id).length;
  const correctAnswers = gradedAnswer?.correctAnswers ?? [];
  const scroller = gridHeight ? "auto" : "visible";

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
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      <header className="st-head">
        <div className="st-head-row">
          <div className="st-head-titles">
            <div className="st-kicker"><Icon d={IC.squarePen} />Free practice</div>
            <h1 className="st-title">Question {state.idx + 1} <span className="st-title-sub">of {state.queue.length}</span></h1>
          </div>
          <BookmarkButton on={bookmarked} onClick={() => toggleBookmark()} />
          <button type="button" className="st-btn" onClick={endSession}><Icon d={IC.x} />{bp.phone ? "End" : "End session"}</button>
        </div>
        {state.queue.length <= MAX_SEGMENTS ? (
          <div className="st-segs" aria-hidden="true">
            {state.queue.map((id, i) => (
              <span key={id} className="st-seg" data-state={results[i] ?? (i === state.idx ? "current" : "empty")} style={{ animationDelay: `${i * 25}ms` }} />
            ))}
          </div>
        ) : (
          <div className="st-bar" aria-hidden="true"><span style={{ width: `${Math.round((state.idx / state.queue.length) * 100)}%` }} /></div>
        )}
        <div className="st-stats">
          <span><span className="st-ic-ok"><Icon d={IC.circleCheck} /></span>{okCount} correct</span>
          <span><span className="st-ic-bad"><Icon d={IC.circleX} /></span>{noCount} incorrect</span>
          <span><span className="st-ic-muted"><Icon d={IC.timerOff} /></span>No timer · feedback per question</span>
        </div>
      </header>

      <div
        ref={gridRef}
        className="st-grid"
        style={{ gridTemplateColumns: liveCols, alignItems: gridHeight ? "stretch" : "start", height: gridHeight ?? undefined }}
      >
        <section
          className="st-card st-q st-q--pinned" aria-label="Question"
          style={{ height: bp.narrow ? fitHeight ?? undefined : undefined }}
        >
          <div className="st-q-head">
            <QuestionBadges label={q.externalId} typeLabel={questionTypeLabel(q)} multi={q.type === "multiple_choice"} tags={q.tags}>
              {!!graded && !contentPending && <CopyPromptButton status={copyStatus} onClick={copyAsPrompt} />}
            </QuestionBadges>
          </div>
          {/* Practice lets the wheel hand off to the page at the top and bottom of the question. */}
          <div className="st-q-body" ref={bodyRef} style={{ overscrollBehavior: "auto" }}>
            <QuestionContentGate question={q}>
              <div className="st-stem" onMouseUp={() => { if (graded) capture(q.id, "stem"); }}>
                <QuestionContent src={q.stem} content={q.content} annotations={state.anns} qid={q.id} target="stem" show={!!graded} onRemoveMark={removeMark} />
              </div>

              <div className="st-opts">
                <AnswerRevisionNotice revisedAt={gradedAnswer?.answerRevisedAt} />
                {q.content && (q.type === "ordering" || q.type === "matching") ? (
                  <StructuredResponse content={q.content} selected={chosen} onChange={answer => pick(q, answer)} disabled={!!graded} correct={graded ? correctAnswers : undefined} />
                ) : q.type === "fill_blank" ? (
                  <label className="st-field">Your answer
                    <input
                      className="st-input" value={chosen[0] ?? ""} disabled={!!graded} onChange={e => pick(q, e.target.value)}
                      // Enter in the answer field checks it, like the shortcut does elsewhere
                      // on the page. It never ends an IME composition early.
                      onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && canCheck) { e.preventDefault(); submit(); } }}
                    />
                  </label>
                ) : optionRows(q, state, graded, gradedAnswer, pick, capture, removeMark, SHOW_KEYBOARD_HINTS && !bp.phone)}
              </div>
            </QuestionContentGate>

            {!!graded && (
              <div className={`st-alert${graded === "ok" ? "" : " st-alert--bad"}`} role="status">
                <Icon d={graded === "ok" ? IC.circleCheck : IC.circleX} size={22} />
                <div>
                  <div className="st-alert-title">{graded === "ok" ? "Correct" : "Incorrect — added to your wrong book"}</div>
                  <div className="st-alert-body">
                    {correctAnswers.length > 0 && <>Correct answer: {correctAnswers.join(", ")}. </>}
                    The explanation is open {bp.narrow ? "below" : "on the right"}.
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="st-q-foot">
            <button type="button" className="st-btn" onClick={prevQ}><Icon d={IC.chevLeft} size={18} />Back</button>
            <span className="st-spacer" />
            {!graded ? (
              <button type="button" className="st-btn st-btn--primary" onClick={submit} disabled={!canCheck}>
                {q.type === "multiple_choice" ? `Check answer (${chosen.length}/${need})` : "Check answer"}<Icon d={IC.chevRight} size={18} />
              </button>
            ) : (
              <button type="button" className="st-btn st-btn--primary" onClick={next}>
                {last ? "Finish" : "Next question"}<Icon d={IC.chevRight} size={18} />
              </button>
            )}
          </div>
        </section>

        <div className="st-side" style={{ overflowY: scroller, overscrollBehavior: "auto" }}>
          {!graded && !bp.phone && (
            <div className="st-locked">
              <span className="st-locked-icon"><Icon d={IC.lock} size={20} /></span>
              <div>
                <div className="st-locked-title">Explanation and notes are locked</div>
                <div className="st-locked-body">They open as soon as you check your answer, so nothing gives the answer away.</div>
              </div>
              {SHOW_KEYBOARD_HINTS && (
                <div className="st-keys">
                  <div className="st-keys-title"><Icon d={IC.keyboard} size={14} />Keyboard shortcuts</div>
                  {practiceShortcutHints(q).map((k) => (
                    <div key={k.keys} className="st-key-row"><kbd className="st-kbd">{k.keys}</kbd>{k.action}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!!graded && (
            <ReviewTabs
              tabs={[
                { key: "exp", label: "Explanation", icon: IC.sparkles },
                { key: "notes", label: "Notes", icon: IC.msg, count: noteCount },
                { key: "related", label: "Related", icon: IC.lightbulb }
              ]}
              active={tab}
              onChange={setTab}
            >
              {tab === "exp" && <ExplanationPanel q={q} explanation={gradedAnswer?.explanation} collapsible={!gridHeight} />}
              {tab === "notes" && <NotesPanel qid={q.id} />}
              {tab === "related" && <RelatedKnowledgePoints key={q.id} questionId={q.id} embedded />}
            </ReviewTabs>
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
  removeMark: ReturnType<typeof usePrepDeck>["removeMark"],
  showKeys: boolean
) {
  const chosen = state.sel[q.id] || [];
  const correctAnswers = gradedAnswer?.correctAnswers ?? [];
  return (q.options ?? []).map((o, i) => {
    const on = chosen.includes(o.id);
    const right = correctAnswers.includes(o.id);
    let optState: OptionState = on ? "selected" : "idle";
    let status: string | undefined;
    if (graded) {
      if (right) { optState = "correct"; status = on ? "Your answer · Correct" : "Correct answer"; }
      else if (on) { optState = "wrong"; status = "Your answer"; }
      else optState = "dim";
    }
    return (
      <OptionRow
        key={o.id} id={o.id} state={optState} status={status}
        keyHint={!graded && showKeys && i < 9 ? String(i + 1) : undefined}
        onPick={!graded ? () => pick(q, o.id) : undefined}
        onMouseUp={graded ? () => capture(q.id, `opt:${o.id}`) : undefined}
      >
        <QuestionContent src={o.text} content={q.content} optionId={o.id} annotations={state.anns} qid={q.id} target={`opt:${o.id}`} show={!!graded} onRemoveMark={removeMark} />
      </OptionRow>
    );
  });
}
