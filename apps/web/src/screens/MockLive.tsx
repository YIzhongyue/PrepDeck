import StructuredResponse from "../components/StructuredResponse";
import QuestionContent from "../components/QuestionContent";
import QuestionContentGate from "../components/QuestionContentGate";
import PageBreadcrumb from "../components/PageBreadcrumb";
import { IC, Icon, OptionGroup, OptionRow, QuestionBadges, UnderReviewNotice, usePinnedCard } from "../components/study/StudyKit";
import { isMockAnswered, mockAnsweredCount } from "../lib/mockAnswers";
import { questionTypeLabel } from "../lib/questionTypes";
import { useCatalogState, useMockClock, useMockExamActions, useMockExamState } from "../store/PrepDeckContext";
import { usePrefetchIntent, useQuestionPrefetch } from "../hooks/useQuestionPrefetch";
import type { Breakpoints } from "../lib/responsive";
import { useI18n } from "../i18n";

// Under five minutes the timer turns red and pulses.
const LOW_TIME_SECONDS = 5 * 60;

// The countdown reads the clock itself: it changes every second, and only
// these two render for it, not the question card.
function MockTimer() {
  const left = useMockClock();
  const { t } = useI18n();
  const mm = Math.floor(left / 60);
  const ss = left % 60;
  return (
    <span className="st-timer" data-low={left < LOW_TIME_SECONDS} role="timer" aria-label={t("mock.live.timeLeft", { minutes: mm, seconds: ss })}>
      <Icon d={IC.timer} size={20} />{mm}:{ss < 10 ? "0" : ""}{ss}
    </span>
  );
}

function MockTimeNote() {
  const lowTime = useMockClock() < LOW_TIME_SECONDS;
  const { t } = useI18n();
  return <span data-low={lowTime}>{t(lowTime ? "mock.live.lowTime" : "mock.live.serverClock")}</span>;
}

export default function MockLive({ bp }: { bp: Breakpoints }) {
  const { catalogBy } = useCatalogState();
  const state = { ...useMockExamState(), catalogBy };
  const { mockPick, mockPrev, mockNext, mockGoto, toggleFlag, askSubmit } = useMockExamActions();
  const { t } = useI18n();
  const mq = state.mockQ();
  // Only the card is sized to the viewport; the palette stays sticky beside it.
  const { gridRef, bodyRef, fitHeight } = usePinnedCard(mq?.id, bp.phone);
  useQuestionPrefetch("mock", state.mQueue, state.mIdx);
  const prefetchIntent = usePrefetchIntent("mock");
  if (!mq) return null;

  const total = state.mQueue.length;
  const flagged = !!state.mFlag[mq.id];
  const answered = mockAnsweredCount(state);
  const flaggedCount = state.mQueue.filter((id) => state.mFlag[id]).length;
  const rail = !bp.narrow;
  const mockCols = rail ? "minmax(0, 1fr) minmax(260px, 300px)" : "minmax(0, 1fr)";
  const mSel = state.mSel[mq.id] || [];
  const last = state.mIdx + 1 >= total;
  const structured = mq.type === "ordering" || mq.type === "matching";

  return (
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      {/* Phones leave this to the top bar, as Learning and Practice do. */}
      {!bp.phone && <PageBreadcrumb screen="mock" />}
      <div className="st-card st-mockbar">
        <MockTimer />
        <div className="st-mock-progress">
          <div className="st-mock-progress-row">
            <span>{t("mock.live.answeredOf", { answered, total })}</span>
            <MockTimeNote />

          </div>
          <div className="st-bar st-bar--lg" aria-hidden="true"><span style={{ width: `${total ? (answered / total) * 100 : 0}%` }} /></div>
        </div>
        <div className="st-mockbar-actions">
          <button type="button" className={`st-btn${flagged ? " st-btn--flagged" : ""}`} onClick={toggleFlag} aria-pressed={flagged}>
            <Icon d={IC.flag} size={18} fill={flagged ? "currentColor" : "none"} />{t(flagged ? "mock.live.flagged" : "mock.live.flag")}
          </button>
          <button type="button" className="st-btn st-btn--primary" onClick={askSubmit}><Icon d={IC.send} />{t("mock.live.submitExam")}</button>
        </div>
      </div>

      <div ref={gridRef} className="st-grid" style={{ gridTemplateColumns: mockCols, alignItems: "start" }}>
        <section className="st-card st-q st-q--pinned" aria-label={t("study.question")} style={{ height: fitHeight ?? undefined }}>
          <div className="st-q-head">
            <QuestionBadges label={t("study.questionN", { n: state.mIdx + 1 })} typeLabel={questionTypeLabel(mq)} multi={mq.type === "multiple_choice"} underReview={mq.needsReview} />
          </div>
          <div className="st-q-body" ref={bodyRef}>
            <UnderReviewNotice question={mq} />
            <QuestionContentGate question={mq}>
              <div className="st-stem"><QuestionContent src={mq.stem} content={mq.content} /></div>
              <div className="st-opts">
                {mq.type === "fill_blank" && (
                  <label className="st-field">{t("study.yourAnswer")}<input className="st-input" value={mSel[0] ?? ""} onChange={e => mockPick(mq, e.target.value)} /></label>
                )}
                {mq.content && structured && <StructuredResponse content={mq.content} selected={mSel} onChange={answer => mockPick(mq, answer)} />}
                {!structured && !!mq.options?.length && (
                  <OptionGroup kind={mq.type === "multiple_choice" ? "multiple" : "single"} tabStop={mSel[0] ?? mq.options[0]?.id}>
                    {mq.options.map((o) => (
                      <OptionRow key={o.id} id={o.id} state={mSel.includes(o.id) ? "selected" : "idle"} onPick={() => mockPick(mq, o.id)}>
                        <QuestionContent src={o.text} content={mq.content} optionId={o.id} />
                      </OptionRow>
                    ))}
                  </OptionGroup>
                )}
              </div>
            </QuestionContentGate>
          </div>
          <div className="st-q-foot">
            <button type="button" className="st-btn" onClick={mockPrev} disabled={state.mIdx === 0}><Icon d={IC.chevLeft} size={18} />{t("common.back")}</button>
            <span className="st-spacer" />
            <button type="button" className="st-btn st-btn--primary" onClick={last ? askSubmit : mockNext}>
              {last ? t("mock.live.reviewSubmit") : t("common.next")}<Icon d={IC.chevRight} size={18} />
            </button>
          </div>
        </section>

        <aside className="st-card" aria-label={t("mock.live.palette")} style={{ position: rail ? "sticky" : "static", top: 18 }}>
          <div className="st-card-title">{t("setup.summary.questions")}</div>
          <div className="st-trio">
            <div><div className="st-trio-k">{t("mock.live.answered")}</div><div className="st-trio-v">{answered}</div></div>
            <div><div className="st-trio-k">{t("mock.live.flagged")}</div><div className="st-trio-v st-trio-v--warn">{flaggedCount}</div></div>
            <div><div className="st-trio-k">{t("mock.live.left")}</div><div className="st-trio-v">{total - answered}</div></div>
          </div>
          <div className="st-palette">
            {state.mQueue.map((id, i) => {
              const isAnswered = isMockAnswered(state, id);
              const isFlagged = !!state.mFlag[id];
              return (
                <button
                  key={id} type="button" className="st-pal" onClick={() => mockGoto(i)} {...prefetchIntent(id)}
                  data-state={isAnswered ? "answered" : isFlagged ? "flagged" : "open"}
                  aria-current={i === state.mIdx ? "true" : undefined}
                  aria-label={[t("study.questionN", { n: i + 1 }), isAnswered && t("mock.live.answeredState"), isFlagged && t("mock.live.flaggedState")].filter(Boolean).join(t("mock.live.stateSeparator"))}
                >
                  {i + 1}
                  {isAnswered && isFlagged && <span className="st-pal-dot" />}
                </button>
              );
            })}
          </div>
          <div className="st-legend">
            <span><span className="st-swatch st-swatch--answered" />{t("mock.live.answered")}</span>
            <span><span className="st-swatch st-swatch--flagged" />{t("mock.live.flagged")}</span>
            <span><span className="st-swatch" />{t("mock.live.notAnswered")}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
