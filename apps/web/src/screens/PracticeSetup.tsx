import { useId, useMemo } from "react";
import { reviewIds } from "../lib/reviewLists";
import { needsFocusedPractice } from "../lib/practiceEligibility";
import { underReviewCount } from "../lib/underReview";
import { STUDY_FILTERS, studyFilterCounts } from "../lib/studyStatus";
import {
  useCatalogState, usePracticeActions, usePracticeState, useReviewListsState, useStudyProgressState, useViewport,
} from "../store/PrepDeckContext";
import { IC, Icon } from "../components/study/StudyKit";
import {
  ChoiceCard, DifficultyPicker, DomainPicker, EmptyPoolNotice, MoreOptions, SetupHeader, SetupRow, StudyStatusRow, SummaryRow, UnderReviewRow, domainSummary, setupLayout,
  type DifficultyChoice
} from "../components/study/SetupKit";
import type { Breakpoints } from "../lib/responsive";
import { useI18n } from "../i18n";

// Labels and descriptions are the `practice.sources` and `practice.feedback`
// messages; why each source can be empty is `practice.emptySource`.
const SOURCES = [
  { id: "all", icon: IC.library },
  { id: "new", icon: IC.sparkles },
  { id: "focus", icon: IC.target },
  { id: "wrong", icon: IC.rotate },
  { id: "bm", icon: IC.bookmark }
] as const;
type SourceId = typeof SOURCES[number]["id"];

const FEEDBACK = [
  { id: "immediate", icon: IC.zap },
  { id: "end", icon: IC.listChecks }
] as const;

const DIFF_LABEL: Record<DifficultyChoice, "practice.difficulty.any" | "practice.difficulty.easy" | "practice.difficulty.medium" | "practice.difficulty.hard"> = {
  all: "practice.difficulty.any", easy: "practice.difficulty.easy", medium: "practice.difficulty.medium", hard: "practice.difficulty.hard"
};
const COUNT_PRESETS = [5, 10, 20, 40] as const;

// A rough planning figure for the summary, not a limit.
const MINUTES_PER_QUESTION = 1.5;

export default function PracticeSetup({ bp }: { bp: Breakpoints }) {
  // pool() filters the catalog on all of these, so they are all read here.
  const state = { ...usePracticeState(), ...useCatalogState(), ...useReviewListsState(), ...useStudyProgressState() };
  const { width } = useViewport();
  const { setSource, setDiff, setFeedback, toggleTag, setPracticeTags, setCount, setSkipReview, setStudyFilter, startPractice, pool } = usePracticeActions();
  const { t } = useI18n();
  const sourceLabel = (id: SourceId) => t(`practice.sources.${id}.label`);

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
  const studyCounts = useMemo(() => studyFilterCounts(state.catalog, state.studyStatus), [state.catalog, state.studyStatus]);
  const matched = pool().length;
  const sessionSize = Math.min(state.count, matched);
  const source = SOURCES.find((s) => s.id === state.source) ?? SOURCES[0];
  const feedback = FEEDBACK.find((f) => f.id === state.feedback) ?? FEEDBACK[0];
  const study = STUDY_FILTERS.find((f) => f.id === state.studyFilter) ?? STUDY_FILTERS[0]!;

  // Nothing to start: say why, and offer the nearest source or filter change
  // that has questions, instead of a start button that does nothing.
  let empty: { title: string; body: string; action?: { label: string; onClick: () => void } } | null = null;
  if (matched === 0) {
    if (sourceCounts[source.id] === 0) {
      const fallback = source.id !== "new" && sourceCounts.new > 0 ? SOURCES[1] : source.id !== "all" && sourceCounts.all > 0 ? SOURCES[0] : null;
      empty = {
        title: t(`practice.emptySource.${source.id}.title`),
        body: t(`practice.emptySource.${source.id}.body`),
        action: fallback ? { label: t(fallback.id === "new" ? "practice.empty.practiceUnattempted" : "practice.empty.practiceAll", { count: sourceCounts[fallback.id] }), onClick: () => setSource(fallback.id) } : undefined
      };
    } else if (state.studyFilter !== "all" && pool({ study: "all" }).length > 0) {
      // Only the study status rules every question out (issue #119).
      const others = pool({ study: "all" }).length;
      empty = {
        title: t(state.studyFilter === "unstudied" ? "practice.empty.allStudiedTitle" : "practice.empty.noneStudiedTitle"),
        body: t(state.studyFilter === "unstudied" ? "practice.empty.allStudiedBody" : "practice.empty.noneStudiedBody"),
        action: { label: t("practice.empty.practiceMatching", { count: others }), onClick: () => setStudyFilter("all") }
      };
    } else {
      const narrowed = state.tags.length > 0 || state.diff !== "all" || state.studyFilter !== "all";
      empty = {
        title: t("practice.empty.noMatchTitle"),
        body: t("practice.empty.noMatchBody", { source: sourceLabel(source.id), count: sourceCounts[source.id] }),
        action: narrowed ? { label: t("practice.empty.clearFilters"), onClick: () => { setPracticeTags([]); setDiff("all"); setStudyFilter("all"); } } : undefined
      };
    }
  }

  const optionsChanged = state.diff !== "all" || state.skipReview || state.feedback !== "immediate";
  const optionsSummary = [
    t(DIFF_LABEL[state.diff]),
    reviewCount > 0 && t(state.skipReview ? "practice.summary.reviewSkipped" : "practice.summary.reviewIncluded"),
    t(`practice.summary.feedback.${feedback.id}`)
  ].filter(Boolean).join(" · ");

  return (
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      <SetupHeader screen="practice" title={t("practice.setup.title")}>
        {t("practice.setup.intro")}
      </SetupHeader>

      <div className="st-setup" style={{ gridTemplateColumns: layout.setupCols }}>
        <div className="st-rows">
          <SetupRow title={t("practice.setup.source")} desc={t("practice.setup.sourceDesc")} cols={layout.rowCols}>
            <div className="st-cards" style={{ gridTemplateColumns: layout.cardCols }}>
              {SOURCES.map((s) => (
                <ChoiceCard key={s.id} icon={s.icon} label={sourceLabel(s.id)} count={sourceCounts[s.id]} desc={t(`practice.sources.${s.id}.desc`)} on={state.source === s.id} onSelect={() => setSource(s.id)} />
              ))}
            </div>
          </SetupRow>

          <SetupRow title={t("practice.setup.count")} desc={t("practice.setup.countDesc", { minutes: MINUTES_PER_QUESTION })} cols={layout.rowCols}>
            <div className="st-count">
              <div className="st-segmented" role="group" aria-label={t("practice.setup.countPresets")}>
                {COUNT_PRESETS.map((n) => (
                  <button key={n} type="button" className="st-seg-btn" aria-pressed={state.count === n} onClick={() => setCount(n)}>{n}</button>
                ))}
              </div>
              <div className="st-range">
                <input
                  type="range" min={5} max={40} step={5} value={state.count} aria-label={t("practice.setup.count")}
                  onChange={(e) => setCount(parseInt(e.target.value, 10))}
                />
                <output aria-hidden="true">{state.count}</output>
              </div>
            </div>
          </SetupRow>

          <SetupRow title={t("setup.domains.title")} desc={t("setup.domains.desc")} cols={layout.rowCols}>
            <DomainPicker
              questions={state.catalog} selected={state.tags} phone={bp.phone}
              onToggle={toggleTag} onSelectResults={setPracticeTags} onClear={() => setPracticeTags([])}
            />
          </SetupRow>

          <StudyStatusRow value={state.studyFilter} counts={studyCounts} unavailable={state.studyStatusError} onChange={setStudyFilter} layout={layout} />

          <MoreOptions summary={optionsSummary} defaultOpen={optionsChanged} cols={layout.rowCols}>
            <SetupRow title={t("setup.difficulty.label")} desc={t("setup.difficulty.desc")} cols={layout.rowCols}>
              <DifficultyPicker value={state.diff} counts={diffCounts} onChange={setDiff} />
            </SetupRow>

            <UnderReviewRow count={reviewCount} skip={state.skipReview} onChange={setSkipReview} layout={layout} />

            <SetupRow title={t("practice.setup.feedback")} desc={t("practice.setup.feedbackDesc")} cols={layout.rowCols}>
              <div className="st-cards" style={{ gridTemplateColumns: layout.cardCols }}>
                {FEEDBACK.map((f) => (
                  <ChoiceCard key={f.id} icon={f.icon} label={t(`practice.feedback.${f.id}.label`)} desc={t(`practice.feedback.${f.id}.desc`)} on={state.feedback === f.id} onSelect={() => setFeedback(f.id)} />
                ))}
              </div>
            </SetupRow>
          </MoreOptions>
        </div>

        <aside style={{ position: layout.stickySummary ? "sticky" : "static", top: 0 }}>
          <div className="st-card st-summary">
            <div className="st-summary-head">
              <div className="st-summary-title">{t("setup.summary.title")}</div>
              <div className="st-summary-sub" role="status">{t("setup.summary.matches", { count: matched })}</div>
            </div>
            <div className="st-summary-rows">
              <SummaryRow icon={source.icon} label={t("setup.summary.source")} value={sourceLabel(source.id)} />
              <SummaryRow icon={IC.circleCheck} label={t("setup.studyStatus.title")} value={study.label} />
              <SummaryRow icon={IC.tag} label={t("setup.domains.title")} value={domainSummary(state.tags)} />
              {reviewCount > 0 && <SummaryRow icon={IC.alert} label={t("study.underReview.badge")} value={t(state.skipReview ? "setup.summary.skipped" : "setup.summary.included")} />}
              <SummaryRow icon={IC.listOrdered} label={t("setup.summary.questions")} value={sessionSize} />
              <SummaryRow icon={IC.clock} label={t("setup.summary.estimatedTime")} value={sessionSize ? t("setup.summary.minutes", { count: Math.max(1, Math.round(sessionSize * MINUTES_PER_QUESTION)) }) : "—"} />
            </div>
            {empty && <EmptyPoolNotice id={emptyId} {...empty} />}
            <div className="st-summary-foot">
              <button
                type="button" className="st-btn st-btn--primary" onClick={startPractice}
                disabled={matched === 0} aria-describedby={empty ? emptyId : undefined}
              >
                {t("setup.summary.start")}<Icon d={IC.arrowRight} size={20} />
              </button>
            </div>
          </div>
          <p className="st-summary-note">
            <Icon d={IC.eyeOff} size={14} />
            <span>{t("practice.setup.hiddenNote")}</span>
          </p>
        </aside>
      </div>
    </div>
  );
}
