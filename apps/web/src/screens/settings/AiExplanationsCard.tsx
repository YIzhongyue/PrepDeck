import { useMemo, useState } from "react";
import { CURATED_MODELS } from "@prepdeck/shared";
import { useAccountActions, useAccountState, type AccountState } from "../../store/PrepDeckContext";
import type { KeyMode } from "../../types";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RadioButton, RadioGroup } from "@/components/base/radio-buttons/radio-buttons";
import { Select } from "@/components/base/select/select";
import { cx } from "@/utils/cx";
import { sectionAnchor } from "./SettingsNav";
import { useI18n } from "../../i18n";

// A key already loaded this session is "done"; one saved but still encrypted
// (encrypted storage, browser refreshed) is "locked"; anything else needs setup.
export type AiKeyStatus = "done" | "locked" | "empty";

export function aiKeyStatus(state: Pick<AccountState, "hasSessionKey" | "hasStoredKey" | "keyMode">): AiKeyStatus {
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
  const state = useAccountState();
  const {
    setProvider, setModel, setKeyMode, loadSessionApiKey, clearSessionApiKey,
    saveEncryptedApiKey, unlockSessionKey, forgetStoredApiKey
  } = useAccountActions();
  const { t } = useI18n();

  const curatedModels = CURATED_MODELS[state.provider];
  const isCustomModel = !curatedModels.some((m) => m.id === state.model);
  const modelOptions = useMemo(
    () => [...curatedModels.map((m) => ({ id: m.id, label: m.label })), { id: "__custom", label: t("settings.ai.customModel") }],
    [curatedModels, t]
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
    if (!key) { setKeyError(t("settings.ai.errors.noKey")); return; }
    setKeyBusy(true);
    try {
      if (state.keyMode === "encrypted") {
        if (!passphraseDraft) { setKeyError(t("settings.ai.errors.noPassphrase")); return; }
        await saveEncryptedApiKey(key, passphraseDraft);
      } else {
        loadSessionApiKey(key);
      }
      setKeyDraft("");
      setPassphraseDraft("");
      setKeyManaging(false);
      setKeyStep(1);
    } catch {
      setKeyError(t("settings.ai.errors.saveFailed"));
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
      setKeyError(t("settings.ai.errors.unlockFailed"));
    } finally {
      setKeyBusy(false);
    }
  };

  // Three mutually-exclusive views: a loaded key collapses to a summary; a
  // saved-but-locked key shows a compact unlock prompt; anything else falls
  // through to the setup stepper. "Manage" / "Use a different key" force the
  // stepper open even when a key is loaded or locked.
  const providerLabel = state.provider === "anthropic" ? "Anthropic" : "OpenAI";
  const storageLabel = t(state.keyMode === "encrypted" ? "settings.ai.storage.encrypted" : "settings.ai.storage.memoryShort");
  const keyStatus = aiKeyStatus(state);
  const showKeyDone = keyStatus === "done" && !keyManaging;
  const showKeyLocked = keyStatus === "locked" && !keyManaging;
  const showKeySetup = !showKeyDone && !showKeyLocked;
  const tone = showKeyDone ? "done" : showKeyLocked ? "locked" : "setup";
  const statusTitle = t(showKeyDone
    ? "settings.ai.status.loaded"
    : showKeyLocked
    ? "settings.ai.status.locked"
    : keyManaging ? "settings.ai.status.changing" : keyStep === 2 ? "settings.ai.status.settingUp" : "settings.ai.status.notSetUp");

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
          <h3 className="settings-ai-kicker">{t("settings.nav.ai")}</h3>
          <p className="settings-ai-title">{statusTitle}</p>
        </div>
        {showKeyDone && <Button color="secondary" size="md" onClick={() => openKeyManager(1)}>{t("settings.ai.manage")}</Button>}
      </div>

      {showKeyDone && (
        <dl className="settings-ai-spec">
          <div><dt>{t("settings.ai.provider")}</dt><dd>{providerLabel}</dd></div>
          <div><dt>{t("settings.ai.model")}</dt><dd>{state.model}</dd></div>
          <div><dt>{t("settings.ai.keyStorage")}</dt><dd>{storageLabel}</dd></div>
        </dl>
      )}

      {showKeyLocked && (
        <div className="settings-ai-body">
          <p className="settings-row-desc">{storageLabel} · {providerLabel}</p>
          <div className="settings-inline">
            <Input
              className="flex-1"
              type="password"
              aria-label={t("settings.ai.passphrase")}
              placeholder={t("settings.ai.passphrase")}
              value={unlockDraft}
              onChange={setUnlockDraft}
              isInvalid={!!keyError}
            />
            <Button size="md" isDisabled={keyBusy || !unlockDraft} isLoading={keyBusy} onClick={unlockKey}>{t("settings.ai.unlock")}</Button>
          </div>
          {keyErrorBox}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Button color="link-color" size="sm" onClick={() => openKeyManager(2)}>{t("settings.ai.useDifferentKey")}</Button>
            <Button color="link-destructive" size="sm" onClick={forgetStoredApiKey}>{t("settings.ai.forgetKey")}</Button>
          </div>
        </div>
      )}

      {showKeySetup && (
        <div className="settings-ai-body">
          <div className="settings-steps">
            <span className="settings-step is-on"><StepDot n={1} on />{t("settings.ai.stepConfigure")}</span>
            <span className={cx("settings-step-line", keyStep >= 2 && "is-on")} />
            <span className={cx("settings-step", keyStep >= 2 && "is-on")}><StepDot n={2} on={keyStep >= 2} />{t("settings.ai.stepKey")}</span>
          </div>

          {keyStep === 1 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <p id="settings-ai-provider" className="settings-field-label">{t("settings.ai.provider")}</p>
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
                  label={t("settings.ai.model")}
                  selectedKey={isCustomModel ? "__custom" : state.model}
                  onSelectionChange={(key) => setModel(key === "__custom" ? "" : String(key))}
                  items={modelOptions}
                >
                  {(item) => <Select.Item key={item.id} id={item.id} label={item.label}>{item.label}</Select.Item>}
                </Select>
                {isCustomModel && (
                  <Input
                    aria-label={t("settings.ai.exactModel")}
                    placeholder={t("settings.ai.exactModel")}
                    value={state.model}
                    onChange={setModel}
                  />
                )}
              </div>
              <div>
                <p className="settings-field-label">{t("settings.ai.keyStorage")}</p>
                <RadioGroup
                  aria-label={t("settings.ai.keyStorage")}
                  size="md"
                  value={state.keyMode}
                  onChange={(value) => setKeyMode(value as KeyMode)}
                  className="flex flex-col gap-2"
                >
                  {([
                    { id: "memory" as const, title: t("settings.ai.storage.memory"), body: t("settings.ai.storage.memoryBody") },
                    { id: "encrypted" as const, title: t("settings.ai.storage.encrypted"), body: t("settings.ai.storage.encryptedBody") }
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
                <Button size="md" onClick={() => setKeyStep(2)}>{t("settings.ai.continue")}</Button>
                <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{t("settings.ai.stepOf", { step: 1, total: 2 })}</span>
                {keyManaging && (
                  <Button color="link-gray" size="md" className="ml-auto" onClick={() => setKeyManaging(false)}>{t("common.cancel")}</Button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <p style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 600 }}>{t("settings.ai.pasteKey", { provider: providerLabel })}</p>
                <p className="settings-row-desc">{t("settings.ai.pasteKeyDesc")}</p>
              </div>
              <Input
                type="password"
                label={t(state.hasSessionKey ? "settings.ai.replaceKey" : "settings.ai.apiKey")}
                placeholder={state.provider === "anthropic" ? "sk-ant-…" : "sk-…"}
                value={keyDraft}
                onChange={(value) => { setKeyDraft(value); setKeyError(null); }}
                isInvalid={!!keyError}
              />
              {state.keyMode === "encrypted" && (
                <Input
                  type="password"
                  label={t("settings.ai.passphrase")}
                  placeholder={t("settings.ai.choosePassphrase")}
                  value={passphraseDraft}
                  onChange={setPassphraseDraft}
                  hint={t("settings.ai.passphraseHint")}
                />
              )}
              {keyErrorBox}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Button size="md" isDisabled={keyBusy || !keyDraft.trim()} isLoading={keyBusy} onClick={saveKey}>
                  {t(state.keyMode === "encrypted" ? "settings.ai.saveEncrypt" : "settings.ai.loadKey")}
                </Button>
                <Button color="secondary" size="md" onClick={() => setKeyStep(1)}>{t("common.back")}</Button>
                {state.hasSessionKey && (
                  <Button
                    color="link-gray"
                    size="md"
                    className="ml-auto"
                    onClick={() => { clearSessionApiKey(); setKeyManaging(false); setKeyStep(1); }}
                  >
                    {t("settings.ai.clearKey")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="settings-card-note">
        {t("settings.ai.note", { provider: providerLabel })}
      </p>
    </div>
  );
}
