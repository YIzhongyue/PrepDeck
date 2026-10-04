// The Statistics screen before the first answer. Every figure below it needs
// answers to mean anything, so instead of a 0% accuracy and two empty charts
// the first thing on the page is the one step that fills them: a short
// session (design review, 4 October 2026).

import { BookOpen01, PlayCircle } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";

export default function FirstSessionCard({
  sessionSize, minutes, onStart, onLearn,
}: {
  /** Questions the quick start will draw; 0 disables it. */
  sessionSize: number;
  minutes: number;
  onStart: () => void;
  onLearn: () => void;
}) {
  return (
    <section className="pd-stats-card pd-stats-first" aria-labelledby="pd-stats-first-title">
      <div className="pd-stats-first-copy">
        <span className="pd-stats-kicker">Get started</span>
        <h2 id="pd-stats-first-title">{sessionSize ? `Answer your first ${sessionSize} questions` : "Answer your first questions"}</h2>
        <p className="pd-stats-muted" style={{ margin: 0, fontSize: 14 }}>
          {sessionSize
            ? `About ${minutes} minutes, drawn from questions you have not seen. `
            : "There are no unattempted questions to draw from. "}
          Accuracy, the trend chart and your weakest domains fill in once there are answers to measure.
        </p>
      </div>
      <div className="pd-stats-actions pd-stats-first-actions">
        <Button size="lg" iconLeading={PlayCircle} onClick={onStart} isDisabled={sessionSize === 0}>
          {sessionSize ? `Start ${sessionSize} questions` : "Start questions"}
        </Button>
        <Button size="lg" color="secondary" iconLeading={BookOpen01} onClick={onLearn}>
          Read with answers first
        </Button>
      </div>
    </section>
  );
}
