import { useId, useMemo } from "react";
import { reviewIds } from "../lib/reviewLists";
import { needsFocusedPractice } from "../lib/practiceEligibility";
import { underReviewCount } from "../lib/underReview";
import { usePrepDeck } from "../store/PrepDeckContext";
import { IC, Icon } from "../components/study/StudyKit";
import {
  ChoiceCard, DifficultyPicker, DomainPicker, EmptyPoolNotice, MoreOptions, SetupHeader, SetupRow, SummaryRow, UnderReviewRow, domainSummary, setupLayout,
  type DifficultyChoice
} from "../components/study/SetupKit";
import type { Breakpoints } from "../lib/responsive";

const SOURCES = [
  { id: "all", icon: IC.library, label: "All questions", desc: "The full bank for this exam" },
  { id: "new", icon: IC.sparkles, label: "Unattempted", desc: "Questions you have never answered" },
  { id: "focus", icon: IC.target, label: "Unattempted + wrong", desc: "New questions plus misses you have not mastered" },
  { id: "wrong", icon: IC.rotate, label: "Wrong book", desc: "Misses you have not mastered yet" },
  { id: "bm", icon: IC.bookmark, label: "Bookmarked", desc: "Questions you saved for later" }
] as const;
type SourceId = typeof SOURCES[number]["id"];

// Why each source can be empty, in the learner's terms.
const EMPTY_SOURCE: Record<SourceId, { title: string; body: string }> = {
  all: { title: "This exam has no questions yet", body: "Questions appear here once they are added to the bank." },
  new: { title: "You have answered every question", body: "Nothing in this bank is unattempted any more." },
  focus: { title: "Nothing new or unmastered left", body: "You have answered every question, and your wrong book is clear." },
  wrong: { title: "Your wrong book is empty", body: "Questions you answer incorrectly in Practice or Mock are saved here until you master them." },
  bm: { title: "No bookmarked questions yet", body: "Bookmark a question while you study and it is saved here." }
};

const FEEDBACK = [
  { id: "immediate", icon: IC.zap, label: "Per question", desc: "See the answer and explanation after each check" },
  { id: "end", icon: IC.listChecks, label: "At the end", desc: "Answer everything first, then review" }
] as const;

const DIFF_LABEL: Record<DifficultyChoice, string> = { all: "Any difficulty", easy: "Easy only", medium: "Medium only", hard: "Hard only" };
const COUNT_PRESETS = [5, 10, 20, 40] as const;

// A rough planning figure for the summary, not a limit.
const MINUTES_PER_QUESTION = 1.5;

export default function PracticeSetup({ bp }: { bp: Breakpoints }) {
  const { state, width, setSource, setDiff, setFeedback, toggleTag, setPracticeTags, setCount, setSkipReview, startPractice, pool } = usePrepDeck();
  const layout = setupLayout(width, bp.phone);
  const emptyId = useId();
  const attemptedCount = Object.keys(state.attempted).length;
  const sourceCounts: Record<SourceId, number> = {
    all: state.catalog.length,
    new: state.catalog.length - attemptedCount,
    focus: state.catalog.filter(q => needsFocusedPractice(q.id, state)).length,
    wrong: reviewIds(state, "wrong").length,
    bm: reviewIds(state, "bm").length
  };
  const diffCounts = useMemo(() => {
    const counts: Record<DifficultyChoice, number> = { all: state.catalog.length, easy: 0, medium: 0, hard: 0 };
    for (const q of state.catalog) if (q.diff) counts[q.diff]++;
    return counts;
  }, [state.catalog]);
  const reviewCount = useMemo(() => underReviewCount(state.catalog), [state.catalog]);
  const matched = pool().length;
  const sessionSize = Math.min(state.count, matched);
  const source = SOURCES.find((s) => s.id === state.source) ?? SOURCES[0];
  const feedback = FEEDBACK.find((f) => f.id === state.feedback) ?? FEEDBACK[0];

  // Nothing to start: say why, and offer the nearest source or filter change
  // that has questions, instead of a start button that does nothing.
  let empty: { title: string; body: string; action?: { label: string; onClick: () => void } } | null = null;
  if (matched === 0) {
    if (sourceCounts[source.id] === 0) {
      const fallback = source.id !== "new" && sourceCounts.new > 0 ? SOURCES[1] : source.id !== "all" && sourceCounts.all > 0 ? SOURCES[0] : null;
      empty = {
        ...EMPTY_SOURCE[source.id],
        action: fallback ? { label: `Practice ${fallback.id === "new" ? "unattempted questions" : "all questions"} (${sourceCounts[fallback.id]})`, onClick: () => setSource(fallback.id) } : undefined
      };
    } else {
      const narrowed = state.tags.length > 0 || state.diff !== "all";
      empty = {
        title: "No questions match these filters",
        body: `${source.label} has ${sourceCounts[source.id]} ${sourceCounts[source.id] === 1 ? "question" : "questions"}, but none fit your domain, difficulty and review choices.`,
        action: narrowed ? { label: "Clear domain and difficulty filters", onClick: () => { setPracticeTags([]); setDiff("all"); } } : undefined
      };
    }
  }

  const optionsChanged = state.diff !== "all" || state.skipReview || state.feedback !== "immediate";
  const optionsSummary = [
    DIFF_LABEL[state.diff],
    reviewCount > 0 && (state.skipReview ? "under review skipped" : "under review included"),
    `feedback ${feedback.label.toLowerCase()}`
  ].filter(Boolean).join(" · ");

  return (
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      <SetupHeader screen="practice" title="Build a practice session">
        Untimed. Pick where questions come from and how many, then start. Everything else is optional.
      </SetupHeader>

      <div className="st-setup" style={{ gridTemplateColumns: layout.setupCols }}>
        <div className="st-rows">
          <SetupRow title="Question source" desc="Choose which questions to practice." cols={layout.rowCols}>
            <div className="st-cards" style={{ gridTemplateColumns: layout.cardCols }}>
              {SOURCES.map((s) => (
                <ChoiceCard key={s.id} icon={s.icon} label={s.label} count={sourceCounts[s.id]} desc={s.desc} on={state.source === s.id} onSelect={() => setSource(s.id)} />
              ))}
            </div>
          </SetupRow>

          <SetupRow title="Question count" desc={`Choose 5–40 questions, about ${MINUTES_PER_QUESTION} minutes each.`} cols={layout.rowCols}>
            <div className="st-count">
              <div className="st-segmented" role="group" aria-label="Question count presets">
                {COUNT_PRESETS.map((n) => (
                  <button key={n} type="button" className="st-seg-btn" aria-pressed={state.count === n} onClick={() => setCount(n)}>{n}</button>
                ))}
              </div>
              <div className="st-range">
                <input
                  type="range" min={5} max={40} step={5} value={state.count} aria-label="Question count"
                  onChange={(e) => setCount(parseInt(e.target.value, 10))}
                />
                <output aria-hidden="true">{state.count}</output>
              </div>
            </div>
          </SetupRow>

          <SetupRow title="Domains" desc="All included unless you select specific ones." cols={layout.rowCols}>
            <DomainPicker
              questions={state.catalog} selected={state.tags} phone={bp.phone}
              onToggle={toggleTag} onSelectResults={setPracticeTags} onClear={() => setPracticeTags([])}
            />
          </SetupRow>

          <MoreOptions summary={optionsSummary} defaultOpen={optionsChanged} cols={layout.rowCols}>
            <SetupRow title="Difficulty" desc="Filter by question difficulty." cols={layout.rowCols}>
              <DifficultyPicker value={state.diff} counts={diffCounts} onChange={setDiff} />
            </SetupRow>

            <UnderReviewRow count={reviewCount} skip={state.skipReview} onChange={setSkipReview} layout={layout} />

            <SetupRow title="Answer feedback" desc="Choose when to see answers and explanations." cols={layout.rowCols}>
              <div className="st-cards" style={{ gridTemplateColumns: layout.cardCols }}>
                {FEEDBACK.map((f) => (
                  <ChoiceCard key={f.id} icon={f.icon} label={f.label} desc={f.desc} on={state.feedback === f.id} onSelect={() => setFeedback(f.id)} />
                ))}
              </div>
            </SetupRow>
          </MoreOptions>
        </div>

        <aside style={{ position: layout.stickySummary ? "sticky" : "static", top: 0 }}>
          <div className="st-card st-summary">
            <div className="st-summary-head">
              <div className="st-summary-title">Session summary</div>
              <div className="st-summary-sub" role="status">{matched} {matched === 1 ? "question matches" : "questions match"} your filters</div>
            </div>
            <div className="st-summary-rows">
              <SummaryRow icon={source.icon} label="Source" value={source.label} />
              <SummaryRow icon={IC.tag} label="Domains" value={domainSummary(state.tags)} />
              {reviewCount > 0 && <SummaryRow icon={IC.alert} label="Under review" value={state.skipReview ? "Skipped" : "Included"} />}
              <SummaryRow icon={IC.listOrdered} label="Questions" value={sessionSize} />
              <SummaryRow icon={IC.clock} label="Estimated time" value={sessionSize ? `~${Math.max(1, Math.round(sessionSize * MINUTES_PER_QUESTION))} min` : "—"} />
            </div>
            {empty && <EmptyPoolNotice id={emptyId} {...empty} />}
            <div className="st-summary-foot">
              <button
                type="button" className="st-btn st-btn--primary" onClick={startPractice}
                disabled={matched === 0} aria-describedby={empty ? emptyId : undefined}
              >
                Start session<Icon d={IC.arrowRight} size={20} />
              </button>
            </div>
          </div>
          <p className="st-summary-note">
            <Icon d={IC.eyeOff} size={14} />
            <span>Annotations and notes stay hidden while you answer. They reappear as soon as a question is graded.</span>
          </p>
        </aside>
      </div>
    </div>
  );
}
