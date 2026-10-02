import { useState } from "react";
import { MASCOT_STYLES, type MascotStyle } from "@prepdeck/shared";
import { useMascot } from "../store/MascotContext";
import MascotImage from "./MascotImage";

const labels: Record<MascotStyle, string> = { "3D-Chibi": "3D Chibi", "2D-Anime": "2D Anime" };

export default function MascotSettingsPanel() {
  const { style, status, refresh, save } = useMascot();
  const [draft, setDraft] = useState<MascotStyle | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selected = draft ?? style;

  async function submit() {
    setSaving(true); setError(""); setMessage("");
    try {
      await save(selected);
      setDraft(null);
      setMessage("Mascot updated for everyone. Other users will see it when they refresh or return to PrepDeck.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save. Please retry.");
    } finally { setSaving(false); }
  }

  return (
    <section className="mascot-settings" aria-labelledby="mascot-settings-title">
      <h2 id="mascot-settings-title">Site mascot</h2>
      <p>Choose the mascot used throughout PrepDeck, including sign-in. This setting applies to everyone.</p>
      <p role="status">{status === "loading" ? "Loading current mascot…" : status === "ready" ? `Current mascot: ${labels[style]}` : "Could not load the current mascot. The last available style is still displayed."}</p>
      {status === "failed" && <button className="btn btn-secondary" type="button" onClick={() => void refresh()}>Retry loading</button>}
      <fieldset disabled={status !== "ready" || saving}>
        <legend>Mascot style</legend>
        <div className="mascot-options">
          {MASCOT_STYLES.map(option => (
            <label key={option} className={`mascot-option${selected === option ? " is-selected" : ""}`}>
              <MascotImage mascotStyle={option} alt={`${labels[option]} preview`} className="mascot-preview" />
              <span><input type="radio" name="mascot-style" value={option} checked={selected === option}
                onChange={() => { setDraft(option); setMessage(""); setError(""); }} /> {labels[option]}</span>
              <small>{option === style && status === "ready" ? "Current site style" : "Preview"}</small>
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" className="btn btn-primary" disabled={saving || status !== "ready" || selected === style} onClick={() => void submit()}>
        {saving ? "Saving…" : "Save mascot"}
      </button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error} Your selection is kept; you can retry saving.</p>}
    </section>
  );
}
