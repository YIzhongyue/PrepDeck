import { useState } from "react";
import { usePrepDeck } from "../store/PrepDeckContext";

// FR-7.9: shown wherever a "Generate explanation" action needs the API key
// but only its encrypted-in-IndexedDB form survived the refresh — lets the
// user unlock right there instead of routing back to Settings.
export default function UnlockKeyPrompt({ onUnlock }: { onUnlock: () => void }) {
  const { unlockSessionKey } = usePrepDeck();
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
      setError("Wrong passphrase, or no saved key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 16, background: "var(--color-accent-100)" }}>
      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>Unlock your saved key to generate this</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="input" type="password" placeholder="Passphrase" value={passphrase} autoFocus
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn btn-primary" disabled={busy || !passphrase} onClick={submit}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </div>
      {error && <p style={{ margin: 0, fontSize: 12, color: "var(--color-danger, #c0392b)" }}>{error}</p>}
    </div>
  );
}
