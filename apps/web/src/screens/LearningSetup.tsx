import { useId, useMemo, useState } from "react";
import { useCatalogState, useLearningActions, useLearningState, useStudyProgressState, useViewport } from "../store/PrepDeckContext";
import { underReviewCount } from "../lib/underReview";
import { STUDY_FILTERS, studyFilterCounts } from "../lib/studyStatus";
import { IC, Icon } from "../components/study/StudyKit";
import {
  DifficultyPicker, DomainPicker, EmptyPoolNotice, SetupHeader, SetupRow, StudyStatusRow, SummaryRow, UnderReviewRow, difficultyChoiceLabel, domainSummary, setupLayout,
  type DifficultyChoice
} from "../components/study/SetupKit";
import type { Breakpoints } from "../lib/responsive";
import { useI18n } from "../i18n";

// FR-14.1/FR-14.2/FR-14.9 — choose a starting question sequence number
// (optionally resuming last position), and optional tag/difficulty filters,
// then walk the exam's questions in order with the answer already revealed.
export default function LearningSetup({ bp }: { bp: Breakpoints }) {
  // learningPool() filters the catalog on these, so they are all read here.
  const { catalog } = useCatalogState();
  const state = { ...useLearningState(), ...useStudyProgressState(), catalog };
  const { width } = useViewport();
  const {
    learningPool, setLearningStartInput, toggleLearningTag, clearLearningTags, setLearningDiff, setLearningSkipReview, setLearningStudyFilter, beginLearning
  } = useLearningActions();
  const { t } = useI18n();

  const layout = setupLayout(width, bp.phone);
  const [startText, setStartText] = useState(String(state.lStartInput));
  const pool = learningPool();
  const maxSeq = pool.length ? pool[pool.length - 1]!.sequenceNumber : 0;
  const numberingGaps = maxSeq > pool.length;
  const startHintId = useId();
  const emptyId = useId();
  const diffCounts = useMemo(() => {
    const counts: Record<DifficultyChoice, number> = { all: state.catalog.length, easy: 0, medium: 0, hard: 0 };
    for (const q of state.catalog) if (q.diff) counts[q.diff]++;
    return counts;
  }, [state.catalog]);
  const reviewCount = useMemo(() => underReviewCount(state.catalog), [state.catalog]);
  const studyCounts = useMemo(() => studyFilterCounts(state.catalog, state.studyStatus), [state.catalog, state.studyStatus]);
  const study = STUDY_FILTERS.find((f) => f.id === state.lStudyFilter) ?? STUDY_FILTERS[0]!;
  // Mirrors beginLearning: the first match at or after the chosen number, or
  // the last match when the number is past the end.
  const first = pool.find((q) => q.sequenceNumber >= state.lStartInput) ?? pool[pool.length - 1];

  // Nothing to start: say why, and offer the change that brings questions back.
  let empty: { title: string; body: string; action?: { label: string; onClick: () => void } } | null = null;
  if (!pool.length) {
    const others = state.lStudyFilter === "all" ? 0 : learningPool({ study: "all" }).length;
    if (!state.catalog.length) {
      empty = { title: t("practice.emptySource.all.title"), body: t("practice.emptySource.all.body") };
    } else if (others > 0) {
      // Only the study status rules every question out (issue #119).
      empty = {
        title: t(state.lStudyFilter === "unstudied" ? "practice.empty.allStudiedTitle" : "practice.empty.noneStudiedTitle"),
        body: t(state.lStudyFilter === "unstudied" ? "learning.setup.allStudiedBody" : "practice.empty.noneStudiedBody"),
        action: { label: t("learning.setup.learnMatching", { count: others }), onClick: () => setLearningStudyFilter("all") }
      };
    } else {
      empty = {
        title: t("practice.empty.noMatchTitle"),
        body: t("learning.setup.noMatchBody"),
        action: { label: t("learning.setup.clearAll"), onClick: () => { clearLearningTags(); setLearningDiff("all"); setLearningStudyFilter("all"); setLearningSkipReview(false); } }
      };
    }
  }

  const commitStart = (raw: string) => {
    const n = Math.max(1, parseInt(raw, 10) || 1);
    setStartText(String(n));
    setLearningStartInput(n);
  };

  return (
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      <SetupHeader screen="learning" title={t("learning.setup.title")}>
        {t("learning.setup.intro")}
      </SetupHeader>

      {state.lResume != null && (
        <div className="st-banner st-banner--brand" role="status">
          <span className="st-banner-icon"><Icon d={IC.history} size={18} /></span>
          <div className="st-banner-text">
            <div className="st-banner-title">{t("learning.setup.resumeTitle")}</div>
            <div>{t("learning.setup.resumeBody", { sequence: String(state.lResume) })}</div>
          </div>
          {/* Resumes within the filtered questions, at the first match from there. */}
          <button type="button" className="st-btn st-btn--primary" disabled={!pool.length} onClick={() => beginLearning(state.lResume!)}>{t("learning.setup.resume")}</button>
        </div>
      )}

      <div className="st-setup" style={{ gridTemplateColumns: layout.setupCols }}>
        <div className="st-rows">
          <SetupRow title={t("learning.setup.start")} desc={t("learning.setup.startDesc")} cols={layout.rowCols}>
            <label className="st-field st-start">
              {maxSeq ? t("learning.setup.startFromRange", { max: String(maxSeq) }) : t("learning.setup.startFrom")}
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
                {t("learning.setup.numberingGaps", { count: pool.length, max: String(maxSeq) })}
              </p>
            )}
          </SetupRow>

          <SetupRow title={t("setup.domains.title")} desc={t("setup.domains.desc")} cols={layout.rowCols}>
            <DomainPicker
              questions={state.catalog} selected={state.lTags} phone={bp.phone}
              onToggle={toggleLearningTag} onClear={clearLearningTags}
            />
          </SetupRow>

          <SetupRow title={t("setup.difficulty.label")} desc={t("setup.difficulty.desc")} cols={layout.rowCols}>
            <DifficultyPicker value={state.lDiff} counts={diffCounts} onChange={setLearningDiff} />
          </SetupRow>

          <StudyStatusRow value={state.lStudyFilter} counts={studyCounts} unavailable={state.studyStatusError} onChange={setLearningStudyFilter} layout={layout} />

          <UnderReviewRow count={reviewCount} skip={state.lSkipReview} onChange={setLearningSkipReview} layout={layout} />
        </div>

        <aside style={{ position: layout.stickySummary ? "sticky" : "static", top: 0 }}>
          <div className="st-card st-summary">
            <div className="st-summary-head">
              <div className="st-summary-title">{t("setup.summary.title")}</div>
              <div className="st-summary-sub" role="status">{t("setup.summary.matches", { count: pool.length })}</div>
            </div>
            <div className="st-summary-rows">
              <SummaryRow icon={IC.tag} label={t("setup.domains.title")} value={domainSummary(state.lTags)} />
              <SummaryRow icon={IC.sliders} label={t("setup.difficulty.label")} value={difficultyChoiceLabel(state.lDiff)} />
              <SummaryRow icon={IC.circleCheck} label={t("setup.studyStatus.title")} value={study.label} />
              {reviewCount > 0 && <SummaryRow icon={IC.alert} label={t("study.underReview.badge")} value={t(state.lSkipReview ? "setup.summary.skipped" : "setup.summary.included")} />}
              <SummaryRow icon={IC.play} label={t("learning.setup.startsAt")} value={first ? `#${first.sequenceNumber}` : "—"} />
              <SummaryRow icon={IC.listOrdered} label={t("setup.summary.questions")} value={pool.length} />
            </div>
            {empty && <EmptyPoolNotice id={emptyId} {...empty} />}
            <div className="st-summary-foot">
              <button type="button" className="st-btn st-btn--primary" disabled={!pool.length} aria-describedby={empty ? emptyId : undefined} onClick={() => beginLearning()}>
                {t("learning.setup.begin")}<Icon d={IC.arrowRight} size={20} />
              </button>
            </div>
          </div>
          <p className="st-summary-note">
            <Icon d={IC.info} size={14} />
            <span>{t("learning.setup.note")}</span>
          </p>
        </aside>
      </div>
    </div>
  );
}
