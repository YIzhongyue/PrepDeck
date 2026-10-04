import { useId, useMemo, useState } from "react";
import { usePrepDeck } from "../store/PrepDeckContext";
import { underReviewCount } from "../lib/underReview";
import { IC, Icon } from "../components/study/StudyKit";
import {
  DifficultyPicker, DomainPicker, SetupHeader, SetupRow, SummaryRow, UnderReviewRow, domainSummary, setupLayout,
  type DifficultyChoice
} from "../components/study/SetupKit";
import type { Breakpoints } from "../lib/responsive";

const DIFF_LABEL: Record<DifficultyChoice, string> = { all: "Any", easy: "Easy", medium: "Medium", hard: "Hard" };

// FR-14.1/FR-14.2/FR-14.9 — choose a starting question sequence number
// (optionally resuming last position), and optional tag/difficulty filters,
// then walk the exam's questions in order with the answer already revealed.
export default function LearningSetup({ bp }: { bp: Breakpoints }) {
  const { state, width, learningPool, setLearningStartInput, toggleLearningTag, clearLearningTags, setLearningDiff, setLearningSkipReview, beginLearning } = usePrepDeck();
  const layout = setupLayout(width, bp.phone);
  const [startText, setStartText] = useState(String(state.lStartInput));
  const pool = learningPool();
  const maxSeq = pool.length ? pool[pool.length - 1]!.sequenceNumber : 0;
  const numberingGaps = maxSeq > pool.length;
  const startHintId = useId();
  const diffCounts = useMemo(() => {
    const counts: Record<DifficultyChoice, number> = { all: state.catalog.length, easy: 0, medium: 0, hard: 0 };
    for (const q of state.catalog) if (q.diff) counts[q.diff]++;
    return counts;
  }, [state.catalog]);
  const reviewCount = useMemo(() => underReviewCount(state.catalog), [state.catalog]);
  // Mirrors beginLearning: the first match at or after the chosen number, or
  // the last match when the number is past the end.
  const first = pool.find((q) => q.sequenceNumber >= state.lStartInput) ?? pool[pool.length - 1];

  const commitStart = (raw: string) => {
    const n = Math.max(1, parseInt(raw, 10) || 1);
    setStartText(String(n));
    setLearningStartInput(n);
  };

  return (
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      <SetupHeader screen="learning" title="Work through the bank in order">
        Answers revealed, nothing graded. Pick where to start, narrow by domain, then read on.
      </SetupHeader>

      {state.lResume != null && (
        <div className="st-banner st-banner--brand" role="status">
          <span className="st-banner-icon"><Icon d={IC.history} size={18} /></span>
          <div className="st-banner-text">
            <div className="st-banner-title">Pick up where you left off</div>
            <div>You left off at question #{state.lResume}.</div>
          </div>
          <button type="button" className="st-btn st-btn--primary" onClick={() => beginLearning(state.lResume!)}>Resume</button>
        </div>
      )}

      <div className="st-setup" style={{ gridTemplateColumns: layout.setupCols }}>
        <div className="st-rows">
          <SetupRow title="Starting point" desc="Questions run in sequence order from here." cols={layout.rowCols}>
            <label className="st-field st-start">
              Start from question #{maxSeq ? ` (1–${maxSeq})` : ""}
              <input
                type="number" min={1} max={maxSeq || undefined} className="st-input" value={startText}
                aria-describedby={numberingGaps ? startHintId : undefined}
                onChange={(e) => setStartText(e.target.value)}
                onBlur={(e) => commitStart(e.target.value)}
              />
            </label>
            {/* Question numbers are stable IDs, not positions: the range and
                the match count differ whenever numbers are missing or filtered. */}
            {numberingGaps && (
              <p id={startHintId} className="st-start-hint">
                Numbers are fixed question IDs, not positions: {pool.length} of the numbers from 1 to {maxSeq} match your filters. A number that is skipped starts at the next one.
              </p>
            )}
          </SetupRow>

          <SetupRow title="Domains" desc="All included unless you select specific ones." cols={layout.rowCols}>
            <DomainPicker
              questions={state.catalog} selected={state.lTags} phone={bp.phone}
              onToggle={toggleLearningTag} onClear={clearLearningTags}
            />
          </SetupRow>

          <SetupRow title="Difficulty" desc="Filter by question difficulty." cols={layout.rowCols}>
            <DifficultyPicker value={state.lDiff} counts={diffCounts} onChange={setLearningDiff} />
          </SetupRow>

          <UnderReviewRow count={reviewCount} skip={state.lSkipReview} onChange={setLearningSkipReview} layout={layout} />
        </div>

        <aside style={{ position: layout.stickySummary ? "sticky" : "static", top: 0 }}>
          <div className="st-card st-summary">
            <div className="st-summary-head">
              <div className="st-summary-title">Session summary</div>
              <div className="st-summary-sub" role="status">{pool.length} {pool.length === 1 ? "question matches" : "questions match"} your filters</div>
            </div>
            <div className="st-summary-rows">
              <SummaryRow icon={IC.tag} label="Domains" value={domainSummary(state.lTags)} />
              <SummaryRow icon={IC.sliders} label="Difficulty" value={DIFF_LABEL[state.lDiff]} />
              {reviewCount > 0 && <SummaryRow icon={IC.alert} label="Under review" value={state.lSkipReview ? "Skipped" : "Included"} />}
              <SummaryRow icon={IC.play} label="Starts at" value={first ? `#${first.sequenceNumber}` : "—"} />
              <SummaryRow icon={IC.listOrdered} label="Questions" value={pool.length} />
            </div>
            <div className="st-summary-foot">
              <button type="button" className="st-btn st-btn--primary" disabled={!pool.length} onClick={() => beginLearning()}>
                Start learning<Icon d={IC.arrowRight} size={20} />
              </button>
            </div>
          </div>
          <p className="st-summary-note">
            <Icon d={IC.info} size={14} />
            <span>Every question shows its correct answer, your own answer history, explanations and notes right away. Nothing is graded, and nothing is added to the wrong question book.</span>
          </p>
        </aside>
      </div>
    </div>
  );
}
