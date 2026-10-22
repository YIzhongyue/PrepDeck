import { MARK_STYLES } from "@prepdeck/shared";
import { HL } from "../data/constants";
import { useNotesActions, useNotesState, useTextSelection } from "../store/PrepDeckContext";
import { useI18n } from "../i18n";

export default function AnnotationToolbar() {
  const tsel = useTextSelection();
  const { markAliases } = useNotesState();
  const { apply } = useNotesActions();
  const { t } = useI18n();
  if (!tsel) return null;
  return (
    <div
      style={{
        position: "fixed", zIndex: 70, left: tsel.x, top: tsel.y, transform: "translate(-50%, -100%)",
        display: "flex", alignItems: "center", gap: 4, padding: 6, borderRadius: 999,
        background: "var(--pd-ink)", boxShadow: "var(--pd-shadow-lg)"
      }}
    >
      {MARK_STYLES.map((style) => {
        const alias = markAliases[style];

        return (
          <button
            key={style}
            type="button"
            onClick={() => apply(style)}
            title={alias}
            aria-label={alias}
            style={{
              width: 26, height: 26, borderRadius: "50%",
              border: "1.5px solid color-mix(in srgb, var(--pd-ink-fg) 35%, transparent)",
              background: HL[style]?.background, cursor: "pointer", padding: 0
            }}
          />
        );
      })}
      <span style={{ width: 1, height: 18, background: "color-mix(in srgb, var(--pd-ink-fg) 25%, transparent)", margin: "0 3px" }} />
      <button
        type="button"
        onClick={() => apply("underline")}
        title={t("annotations.underline")}
        aria-label={t("annotations.underline")}
        style={{ width: 28, height: 26, border: 0, borderRadius: 999, background: "transparent", color: "var(--pd-ink-fg)", cursor: "pointer", font: "inherit", fontSize: 13, textDecoration: "underline" }}
      >
        U
      </button>
      <button
        type="button"
        onClick={() => apply("bold")}
        title={t("annotations.bold")}
        aria-label={t("annotations.bold")}
        style={{ width: 28, height: 26, border: 0, borderRadius: 999, background: "transparent", color: "var(--pd-ink-fg)", cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 700 }}
      >
        B
      </button>
    </div>
  );
}
