import StructuredResponse from "../components/StructuredResponse";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { buildLearningPrompt, copyText } from "../lib/practicePrompt";
import { usePrepDeck } from "../store/PrepDeckContext";
import QuestionContent from "../components/QuestionContent";
import QuestionContentGate from "../components/QuestionContentGate";
import AnswerRevisionNotice from "../components/AnswerRevisionNotice";
import RelatedKnowledgePoints from "../components/knowledgePoints/RelatedKnowledgePoints";
import {
  BookmarkButton, CopyPromptButton, ExplanationPanel, HistoryPanel, IC, Icon, NotesPanel, OptionRow, QuestionBadges, ReviewTabs, usePinnedCard, visibleNotes
} from "../components/study/StudyKit";
import type { Breakpoints } from "../lib/responsive";
import { questionTypeLabel } from "../lib/questionTypes";
import type { Question } from "../types";

// docs/requirements/practice-and-learning-modes.md — Learning Mode. Unlike PracticeLive, there is no answer to
// pick or submit: the correct answer, this user's own answer history, any
// AI/official explanation, and notes/annotations are all available as soon as
// the question loads (FR-14.3–FR-14.6) — this screen is a read-through, not
// a quiz. No attempt is created (FR-14.7): toggleBookmark/capture/addNote
// below are the same actions PracticeLive uses, since Learning Mode is a
// "review context" per FR-8.3/FR-11.6.
export default function LearningLive({ bp }: { bp: Breakpoints }) {
  const {
    state, width, learningQ, learningNext, learningPrev, learningGotoSequence, go, toggleBookmark, capture, removeMark
  } = usePrepDeck();
  const q = learningQ();
  const detail = q ? state.lDetail[q.id] : undefined;
  const [jumpText, setJumpText] = useState("");
  const [tab, setTab] = useState("exp");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const copyRequest = useRef(0);
  useLayoutEffect(() => {
    setCopyStatus("idle");
    // Ignore clipboard completions after navigating away, including back to this question.
    return () => { copyRequest.current += 1; };
  }, [q?.id]);
  useEffect(() => setTab("exp"), [q?.id]);

  const desktop = width >= 1100;
  // Desktop sizes the whole two-column grid to the viewport so the review
  // panels scroll on their own; narrower screens size only the question card,
  // with the review panels following below it on the page.
  const { gridRef, bodyRef, fitHeight } = usePinnedCard(q?.id, bp.phone);
  const gridHeight = desktop ? fitHeight : null;

  if (!q) return null;

  const ready = detail?.status === "ready";
  const correctAnswers = detail?.correctAnswers ?? [];
  const liveCols = desktop ? "minmax(0, 1.65fr) minmax(300px, 1fr)" : "minmax(0, 1fr)";
  const atEnd = state.lIdx + 1 >= state.lQueue.length;
  const scroller = gridHeight ? "auto" : "visible";
  const history = detail?.history ?? [];
  const noteCount = visibleNotes(state, q.id).length;
  const progress = state.lQueue.length ? ((state.lIdx + 1) / state.lQueue.length) * 100 : 0;

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
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      <header className="st-head">
        <div className="st-head-row">
          <div className="st-head-titles">
            <div className="st-kicker"><Icon d={IC.bookOpen} />Learning · read-through</div>
            <h1 className="st-title">Question #{q.sequenceNumber} <span className="st-title-sub">· {state.lIdx + 1} of {state.lQueue.length}</span></h1>
          </div>
          <BookmarkButton on={!!state.bookmarks[q.id]} onClick={() => toggleBookmark(q.id)} />
          <button type="button" className="st-btn" onClick={() => go("learning")}><Icon d={IC.logout} />Exit</button>
        </div>
        <div className="st-bar" role="progressbar" aria-label="Learning progress" aria-valuemin={0} aria-valuemax={state.lQueue.length} aria-valuenow={state.lIdx + 1}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div
        ref={gridRef}
        className="st-grid"
        style={{ gridTemplateColumns: liveCols, alignItems: gridHeight ? "stretch" : "start", height: gridHeight ?? undefined }}
      >
        <section
          className="st-card st-q st-q--pinned" aria-label="Question"
          style={{ height: desktop ? undefined : fitHeight ?? undefined }}
        >
          <div className="st-q-head">
            <QuestionBadges label={q.externalId} typeLabel={questionTypeLabel(q)} multi={q.type === "multiple_choice"} tags={q.tags}>
              {ready && detail?.correctAnswers && <CopyPromptButton status={copyStatus} onClick={copyAsPrompt} />}
            </QuestionBadges>
          </div>
          <div className="st-q-body" ref={bodyRef}>
            <QuestionContentGate question={q} learning>
              <div className="st-stem" onMouseUp={() => capture(q.id, "stem")}>
                <QuestionContent src={q.stem} content={q.content} annotations={state.anns} qid={q.id} target="stem" show={true} onRemoveMark={removeMark} />
              </div>

              <div className="st-opts">
                <AnswerRevisionNotice revisedAt={detail?.answerRevisedAt} />
                {q.content && (q.type === "ordering" || q.type === "matching") ? (
                  <StructuredResponse content={q.content} selected={ready ? correctAnswers : []} onChange={() => {}} disabled correct={ready ? correctAnswers : undefined} />
                ) : q.options ? (
                  optionRows(q, state, correctAnswers, ready, capture, removeMark)
                ) : (
                  <div className="st-answer-box">
                    <span className="st-opt-status">Accepted answer(s)</span>
                    <span>{ready ? correctAnswers.join(" · ") || "—" : "Loading…"}</span>
                  </div>
                )}
              </div>
            </QuestionContentGate>
          </div>

          <div className="st-q-foot">
            <button type="button" className="st-btn" onClick={learningPrev} disabled={state.lIdx === 0}><Icon d={IC.chevLeft} size={18} />Back</button>
            <div className="st-segmented">
              <input
                type="number" min={1} className="st-jump" placeholder="Jump to #" aria-label="Jump to question number"
                value={jumpText} onChange={(e) => setJumpText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") jumpToInput(); }}
              />
              <button type="button" className="st-seg-btn" onClick={jumpToInput}>Go</button>
            </div>
            <span className="st-spacer" />
            <button type="button" className="st-btn st-btn--primary" onClick={learningNext} disabled={atEnd}>
              {atEnd ? "Last question" : "Next question"}<Icon d={IC.chevRight} size={18} />
            </button>
          </div>
        </section>

        <div className="st-side" style={{ overflowY: scroller, overscrollBehavior: "contain" }}>
          <ReviewTabs
            tabs={[
              { key: "exp", label: "Explanation", icon: IC.sparkles },
              { key: "history", label: "History", icon: IC.history, count: history.length },
              { key: "notes", label: "Notes", icon: IC.msg, count: noteCount },
              { key: "related", label: "Related", icon: IC.lightbulb }
            ]}
            active={tab}
            onChange={setTab}
          >
            {tab === "exp" && <ExplanationPanel q={q} explanation={detail?.explanation} collapsible={!gridHeight} />}
            {tab === "history" && <HistoryPanel rows={history} loading={!ready} answerRevisedAt={detail?.answerRevisedAt} answerRevision={detail?.answerRevision} />}
            {tab === "notes" && <NotesPanel qid={q.id} />}
            {tab === "related" && <RelatedKnowledgePoints key={q.id} questionId={q.id} embedded />}
          </ReviewTabs>
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
    const right = ready && correctAnswers.includes(o.id);
    return (
      <OptionRow
        key={o.id} id={o.id}
        state={!ready ? "idle" : right ? "correct" : "dim"}
        status={right ? "Correct answer" : undefined}
        onMouseUp={() => capture(q.id, `opt:${o.id}`)}
      >
        <QuestionContent src={o.text} content={q.content} optionId={o.id} annotations={state.anns} qid={q.id} target={`opt:${o.id}`} show={true} onRemoveMark={removeMark} />
      </OptionRow>
    );
  });
}
