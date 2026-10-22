// The Statistics screen before the first answer. Every figure below it needs
// answers to mean anything, so instead of a 0% accuracy and two empty charts
// the first thing on the page is the one step that fills them: a short
// session (design review, 4 October 2026).

import { BookOpen01, PlayCircle } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { useI18n } from "../../i18n";

export default function FirstSessionCard({
  sessionSize, minutes, onStart, onLearn,
}: {
  /** Questions the quick start will draw; 0 disables it. */
  sessionSize: number;
  minutes: number;
  onStart: () => void;
  onLearn: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="pd-stats-card pd-stats-first" aria-labelledby="pd-stats-first-title">
      <div className="pd-stats-first-copy">
        <span className="pd-stats-kicker">{t("stats.first.kicker")}</span>
        <h2 id="pd-stats-first-title">{sessionSize ? t("stats.first.titleCount", { count: sessionSize }) : t("stats.first.title")}</h2>
        <p className="pd-stats-muted" style={{ margin: 0, fontSize: 14 }}>
          {sessionSize
            ? t("stats.first.about", { count: minutes })
            : t("stats.first.noneLeft")}
          {" "}{t("stats.first.fillIn")}
        </p>
      </div>
      <div className="pd-stats-actions pd-stats-first-actions">
        <Button size="lg" iconLeading={PlayCircle} onClick={onStart} isDisabled={sessionSize === 0}>
          {sessionSize ? t("stats.first.startCount", { count: sessionSize }) : t("stats.first.start")}
        </Button>
        <Button size="lg" color="secondary" iconLeading={BookOpen01} onClick={onLearn}>
          {t("stats.first.learn")}
        </Button>
      </div>
    </section>
  );
}
