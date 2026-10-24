import { useState } from "react";
import { MASCOT_STYLES, type MascotStyle } from "@prepdeck/shared";
import { useMascot } from "../store/MascotContext";
import MascotImage from "./MascotImage";
import { useI18n } from "../i18n";

const LABEL_KEYS = { "3D-Chibi": "admin.mascot.styles.chibi3d", "2D-Anime": "admin.mascot.styles.anime2d" } as const satisfies Record<MascotStyle, string>;

export default function MascotSettingsPanel() {
  const { style, status, refresh, save } = useMascot();
  const [draft, setDraft] = useState<MascotStyle | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selected = draft ?? style;
  const { t } = useI18n();
  const label = (option: MascotStyle) => t(LABEL_KEYS[option]);

  async function submit() {
    setSaving(true); setError(""); setMessage("");
    try {
      await save(selected);
      setDraft(null);
      setMessage(t("admin.mascot.saved"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("admin.mascot.saveFailed"));
    } finally { setSaving(false); }
  }

  return (
    <section className="mascot-settings" aria-labelledby="mascot-settings-title">
      <h2 id="mascot-settings-title">{t("admin.mascot.title")}</h2>
      <p>{t("admin.mascot.intro")}</p>
      <p role="status">{status === "loading" ? t("admin.mascot.loading") : status === "ready" ? t("admin.mascot.current", { style: label(style) }) : t("admin.mascot.loadFailed")}</p>
      {status === "failed" && <button className="btn btn-secondary" type="button" onClick={() => void refresh()}>{t("admin.mascot.retry")}</button>}
      <fieldset disabled={status !== "ready" || saving}>
        <legend>{t("admin.mascot.style")}</legend>
        <div className="mascot-options">
          {MASCOT_STYLES.map(option => (
            <label key={option} className={`mascot-option${selected === option ? " is-selected" : ""}`}>
              <MascotImage mascotStyle={option} alt={t("admin.mascot.preview", { style: label(option) })} className="mascot-preview" />
              <span><input type="radio" name="mascot-style" value={option} checked={selected === option}
                onChange={() => { setDraft(option); setMessage(""); setError(""); }} /> {label(option)}</span>
              <small>{t(option === style && status === "ready" ? "admin.mascot.currentStyle" : "admin.mascot.previewShort")}</small>
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" className="btn btn-primary" disabled={saving || status !== "ready" || selected === style} onClick={() => void submit()}>
        {saving ? t("common.saving") : t("admin.mascot.save")}
      </button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error} {t("admin.mascot.kept")}</p>}
    </section>
  );
}
