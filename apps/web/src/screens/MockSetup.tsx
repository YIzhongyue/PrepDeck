import { useEffect, useId, useState } from "react";
import { MAX_ATTEMPT_QUESTIONS, mockFormatOptions, type MockFormatId } from "@prepdeck/shared";
import { usePrepDeck } from "../store/PrepDeckContext";
import { IC, Icon } from "../components/study/StudyKit";
import { ChoiceCard, SetupHeader, SetupRow, SummaryRow, setupLayout } from "../components/study/SetupKit";
import { MAX_CUSTOM_MINUTES, MIN_CUSTOM_MINUTES, mockPlan, officialFormatOf, wholeNumberInRange } from "../lib/mockFormat";
import type { Breakpoints } from "../lib/responsive";

const FORMAT_ICON: Record<MockFormatId, string> = { full: IC.fileText, half: IC.hourglass, sprint: IC.zap, custom: IC.sliders };

const RULES = [
  { icon: IC.shuffle, title: "Random draw, no repeats", desc: "Questions are sampled from the whole bank." },
  { icon: IC.eyeOff, title: "No feedback until you submit", desc: "Flag anything you want to revisit before submitting." },
  { icon: IC.server, title: "Server-side clock", desc: "The timer keeps running if you close the tab." },
  { icon: IC.save, title: "Answers save as you go", desc: "A dropped connection never costs the attempt." }
];

export default function MockSetup({ bp }: { bp: Breakpoints }) {
  const { state, width, setMockFormat, setMockCount, setMockMinutes, beginMock } = usePrepDeck();
  const layout = setupLayout(width, bp.phone);
  const exam = state.exams.find((e) => e.id === state.examId);
  const official = officialFormatOf(state.exams, state.examId);
  const options = mockFormatOptions(official);
  const plan = mockPlan(state);
  // The API caps an attempt at MAX_ATTEMPT_QUESTIONS, so never offer more
  // than that even for an exam with a larger bank.
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
    ? `${plan.requiredCorrect} of ${plan.questionCount} correct`
    : exam?.passMarkPct != null ? `${exam.passMarkPct}%` : "Not set";

  return (
    <div className={`pd-study${bp.phone ? " st-phone" : ""}`}>
      <SetupHeader icon={IC.timer} kicker="Mock exam" title="Simulate the real thing">
        Timed, randomly drawn, no feedback until you submit.
      </SetupHeader>

      {active && (
        <div className="st-banner" role="status">
          <span className="st-banner-icon"><Icon d={IC.timer} size={18} /></span>
          <div className="st-banner-text">
            <div className="st-banner-title">You have an exam in progress</div>
            <div>
              {activeAnswered} of {active.questionIds.length} answered
              {activeMinutesLeft != null && ` · ${activeMinutesLeft} ${activeMinutesLeft === 1 ? "minute" : "minutes"} left on the server clock`}.
              {" "}Resume it, or submit it before starting a new one.
            </div>
          </div>
          <button type="button" className="st-btn st-btn--primary" onClick={beginMock}>Resume exam</button>
        </div>
      )}

      <div className="st-setup" style={{ gridTemplateColumns: layout.setupCols }}>
        <div className="st-rows">
          <SetupRow title="Format" desc="Choose the length and time limit." cols={layout.rowCols}>
            <div className="st-cards" style={{ gridTemplateColumns: layout.cardCols }}>
              {options.map((o) => (
                <ChoiceCard
                  key={o.id} icon={FORMAT_ICON[o.id]} label={o.label} on={plan.format === o.id} onSelect={() => setMockFormat(o.id)}
                  desc={`${o.questionCount} questions · ${o.timeLimitMinutes} min${o.id === "full" ? ". Matches the real test." : ""}`}
                />
              ))}
              <ChoiceCard icon={FORMAT_ICON.custom} label="Custom" desc="Set your own length and time" on={plan.format === "custom"} onSelect={() => setMockFormat("custom")} />
            </div>
            {plan.format === "custom" && (
              <div className="st-custom" style={{ gridTemplateColumns: layout.cardCols }}>
                <WholeNumberField
                  label="Questions" field={count} min={1} max={questionMax}
                  error={`Enter a whole number from 1 to ${questionMax}.`}
                />
                <WholeNumberField
                  label="Time limit (minutes)" field={minutes} min={MIN_CUSTOM_MINUTES} max={MAX_CUSTOM_MINUTES}
                  error={`Enter a whole number of minutes from ${MIN_CUSTOM_MINUTES} to ${MAX_CUSTOM_MINUTES}.`}
                />
              </div>
            )}
            {!official && (
              <div className="st-note"><Icon d={IC.info} />Full and half-length exams appear once an admin sets this exam's official format.</div>
            )}
          </SetupRow>

          <SetupRow title="How it works" cols={layout.rowCols}>
            <div className="st-rules">
              {RULES.map((r) => (
                <div key={r.title} className="st-rule">
                  <span className="st-rule-icon"><Icon d={r.icon} /></span>
                  <div><div className="st-rule-title">{r.title}</div><div className="st-rule-desc">{r.desc}</div></div>
                </div>
              ))}
            </div>
          </SetupRow>
        </div>

        <aside className="st-card st-summary" style={{ position: layout.stickySummary ? "sticky" : "static" }}>
          <div className="st-summary-head">
            <div className="st-summary-title">Exam summary</div>
            {exam && <div className="st-summary-sub">{exam.name}</div>}
          </div>
          <div className="st-big-pair">
            <div><div className="st-big-pair-k">Questions</div><div className="st-big-pair-v">{shownCount}</div></div>
            <div><div className="st-big-pair-k">Minutes</div><div className="st-big-pair-v">{shownMinutes}</div></div>
          </div>
          <div className="st-summary-rows">
            <SummaryRow icon={IC.clock} label="Pace" value={plan.questionCount && !customInvalid ? `${(plan.timeLimitMinutes / plan.questionCount).toFixed(1)} min / question` : "—"} />
            <SummaryRow icon={IC.target} label="Pass mark" value={passMark} />
          </div>
          {plan.questionCount < plan.requested && plan.questionCount > 0 && (
            <p className="st-summary-warn">This bank has {plan.questionCount} {plan.questionCount === 1 ? "question" : "questions"}, so the exam uses all of them{plan.format === "custom" ? "" : ", at the same pace"}.</p>
          )}
          <div className="st-summary-foot">
            {active ? (
              <button type="button" className="st-btn st-btn--primary" onClick={beginMock}><Icon d={IC.play} size={18} fill="currentColor" />Resume in-progress exam</button>
            ) : (
              <button type="button" className="st-btn st-btn--primary" onClick={beginMock} disabled={plan.questionCount === 0 || customInvalid}>
                <Icon d={IC.play} size={18} fill="currentColor" />Begin exam
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
