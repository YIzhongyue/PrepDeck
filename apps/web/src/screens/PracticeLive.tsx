import StructuredResponse from "../components/StructuredResponse";
import { useEffect, useState } from "react";
import { formatAnswerText } from "@prepdeck/shared";
import {
  useAiActions, useAiState, useNotesActions, useNotesState, usePracticeActions, usePracticeState, useReviewListsActions,
  useReviewListsState, useWorkspaceState, type NotesActions, type NotesState, type PracticeActions, type PracticeState,
} from "../store/PrepDeckContext";
import { useQuestionPrefetch } from "../hooks/useQuestionPrefetch";
import { SHOW_KEYBOARD_HINTS } from "../data/constants";
import { buildPracticePrompt, copyText } from "../lib/practicePrompt";
import { canCheckAnswer, practiceShortcutHints, requiredSelections } from "../lib/practiceShortcuts";
import { questionTypeLabel } from "../lib/questionTypes";
import QuestionContent from "../components/QuestionContent";
import QuestionContentGate from "../components/QuestionContentGate";
import AnswerRevisionNotice from "../components/AnswerRevisionNotice";
import RelatedKnowledgePoints from "../components/knowledgePoints/RelatedKnowledgePoints";
import PageBreadcrumb from "../components/PageBreadcrumb";
import {
  BookmarkButton, CopyPromptButton, ExplanationPanel, IC, Icon, NotesPanel, OptionGroup, OptionRow, QuestionBadges, ReviewTabs, UnderReviewNotice, pinnedCardStyle, usePinnedCard, visibleNotes,
  type OptionState
} from "../components/study/StudyKit";
import type { Breakpoints } from "../lib/responsive";
import type { GradedAnswer, Question } from "../types";
import { t as translate, useI18n } from "../i18n";

// Longer sessions fall back to a plain bar: segments under ~6px stop reading as questions.
const MAX_SEGMENTS = 60;

export default function PracticeLive({ bp }: { bp: Breakpoints }) {
  const practice = usePracticeState();
  const { ai } = useAiState();
  const { workspaceNotice, actionError } = useWorkspaceState();
  const { bookmarks } = useReviewListsState();
  const state = { ...practice, ...useNotesState(), ai, workspaceNotice, actionError, bookmarks };
  const { pick, submit, next, prevQ, endSession } = usePracticeActions();
  const { toggleBookmark } = useReviewListsActions();
  const { capture, removeMark } = useNotesActions();
  const { checkAiCache } = useAiActions();
  const { t } = useI18n();
  const q = practice.curQ();
  useQuestionPrefetch("practice", state.queue, state.idx);

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
  // stem and answers scroll. Phones size nothing: the page scrolls as one,
  // between a sticky header and action bar.
  const flow = bp.phone || bp.landscapePhone;
  const { gridRef, bodyRef, fitHeight } = usePinnedCard(q?.id, flow, [graded, state.workspaceNotice, state.actionError]);
  const gridHeight = bp.narrow || flow ? null : fitHeight;
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => setCopyStatus("idle"), [q?.id]);

  if (!q) return null;

  const gradedAnswer = state.graded[q.id];
  const contentPending = !!q.hasContent && !q.content;
  const chosen = state.sel[q.id] || [];
  const need = requiredSelections(q);
  const canCheck = canCheckAnswer(q, chosen);
  const liveCols = !bp.narrow && !flow ? "minmax(0, 1.65fr) minmax(300px, 1fr)" : "minmax(0, 1fr)";
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

  // Phones show only the score, under the title, where the breadcrumb was.
  const stats = (
    <div className="st-stats">
      <span><span className="st-ic-ok"><Icon d={IC.circleCheck} /></span>{t("practice.live.correctCount", { count: okCount })}</span>
      <span><span className="st-ic-bad"><Icon d={IC.circleX} /></span>{t("practice.live.incorrectCount", { count: noCount })}</span>
      {!flow && <span><span className="st-ic-muted"><Icon d={IC.timerOff} /></span>{t("practice.live.noTimer")}</span>}
    </div>
  );

  // Phones keep the actions in one row, so Back is an icon.
  const foot = (
    <div className="st-q-foot">
      <button type="button" className={`st-btn${flow ? " st-btn--icon" : ""}`} onClick={prevQ} aria-label={flow ? t("common.back") : undefined}>
        <Icon d={IC.chevLeft} size={18} />{!flow && t("common.back")}
      </button>
      <span className="st-spacer" />
      {!graded ? (
        <button type="button" className="st-btn st-btn--primary" onClick={submit} disabled={!canCheck}>
          {q.type === "multiple_choice" ? t("practice.live.checkCount", { chosen: chosen.length, need }) : t("practice.live.check")}<Icon d={IC.chevRight} size={18} />
        </button>
      ) : (
        <button type="button" className="st-btn st-btn--primary" onClick={next}>
          {last ? t("practice.live.finish") : t("practice.live.next")}<Icon d={IC.chevRight} size={18} />
        </button>
      )}
    </div>
  );

  return (
    <div className={`pd-study${bp.phone ? " st-phone" : ""}${flow ? " st-flow" : ""}${bp.landscapePhone ? " st-landscape" : ""}`}>
      <header className="st-head">
        <div className="st-head-row">
          <div className="st-head-titles">
            <PageBreadcrumb screen="practice" />
            <h1 className="st-title">{t("study.questionN", { n: state.idx + 1 })} <span className="st-title-sub">{t("study.ofTotal", { total: state.queue.length })}</span></h1>
            {flow && stats}
          </div>
          <BookmarkButton on={bookmarked} onClick={() => toggleBookmark()} />
          <button type="button" className="st-btn" onClick={endSession}><Icon d={IC.x} />{flow ? t("practice.live.end") : t("practice.live.endSession")}</button>
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
        {!flow && stats}
      </header>

      <div
        ref={gridRef}
        className="st-grid"
        style={{ gridTemplateColumns: liveCols, alignItems: gridHeight ? "stretch" : "start", height: gridHeight ?? undefined }}
      >
        <section
          className={`st-card st-q${flow ? "" : " st-q--pinned"}`} aria-label={t("study.question")}
          style={pinnedCardStyle(gridHeight, bp.narrow && !flow ? fitHeight : null)}
        >
          <div className="st-q-head">
            <QuestionBadges label={q.externalId} typeLabel={questionTypeLabel(q)} multi={q.type === "multiple_choice"} tags={q.tags} compact={flow} underReview={q.needsReview}>
              {!!graded && !contentPending && <CopyPromptButton status={copyStatus} onClick={copyAsPrompt} compact={flow} />}
            </QuestionBadges>
          </div>
          {/* Practice lets the wheel hand off to the page at the top and bottom of the question. */}
          <div className="st-q-body" ref={bodyRef} style={{ overscrollBehavior: "auto" }}>
            <UnderReviewNotice question={q} />
            <QuestionContentGate question={q}>
              <div className="st-stem" onMouseUp={() => { if (graded) capture(q.id, "stem"); }}>
                <QuestionContent src={q.stem} content={q.content} annotations={state.anns} qid={q.id} target="stem" show={!!graded} onRemoveMark={removeMark} />
              </div>

              <div className="st-opts">
                <AnswerRevisionNotice revisedAt={gradedAnswer?.answerRevisedAt} />
                {q.content && (q.type === "ordering" || q.type === "matching") ? (
                  <StructuredResponse content={q.content} selected={chosen} onChange={answer => pick(q, answer)} disabled={!!graded} correct={graded ? correctAnswers : undefined} />
                ) : q.type === "fill_blank" ? (
                  <label className="st-field">{t("study.yourAnswer")}
                    <input
                      className="st-input" value={chosen[0] ?? ""} disabled={!!graded} onChange={e => pick(q, e.target.value)}
                      // Enter in the answer field checks it, like the shortcut does elsewhere
                      // on the page. It never ends an IME composition early.
                      onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && canCheck) { e.preventDefault(); submit(); } }}
                    />
                  </label>
                ) : (
                  <OptionGroup kind={graded ? "review" : q.type === "multiple_choice" ? "multiple" : "single"} tabStop={chosen[0] ?? q.options?.[0]?.id}>
                    {optionRows(q, state, graded, gradedAnswer, pick, capture, removeMark, SHOW_KEYBOARD_HINTS && !flow)}
                  </OptionGroup>
                )}
              </div>
            </QuestionContentGate>

            {!!graded && (
              <div className={`st-alert${graded === "ok" ? "" : " st-alert--bad"}`} role="status">
                <Icon d={graded === "ok" ? IC.circleCheck : IC.circleX} size={22} />
                <div>
                  <div className="st-alert-title">{t(graded === "ok" ? "study.correct" : "practice.live.incorrectAdded")}</div>
                  <div className="st-alert-body">
                    {correctAnswers.length > 0 && <>{t("practice.live.correctAnswer", { answer: formatAnswerText(q, correctAnswers) })} </>}
                    {t(bp.narrow || flow ? "practice.live.explanationBelow" : "practice.live.explanationRight")}
                  </div>
                </div>
              </div>
            )}
          </div>

          {!flow && foot}
        </section>

        <div className="st-side" style={{ overflowY: scroller, overscrollBehavior: "auto" }}>
          {!graded && !flow && (
            <div className="st-locked">
              <span className="st-locked-icon"><Icon d={IC.lock} size={20} /></span>
              <div>
                <div className="st-locked-title">{t("practice.live.lockedTitle")}</div>
                <div className="st-locked-body">{t("practice.live.lockedBody")}</div>
              </div>
              {SHOW_KEYBOARD_HINTS && (
                <div className="st-keys">
                  <div className="st-keys-title"><Icon d={IC.keyboard} size={14} />{t("practice.shortcuts.title")}</div>
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
                { key: "exp", label: t("study.tabs.explanation"), icon: IC.sparkles },
                { key: "notes", label: t("study.tabs.notes"), icon: IC.msg, count: noteCount },
                { key: "related", label: t("study.tabs.related"), icon: IC.lightbulb }
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

      {/* After the review panels, so it sticks while any of the page is on screen. */}
      {flow && foot}
    </div>
  );
}

function optionRows(
  q: Question,
  state: Pick<PracticeState, "sel"> & Pick<NotesState, "anns">,
  graded: "ok" | "no" | undefined,
  gradedAnswer: GradedAnswer | undefined,
  pick: PracticeActions["pick"],
  capture: NotesActions["capture"],
  removeMark: NotesActions["removeMark"],

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
      if (right) { optState = "correct"; status = translate(on ? "study.optionStatus.yoursCorrect" : "study.optionStatus.correct"); }
      else if (on) { optState = "wrong"; status = translate("study.optionStatus.yoursIncorrect"); }
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
