import { useEffect, useId, useMemo, useState } from "react";
import { MAX_ATTEMPT_QUESTIONS, mockFormatOptions, type MockFormatId } from "@prepdeck/shared";
import { useCatalogState, useMockExamActions, useMockExamState, useViewport, useWorkspaceState } from "../store/PrepDeckContext";
import { IC, Icon } from "../components/study/StudyKit";
import { ChoiceCard, SetupHeader, SetupRow, SummaryRow, UnderReviewRow, setupLayout } from "../components/study/SetupKit";
import { MAX_CUSTOM_MINUTES, MIN_CUSTOM_MINUTES, mockPlan, officialFormatOf, wholeNumberInRange } from "../lib/mockFormat";
import { underReviewCount } from "../lib/underReview";
import type { Breakpoints } from "../lib/responsive";
import { useI18n } from "../i18n";

const FORMAT_ICON: Record<MockFormatId, string> = { full: IC.fileText, half: IC.hourglass, sprint: IC.zap, custom: IC.sliders };

// Titles and descriptions are the `mock.setup.rules` messages.
const RULES = [
  { id: "random", icon: IC.shuffle },
  { id: "noFeedback", icon: IC.eyeOff },
  { id: "serverClock", icon: IC.server },
  { id: "autosave", icon: IC.save }
] as const;

export default function MockSetup({ bp }: { bp: Breakpoints }) {
  const { exams, examId } = useWorkspaceState();
  const { catalog } = useCatalogState();
  const state = { ...useMockExamState(), exams, examId, catalog };
  const { width } = useViewport();
  const { setMockFormat, setMockCount, setMockMinutes, setMockSkipReview, beginMock } = useMockExamActions();
  const { t } = useI18n();

  const layout = setupLayout(width, bp.phone);
  const exam = state.exams.find((e) => e.id === state.examId);
  const official = officialFormatOf(state.exams, state.examId);
  const options = mockFormatOptions(official);
  const plan = mockPlan(state);
  const reviewCount = useMemo(() => underReviewCount(state.catalog), [state.catalog]);
  const skipping = state.mockSkipReview && reviewCount > 0;
  // The API caps an attempt at MAX_ATTEMPT_QUESTIONS, so never offer more
  // than that even for an exam with a larger bank. Skipping questions under
  // review does not narrow this field: a length it leaves too few questions
  // for is cut short by mockPlan and explained beside the summary, as a fixed
  // format is, rather than turning what was typed into an error.
  const bankMax = Math.min(state.catalog.length, MAX_ATTEMPT_QUESTIONS);
  const questionMax = Math.max(1, bankMax);
  const count = useWholeNumberText(state.mockCount, 1, questionMax, setMockCount);
  const minutes = useWholeNumberText(state.mockMinutes, MIN_CUSTOM_MINUTES, MAX_CUSTOM_MINUTES, setMockMinutes);
  // Begin exam starts what the fields show, so it waits for both to be valid.
  const customInvalid = plan.format === "custom" && (!count.valid || !minutes.valid);
  // While a field is invalid the store still holds its last valid value (for
  // 400 minutes, the "40" typed on the way). Show a dash rather than that.
  const shownCount = plan.format === "custom" && !count.valid ? "—" : plan.questionCount;
  const shownMinutes = plan.format === "custom" && !minutes.valid ? "—" : plan.timeLimitMinutes;
  const active = state.activeMockAttempt;
  const activeAnswered = active ? Object.values(active.selectedAnswers).filter((a) => a.some((v) => v.trim())).length : 0;
  const activeMinutesLeft = active?.timeLimitSeconds
    ? Math.max(0, Math.ceil((new Date(active.startedAt).getTime() + active.timeLimitSeconds * 1000 - Date.now()) / 60000))
    : null;
  const passMark = plan.requiredCorrect != null
    ? t("mock.setup.requiredCorrect", { required: plan.requiredCorrect, total: plan.questionCount })
    : exam?.passMarkPct != null ? `${exam.passMarkPct}%` : t("mock.setup.notSet");

  return (
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      <SetupHeader screen="mock" title={t("mock.setup.title")}>
        {t("mock.setup.intro")}
      </SetupHeader>

      {active && (
        <div className="st-banner" role="status">
          <span className="st-banner-icon"><Icon d={IC.timer} size={18} /></span>
          <div className="st-banner-text">
            <div className="st-banner-title">{t("mock.setup.inProgress")}</div>
            <div>
              {activeMinutesLeft != null
                ? t("mock.setup.answeredLeft", { answered: activeAnswered, total: active.questionIds.length, count: activeMinutesLeft })
                : t("mock.setup.answered", { answered: activeAnswered, total: active.questionIds.length })}
              {" "}{t("mock.setup.resumeOrSubmit")}
            </div>
          </div>
          <button type="button" className="st-btn st-btn--primary" onClick={beginMock}>{t("mock.setup.resume")}</button>
        </div>
      )}

      <div className="st-setup" style={{ gridTemplateColumns: layout.setupCols }}>
        <div className="st-rows">
          <SetupRow title={t("mock.setup.format")} desc={t("mock.setup.formatDesc")} cols={layout.rowCols}>
            <div className="st-cards" style={{ gridTemplateColumns: layout.cardCols }}>
              {options.map((o) => (
                <ChoiceCard
                  key={o.id} icon={FORMAT_ICON[o.id]} label={t(`mock.setup.formats.${o.id}`)} on={plan.format === o.id} onSelect={() => setMockFormat(o.id)}
                  desc={t(o.id === "full" ? "mock.setup.formatSizeFull" : "mock.setup.formatSize", { count: o.questionCount, minutes: o.timeLimitMinutes })}
                />
              ))}
              <ChoiceCard icon={FORMAT_ICON.custom} label={t("mock.setup.formats.custom")} desc={t("mock.setup.customDesc")} on={plan.format === "custom"} onSelect={() => setMockFormat("custom")} />
            </div>
            {plan.format === "custom" && (
              <div className="st-custom" style={{ gridTemplateColumns: layout.cardCols }}>
                <WholeNumberField
                  label={t("setup.summary.questions")} field={count} min={1} max={questionMax}
                  error={t("mock.setup.countError", { max: questionMax })}
                />
                <WholeNumberField
                  label={t("mock.setup.timeLimit")} field={minutes} min={MIN_CUSTOM_MINUTES} max={MAX_CUSTOM_MINUTES}
                  error={t("mock.setup.minutesError", { min: MIN_CUSTOM_MINUTES, max: MAX_CUSTOM_MINUTES })}
                />
              </div>
            )}
            {!official && (
              <div className="st-note"><Icon d={IC.info} />{t("mock.setup.noOfficial")}</div>
            )}
          </SetupRow>

          <UnderReviewRow count={reviewCount} skip={state.mockSkipReview} onChange={setMockSkipReview} layout={layout} />

          <SetupRow title={t("mock.setup.howItWorks")} cols={layout.rowCols}>
            <div className="st-rules">
              {RULES.map((r) => (
                <div key={r.id} className="st-rule">
                  <span className="st-rule-icon"><Icon d={r.icon} /></span>
                  <div><div className="st-rule-title">{t(`mock.setup.rules.${r.id}.title`)}</div><div className="st-rule-desc">{t(`mock.setup.rules.${r.id}.desc`)}</div></div>
                </div>
              ))}
            </div>
          </SetupRow>
        </div>

        <aside className="st-card st-summary" style={{ position: layout.stickySummary ? "sticky" : "static" }}>
          <div className="st-summary-head">
            <div className="st-summary-title">{t("mock.setup.summary")}</div>
            {exam && <div className="st-summary-sub">{exam.name}</div>}
          </div>
          <div className="st-big-pair">
            <div><div className="st-big-pair-k">{t("setup.summary.questions")}</div><div className="st-big-pair-v">{shownCount}</div></div>
            <div><div className="st-big-pair-k">{t("mock.setup.minutes")}</div><div className="st-big-pair-v">{shownMinutes}</div></div>
          </div>
          <div className="st-summary-rows">
            <SummaryRow icon={IC.clock} label={t("mock.setup.pace")} value={plan.questionCount && !customInvalid ? t("mock.setup.paceValue", { minutes: (plan.timeLimitMinutes / plan.questionCount).toFixed(1) }) : "—"} />
            <SummaryRow icon={IC.target} label={t("mock.setup.passMark")} value={passMark} />
            {reviewCount > 0 && <SummaryRow icon={IC.alert} label={t("study.underReview.badge")} value={t(state.mockSkipReview ? "setup.summary.skipped" : "setup.summary.included")} />}
          </div>
          {plan.questionCount < plan.requested && plan.questionCount > 0 && (
            <p className="st-summary-warn">
              {t(skipping
                ? plan.format === "custom" ? "mock.setup.shortBankSkipping" : "mock.setup.shortBankSkippingPace"
                : plan.format === "custom" ? "mock.setup.shortBank" : "mock.setup.shortBankPace", { count: plan.questionCount })}
            </p>
          )}
          {skipping && plan.questionCount === 0 && (
            <p className="st-summary-warn">{t("mock.setup.allUnderReview")}</p>
          )}
          <div className="st-summary-foot">
            {active ? (
              <button type="button" className="st-btn st-btn--primary" onClick={beginMock}><Icon d={IC.play} size={18} fill="currentColor" />{t("mock.setup.resumeInProgress")}</button>
            ) : (
              <button type="button" className="st-btn st-btn--primary" onClick={beginMock} disabled={plan.questionCount === 0 || customInvalid}>
                <Icon d={IC.play} size={18} fill="currentColor" />{t("mock.setup.begin")}
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

interface WholeNumberText {
  text: string;
  valid: boolean;
  change: (text: string) => void;
  blur: () => void;
}

// A custom-format field keeps exactly what the learner types; the store only
// ever receives a valid value. Clamping every keystroke used to turn 120
// minutes into 300 and 45 into 55 (issue #55), because each intermediate digit
// was replaced before the next one arrived.
function useWholeNumberText(value: number, min: number, max: number, commit: (n: number) => void): WholeNumberText {
  const [text, setText] = useState(String(value));
  // Follow the store when it changes elsewhere (a new exam's defaults), but not
  // when it changed because this field just committed what is being typed.
  useEffect(() => {
    setText((current) => (wholeNumberInRange(current, min, max) === value ? current : String(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the stored value only
  }, [value]);
  const parsed = wholeNumberInRange(text, min, max);
  return {
    text,
    valid: parsed !== null,
    change: (next) => {
      setText(next);
      const n = wholeNumberInRange(next, min, max);
      if (n !== null && n !== value) commit(n);
    },
    // Tidy a valid entry ("045" becomes "45"). An invalid one stays as typed,
    // next to its error, rather than being silently replaced.
    blur: () => { if (parsed !== null) setText(String(parsed)); },
  };
}

function WholeNumberField({ label, field, min, max, error }: { label: string; field: WholeNumberText; min: number; max: number; error: string }) {
  const id = useId();
  return (
    <div className="st-field">
      <label htmlFor={`${id}-input`}>{label}</label>
      <input
        id={`${id}-input`} className="st-input" type="number" inputMode="numeric" min={min} max={max}
        value={field.text} onChange={(e) => field.change(e.target.value)} onBlur={field.blur}
        aria-invalid={!field.valid} aria-describedby={`${id}-error`}
      />
      <span id={`${id}-error`} className="st-error" aria-live="polite">{field.valid ? "" : error}</span>
    </div>
  );
}
