import { useMemo } from "react";
import { reviewIds } from "../lib/reviewLists";
import { needsFocusedPractice } from "../lib/practiceEligibility";
import { usePrepDeck } from "../store/PrepDeckContext";
import { IC, Icon } from "../components/study/StudyKit";
import {
  ChoiceCard, DifficultyPicker, DomainPicker, SetupHeader, SetupRow, SummaryRow, domainSummary, setupLayout,
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

const FEEDBACK = [
  { id: "immediate", icon: IC.zap, label: "Per question", desc: "See the answer and explanation after each check" },
  { id: "end", icon: IC.listChecks, label: "At the end", desc: "Answer everything first, then review" }
] as const;

// A rough planning figure for the summary, not a limit.
const MINUTES_PER_QUESTION = 1.5;

export default function PracticeSetup({ bp }: { bp: Breakpoints }) {
  const { state, width, setSource, setDiff, setFeedback, toggleTag, setPracticeTags, setCount, startPractice, pool } = usePrepDeck();
  const layout = setupLayout(width, bp.phone);
  const attemptedCount = Object.keys(state.attempted).length;
  const sourceCounts: Record<string, number> = {
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
  const matched = pool().length;
  const sessionSize = Math.min(state.count, matched);
  const source = SOURCES.find((s) => s.id === state.source) ?? SOURCES[0];

  return (
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      <SetupHeader icon={IC.squarePen} kicker="Free practice" title="Build a practice session">
        Untimed, with instant feedback. Pick where questions come from, narrow by domain, then start.
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

          <SetupRow title="Domains" desc="All included unless you select specific ones." cols={layout.rowCols}>
            <DomainPicker
              questions={state.catalog} selected={state.tags} phone={bp.phone}
              onToggle={toggleTag} onSelectResults={setPracticeTags} onClear={() => setPracticeTags([])}
            />
          </SetupRow>

          <SetupRow title="Difficulty" desc="Filter by question difficulty." cols={layout.rowCols}>
            <DifficultyPicker value={state.diff} counts={diffCounts} onChange={setDiff} />
          </SetupRow>

          <SetupRow title="Answer feedback" desc="Choose when to see answers and explanations." cols={layout.rowCols}>
            <div className="st-cards" style={{ gridTemplateColumns: layout.cardCols }}>
              {FEEDBACK.map((f) => (
                <ChoiceCard key={f.id} icon={f.icon} label={f.label} desc={f.desc} on={state.feedback === f.id} onSelect={() => setFeedback(f.id)} />
              ))}
            </div>
          </SetupRow>

          <SetupRow title="Question count" desc="Choose 5–40 questions." cols={layout.rowCols}>
            <div className="st-range">
              <input
                type="range" min={5} max={40} step={5} value={state.count} aria-label="Question count"
                onChange={(e) => setCount(parseInt(e.target.value, 10))}
              />
              <output aria-hidden="true">{state.count}</output>
            </div>
          </SetupRow>
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
              <SummaryRow icon={IC.listOrdered} label="Questions" value={sessionSize} />
              <SummaryRow icon={IC.clock} label="Estimated time" value={`~${Math.round(sessionSize * MINUTES_PER_QUESTION)} min`} />
            </div>
            <div className="st-summary-foot">
              <button type="button" className="st-btn st-btn--primary" onClick={startPractice}>
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
