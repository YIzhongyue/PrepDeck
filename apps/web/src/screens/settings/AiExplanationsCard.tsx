import { useMemo, useState } from "react";
import { CURATED_MODELS } from "@prepdeck/shared";
import { usePrepDeck, type AppState } from "../../store/PrepDeckContext";
import type { KeyMode } from "../../types";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RadioButton, RadioGroup } from "@/components/base/radio-buttons/radio-buttons";
import { Select } from "@/components/base/select/select";
import { cx } from "@/utils/cx";
import { sectionAnchor } from "./SettingsNav";

// A key already loaded this session is "done"; one saved but still encrypted
// (encrypted storage, browser refreshed) is "locked"; anything else needs setup.
export type AiKeyStatus = "done" | "locked" | "empty";

export function aiKeyStatus(state: Pick<AppState, "hasSessionKey" | "hasStoredKey" | "keyMode">): AiKeyStatus {
  if (state.hasSessionKey) return "done";
  return state.keyMode === "encrypted" && state.hasStoredKey ? "locked" : "empty";
}

// The card that wraps a radio option, in the same accent-100 / neutral-100 pair
// this screen has always used — reached through Untitled UI's semantic names,
// so it follows the active color scheme like everything else.
function optionCardClass(selected: boolean) {
  return cx(
    "rounded-[20px] px-[15px] py-[13px] ring-[1.5px] ring-inset",
    selected ? "bg-brand-primary ring-brand" : "bg-tertiary ring-primary"
  );
}

function StepDot({ n, on }: { n: number; on: boolean }) {
  return <span className={cx("settings-step-dot", on && "is-on")}>{n}</span>;
}

export default function AiExplanationsCard() {
  const {
    state, setProvider, setModel, setKeyMode, loadSessionApiKey, clearSessionApiKey,
    saveEncryptedApiKey, unlockSessionKey, forgetStoredApiKey
  } = usePrepDeck();
  const curatedModels = CURATED_MODELS[state.provider];
  const isCustomModel = !curatedModels.some((m) => m.id === state.model);
  const modelOptions = useMemo(
    () => [...curatedModels.map((m) => ({ id: m.id, label: m.label })), { id: "__custom", label: "Custom model id…" }],
    [curatedModels]
  );

  const [keyDraft, setKeyDraft] = useState("");
  const [passphraseDraft, setPassphraseDraft] = useState("");
  const [unlockDraft, setUnlockDraft] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);

  // "Direction A — inline stepper": the card asks for one thing at a time
  // instead of showing every AI-explanations control at once. `keyStep`
  // tracks which half of setup is showing (1 = provider / model / storage,
  // 2 = the secret itself); `keyManaging` is true only while an
  // already-loaded key is being reconfigured via "Manage", so a completed
  // setup collapses back to a single summary.
  const [keyStep, setKeyStep] = useState<1 | 2>(1);
  const [keyManaging, setKeyManaging] = useState(false);

  const openKeyManager = (step: 1 | 2) => {
    setKeyError(null);
    setKeyStep(step);
    setKeyManaging(true);
  };

  const saveKey = async () => {
    setKeyError(null);
    const key = keyDraft.trim();
    if (!key) { setKeyError("Enter an API key first."); return; }
    setKeyBusy(true);
    try {
      if (state.keyMode === "encrypted") {
        if (!passphraseDraft) { setKeyError("Choose a passphrase to encrypt the key."); return; }
        await saveEncryptedApiKey(key, passphraseDraft);
      } else {
        loadSessionApiKey(key);
      }
      setKeyDraft("");
      setPassphraseDraft("");
      setKeyManaging(false);
      setKeyStep(1);
    } catch {
      setKeyError("Could not save the encrypted key.");
    } finally {
      setKeyBusy(false);
    }
  };

  const unlockKey = async () => {
    setKeyError(null);
    setKeyBusy(true);
    try {
      await unlockSessionKey(unlockDraft);
      setUnlockDraft("");
    } catch {
      setKeyError("Wrong passphrase, or no saved key.");
    } finally {
      setKeyBusy(false);
    }
  };

  // Three mutually-exclusive views: a loaded key collapses to a summary; a
  // saved-but-locked key shows a compact unlock prompt; anything else falls
  // through to the setup stepper. "Manage" / "Use a different key" force the
  // stepper open even when a key is loaded or locked.
  const providerLabel = state.provider === "anthropic" ? "Anthropic" : "OpenAI";
  const storageLabel = state.keyMode === "encrypted" ? "Encrypted in this browser" : "Memory only";
  const keyStatus = aiKeyStatus(state);
  const showKeyDone = keyStatus === "done" && !keyManaging;
  const showKeyLocked = keyStatus === "locked" && !keyManaging;
  const showKeySetup = !showKeyDone && !showKeyLocked;
  const tone = showKeyDone ? "done" : showKeyLocked ? "locked" : "setup";
  const statusTitle = showKeyDone
    ? "Key loaded for this session"
    : showKeyLocked
    ? "Unlock your saved key"
    : keyManaging ? "Change your key setup" : keyStep === 2 ? "Setting up your key" : "Not set up yet";

  const keyErrorBox = keyError && (
    <div className="settings-error-box">
      <span aria-hidden="true">!</span>
      <span>{keyError}</span>
    </div>
  );

  return (
    <div {...sectionAnchor("ai")} className="settings-card settings-card-clip">
      <div className={`settings-ai-status is-${tone}`}>
        <span className="settings-ai-icon" aria-hidden="true">
          {tone === "done" ? "✓" : tone === "locked" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M6 11h12v10H6z M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 3.5a4.5 4.5 0 1 0 3.2 7.7L21 14.5V18h-3v2h-3v-3l-3.3-3.3a4.5 4.5 0 0 0 2.8-10.2z M15.5 7.5h.01" /></svg>
          )}
        </span>
        <div className="settings-ai-heading">
          <h3 className="settings-ai-kicker">AI explanations</h3>
          <p className="settings-ai-title">{statusTitle}</p>
        </div>
        {showKeyDone && <Button color="secondary" size="md" onClick={() => openKeyManager(1)}>Manage</Button>}
      </div>

      {showKeyDone && (
        <dl className="settings-ai-spec">
          <div><dt>Provider</dt><dd>{providerLabel}</dd></div>
          <div><dt>Model</dt><dd>{state.model}</dd></div>
          <div><dt>Key storage</dt><dd>{storageLabel}</dd></div>
        </dl>
      )}

      {showKeyLocked && (
        <div className="settings-ai-body">
          <p className="settings-row-desc">{storageLabel} · {providerLabel}</p>
          <div className="settings-inline">
            <Input
              className="flex-1"
              type="password"
              aria-label="Passphrase"
              placeholder="Passphrase"
              value={unlockDraft}
              onChange={setUnlockDraft}
              isInvalid={!!keyError}
            />
            <Button size="md" isDisabled={keyBusy || !unlockDraft} isLoading={keyBusy} onClick={unlockKey}>Unlock</Button>
          </div>
          {keyErrorBox}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Button color="link-color" size="sm" onClick={() => openKeyManager(2)}>Use a different key</Button>
            <Button color="link-destructive" size="sm" onClick={forgetStoredApiKey}>Forget saved key</Button>
          </div>
        </div>
      )}

      {showKeySetup && (
        <div className="settings-ai-body">
          <div className="settings-steps">
            <span className="settings-step is-on"><StepDot n={1} on />Configure</span>
            <span className={cx("settings-step-line", keyStep >= 2 && "is-on")} />
            <span className={cx("settings-step", keyStep >= 2 && "is-on")}><StepDot n={2} on={keyStep >= 2} />Key</span>
          </div>

          {keyStep === 1 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <p id="settings-ai-provider" className="settings-field-label">Provider</p>
                <div role="group" aria-labelledby="settings-ai-provider" className="settings-seg settings-seg-wide">
                  {([{ id: "anthropic", label: "Anthropic" }, { id: "openai", label: "OpenAI" }] as const).map((o) => (
                    <button key={o.id} type="button" aria-pressed={state.provider === o.id} onClick={() => setProvider(o.id)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Select
                  label="Model"
                  selectedKey={isCustomModel ? "__custom" : state.model}
                  onSelectionChange={(key) => setModel(key === "__custom" ? "" : String(key))}
                  items={modelOptions}
                >
                  {(item) => <Select.Item key={item.id} id={item.id} label={item.label}>{item.label}</Select.Item>}
                </Select>
                {isCustomModel && (
                  <Input
                    aria-label="Exact model id"
                    placeholder="Exact model id"
                    value={state.model}
                    onChange={setModel}
                  />
                )}
              </div>
              <div>
                <p className="settings-field-label">Key storage</p>
                <RadioGroup
                  aria-label="Key storage"
                  size="md"
                  value={state.keyMode}
                  onChange={(value) => setKeyMode(value as KeyMode)}
                  className="flex flex-col gap-2"
                >
                  {([
                    { id: "memory" as const, title: "Memory only (default)", body: "Cleared the moment you refresh or close the tab. Nothing touches disk." },
                    { id: "encrypted" as const, title: "Encrypted in this browser", body: "AES-GCM ciphertext in IndexedDB, unlocked with a passphrase each visit." }
                  ]).map((k) => (
                    <RadioButton
                      key={k.id}
                      value={k.id}
                      size="md"
                      label={k.title}
                      hint={k.body}
                      className={optionCardClass(state.keyMode === k.id)}
                    />
                  ))}
                </RadioGroup>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Button size="md" onClick={() => setKeyStep(2)}>Continue</Button>
                <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Step 1 of 2</span>
                {keyManaging && (
                  <Button color="link-gray" size="md" className="ml-auto" onClick={() => setKeyManaging(false)}>Cancel</Button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <p style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 600 }}>Paste your {providerLabel} key</p>
                <p className="settings-row-desc">Sent to this app's server only, relayed once per request, never stored.</p>
              </div>
              <Input
                type="password"
                label={state.hasSessionKey ? "Replace API key" : "API key"}
                placeholder={state.provider === "anthropic" ? "sk-ant-…" : "sk-…"}
                value={keyDraft}
                onChange={(value) => { setKeyDraft(value); setKeyError(null); }}
                isInvalid={!!keyError}
              />
              {state.keyMode === "encrypted" && (
                <Input
                  type="password"
                  label="Passphrase"
                  placeholder="Choose a passphrase"
                  value={passphraseDraft}
                  onChange={setPassphraseDraft}
                  hint="Encrypted with AES-GCM and stored only in this browser. We can never recover it — lose the passphrase and the saved key is gone."
                />
              )}
              {keyErrorBox}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Button size="md" isDisabled={keyBusy || !keyDraft.trim()} isLoading={keyBusy} onClick={saveKey}>
                  {state.keyMode === "encrypted" ? "Save & encrypt" : "Load key"}
                </Button>
                <Button color="secondary" size="md" onClick={() => setKeyStep(1)}>Back</Button>
                {state.hasSessionKey && (
                  <Button
                    color="link-gray"
                    size="md"
                    className="ml-auto"
                    onClick={() => { clearSessionApiKey(); setKeyManaging(false); setKeyStep(1); }}
                  >
                    Clear loaded key
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="settings-card-note">
        Your key is only ever sent to this app's own server, which relays it to {providerLabel} for a single request and never stores it.
      </p>
    </div>
  );
}
