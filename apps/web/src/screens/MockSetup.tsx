import { MAX_ATTEMPT_QUESTIONS, mockFormatOptions, type MockFormatId } from "@prepdeck/shared";
import { usePrepDeck } from "../store/PrepDeckContext";
import { IC, Icon } from "../components/study/StudyKit";
import { ChoiceCard, SetupHeader, SetupRow, SummaryRow, setupLayout } from "../components/study/SetupKit";
import { mockPlan, officialFormatOf } from "../lib/mockFormat";
import type { Breakpoints } from "../lib/responsive";

const FORMAT_ICON: Record<MockFormatId, string> = { full: IC.fileText, half: IC.hourglass, sprint: IC.zap, custom: IC.sliders };
const MAX_CUSTOM_MINUTES = 300;

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
                <label className="st-field">Questions
                  <input
                    className="st-input" type="number" min={1} max={Math.max(1, bankMax)} value={state.mockCount}
                    onChange={(e) => setMockCount(Math.max(1, Math.min(bankMax || 1, parseInt(e.target.value, 10) || 1)))}
                  />
                </label>
                <label className="st-field">Time limit (minutes)
                  <input
                    className="st-input" type="number" min={5} max={MAX_CUSTOM_MINUTES} value={state.mockMinutes}
                    onChange={(e) => setMockMinutes(Math.max(5, Math.min(MAX_CUSTOM_MINUTES, parseInt(e.target.value, 10) || 5)))}
                  />
                </label>
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
            <div><div className="st-big-pair-k">Questions</div><div className="st-big-pair-v">{plan.questionCount}</div></div>
            <div><div className="st-big-pair-k">Minutes</div><div className="st-big-pair-v">{plan.timeLimitMinutes}</div></div>
          </div>
          <div className="st-summary-rows">
            <SummaryRow icon={IC.clock} label="Pace" value={plan.questionCount ? `${(plan.timeLimitMinutes / plan.questionCount).toFixed(1)} min / question` : "—"} />
            <SummaryRow icon={IC.target} label="Pass mark" value={passMark} />
          </div>
          {plan.questionCount < plan.requested && plan.questionCount > 0 && (
            <p className="st-summary-warn">This bank has {plan.questionCount} {plan.questionCount === 1 ? "question" : "questions"}, so the exam uses all of them{plan.format === "custom" ? "" : ", at the same pace"}.</p>
          )}
          <div className="st-summary-foot">
            {active ? (
              <button type="button" className="st-btn st-btn--primary" onClick={beginMock}><Icon d={IC.play} size={18} fill="currentColor" />Resume in-progress exam</button>
            ) : (
              <button type="button" className="st-btn st-btn--primary" onClick={beginMock} disabled={plan.questionCount === 0}>
                <Icon d={IC.play} size={18} fill="currentColor" />Begin exam
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
