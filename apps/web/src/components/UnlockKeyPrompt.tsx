import { useState } from "react";
import { useAccountActions } from "../store/PrepDeckContext";
import { useI18n } from "../i18n";

// FR-7.9: shown wherever a "Generate explanation" action needs the API key
// but only its encrypted-in-IndexedDB form survived the refresh — lets the
// user unlock right there instead of routing back to Settings.
export default function UnlockKeyPrompt({ onUnlock }: { onUnlock: () => void }) {
  const { unlockSessionKey } = useAccountActions();
  const { t } = useI18n();

  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!passphrase || busy) return;
    setError(null);
    setBusy(true);
    try {
      await unlockSessionKey(passphrase);
      setPassphrase("");
      onUnlock();
    } catch {
      setError(t("settings.ai.errors.unlockFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 16, background: "var(--color-accent-100)" }}>
      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{t("study.ai.unlockToGenerate")}</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="input" type="password" placeholder={t("settings.ai.passphrase")} aria-label={t("settings.ai.passphrase")} value={passphrase} autoFocus
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn btn-primary" disabled={busy || !passphrase} onClick={submit}>
          {busy ? t("study.ai.unlocking") : t("settings.ai.unlock")}
        </button>
      </div>
      {error && <p style={{ margin: 0, fontSize: 12, color: "var(--color-danger, #c0392b)" }}>{error}</p>}
    </div>
  );
}
