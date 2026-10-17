import { useEffect, useState } from "react";
import type { QuestionForm } from "../lib/questionAuthoring";
import { formPayload } from "../lib/questionAuthoring";
import { questionTypeLabel } from "../lib/questionTypes";
import { breakpointsFor } from "../lib/responsive";
import QuestionContent from "./QuestionContent";
import { OfficialExplanation, OptionGroup, OptionRow, QuestionBadges, UnderReviewNotice } from "./study/StudyKit";

// Presentation only: the unsaved form is the source of truth. Do not mount a
// study screen/provider or the AI-backed ExplanationPanel in authoring.
export default function QuestionDraftPreview({ form }: { form: QuestionForm }) {
  const [bp, setBp] = useState(() => breakpointsFor(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const resize = () => setBp(previous => {
      const next = breakpointsFor(window.innerWidth, window.innerHeight);
      return next.phone === previous.phone && next.landscapePhone === previous.landscapePhone ? previous : next;
    });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const flow = bp.phone || bp.landscapePhone;
  const { correctAnswers } = formPayload(form);
  const multi = form.type === "multiple_choice";
  const typeLabel = multi && !correctAnswers.length ? "Multiple choice" : questionTypeLabel({ type: form.type, chooseCount: correctAnswers.length });
  return (
    <div className={`pd-study question-draft-preview${bp.phone ? " st-phone" : ""}${flow ? " st-flow" : ""}${bp.landscapePhone ? " st-landscape" : ""}`}>
      <section className="st-card st-q" aria-label="Question">
        <div className="st-q-head">
          <QuestionBadges label={form.externalId || null} typeLabel={typeLabel} multi={multi} tags={form.tags} compact={flow} underReview={form.needsReview} />
        </div>
        <div className="st-q-body">
          <UnderReviewNotice question={form} />
          <div className="st-stem"><QuestionContent src={form.stem} /></div>
          <div className="st-opts">
            {form.type === "fill_blank" ? (
              <div className="st-answer-box">
                <span className="st-opt-status">Accepted answer(s)</span>
                <span>{correctAnswers.join(" · ") || "Not selected"}</span>
              </div>
            ) : (
              <>
                <OptionGroup kind="review">{form.options.map(option => {
                  const right = correctAnswers.includes(option.id);
                  return <OptionRow key={option.id} id={option.id} state={right ? "correct" : "dim"} status={right ? "Correct answer" : undefined}>
                    <QuestionContent src={option.text} />
                  </OptionRow>;
                })}</OptionGroup>
                {!correctAnswers.length && <p className="st-muted">Correct answers: Not selected</p>}
              </>
            )}
          </div>
        </div>
      </section>
      <OfficialExplanation explanation={form.explanation} />
    </div>
  );
}
