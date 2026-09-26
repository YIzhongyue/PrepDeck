import { useEffect, useMemo, useRef, useState } from "react";
import {
  CURATED_MODELS, DAILY_EMAIL_MAX_QUESTIONS, DAILY_EMAIL_MIN_QUESTIONS, DAILY_EMAIL_SOURCES,
  MARK_ALIAS_MAX_LENGTH, MARK_STYLES, type DailyEmailSource, type MarkStyle
} from "@prepdeck/shared";
import { HL, THEMES } from "../data/constants";
import { usePrepDeck } from "../store/PrepDeckContext";
import { apiFetch } from "../lib/api";
import { AvatarValidationError, prepareAvatarUpload } from "../lib/avatar";
import ProfileAvatar from "../components/ProfileAvatar";
import McpTokensCard from "../components/McpTokensCard";
import type { Breakpoints } from "../lib/responsive";
import type { KeyMode } from "../types";
import { DEFAULT_THEME } from "../lib/themeStorage";
// implementation — shared Untitled UI primitives. docs/guides/ui-components.md
// covers the token mapping and which screens are still to be migrated.
import { Button } from "@/components/base/buttons/button";
import { Input, InputBase, TextField } from "@/components/base/input/input";
import { Label } from "@/components/base/input/label";
import { RadioButton, RadioGroup } from "@/components/base/radio-buttons/radio-buttons";
import { Select } from "@/components/base/select/select";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";

// Untitled UI's TextField stacks a 20px label and a 6px gap above the control,
// so a button that has to line up with the input itself clears both.
const ALIGN_WITH_INPUT = { marginTop: 26 } as const;

// The card that wraps a radio option, in the same accent-100 / neutral-100 pair
// this screen used before the migration — reached here through Untitled UI's
// semantic names, so it follows the active color scheme like everything else.
function optionCardClass(selected: boolean) {
  return cx(
    "rounded-[20px] px-[15px] py-[13px] ring-[1.5px] ring-inset",
    selected ? "bg-brand-primary ring-brand" : "bg-tertiary ring-primary"
  );
}

function segBg(on: boolean) { return on ? "var(--color-accent)" : "transparent"; }
function segFg(on: boolean) { return on ? "var(--color-bg)" : "var(--color-text)"; }
function segBd(on: boolean) { return on ? "var(--color-accent)" : "var(--color-divider)"; }

export default function Settings({ bp }: { bp: Breakpoints }) {
  const {
    state, setTheme, setProvider, setModel, setKeyMode, loadSessionApiKey, clearSessionApiKey,
    saveEncryptedApiKey, unlockSessionKey, forgetStoredApiKey,
    toggleShared, updateDisplayName, uploadAvatar, updateMarkAlias, updateEmailSettings
  } = usePrepDeck();
  const theme = state.theme || DEFAULT_THEME;
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
  // setup collapses back to a single summary row.
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

  const forgetStoredKey = () => { forgetStoredApiKey(); };

  // FR-12.2: a controlled draft so the input can be edited before saving,
  // re-synced whenever the server-confirmed name changes underneath it.
  const [nameDraft, setNameDraft] = useState(state.me?.displayName ?? "");
  useEffect(() => { setNameDraft(state.me?.displayName ?? ""); }, [state.me?.displayName]);
  const nameDirty = nameDraft.trim() !== "" && nameDraft.trim() !== (state.me?.displayName ?? "");
  // updateDisplayName() already refuses a blank name; this only surfaces why.
  const nameEmpty = nameDraft.trim() === "";

  // implementation: same controlled-draft pattern as nameDraft above, re-synced
  // whenever the server-confirmed aliases change underneath it.
  const [aliasDrafts, setAliasDrafts] = useState<Record<MarkStyle, string>>(state.markAliases);
  useEffect(() => { setAliasDrafts(state.markAliases); }, [state.markAliases]);

  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onAvatarChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-choosing the same file later
    if (!file) return;
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const blob = await prepareAvatarUpload(file);
      uploadAvatar(blob);
    } catch (err) {
      setAvatarError(err instanceof AvatarValidationError ? err.message : "Could not upload this image.");
    } finally {
      setAvatarBusy(false);
    }
  };

  // implementation — the daily review email settings section reads/writes
  // state.emailSettings directly (no controlled-draft state): every control
  // here is a discrete picker (toggle/pills/radio/select), same pattern as
  // the AI-provider pills and shared-notes toggle above, which apply on
  // change with no separate Save step.
  const emailSettings = state.emailSettings;
  const timezoneOptions = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [Intl.DateTimeFormat().resolvedOptions().timeZone];
    }
  }, []);
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const deliveryHourOptions = useMemo(
    () => Array.from({ length: 24 }, (_, h) => ({
      id: String(h),
      label: new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    })),
    []
  );
  // A zone the server already stores but this browser does not list still has
  // to be selectable, exactly as the native <select> kept it as an option.
  const timezoneSelectOptions = useMemo(() => {
    const current = emailSettings?.timezone;
    const names = current && !timezoneOptions.includes(current) ? [current, ...timezoneOptions] : timezoneOptions;
    return names.map((tz) => ({ id: tz, label: tz }));
  }, [emailSettings?.timezone, timezoneOptions]);
  const SOURCE_LABELS: Record<DailyEmailSource, { title: string; body: string }> = {
    wrong: { title: "Wrong book", body: "Questions you've previously answered incorrectly." },
    bm: { title: "Bookmarks", body: "Questions you've saved for later." },
    new: { title: "Unattempted", body: "Questions you haven't tried yet." }
  };

  // Three mutually-exclusive views for the AI explanations card: a key
  // already loaded this session collapses to a one-line summary; a key
  // that's saved-but-locked (encrypted storage, browser refreshed) shows a
  // compact unlock prompt; anything else falls through to the setup
  // stepper. "Manage" / "Use a different key" force the stepper open even
  // when a key is loaded or locked.
  const providerLabel = state.provider === "anthropic" ? "Anthropic" : "OpenAI";
  const storageLabel = state.keyMode === "encrypted" ? "Encrypted in this browser" : "Memory only";
  const keyStatus: "done" | "locked" | "empty" = state.hasSessionKey
    ? "done"
    : state.keyMode === "encrypted" && state.hasStoredKey ? "locked" : "empty";
  const showKeyDoneRow = keyStatus === "done" && !keyManaging;
  const showKeyLockedCard = keyStatus === "locked" && !keyManaging;
  const showKeySetup = !showKeyDoneRow && !showKeyLockedCard;
  const keyPill = keyStatus === "done"
    ? { text: "key loaded · this session", bg: "var(--color-accent-2-100)", fg: "var(--color-accent-2-800)", dot: "var(--color-accent-2-600)" }
    : keyStatus === "locked"
    ? { text: "locked", bg: "var(--color-accent-100)", fg: "var(--color-accent-800)", dot: "var(--color-accent-600)" }
    : showKeySetup && keyStep === 2
    ? { text: "setting up", bg: "var(--color-accent-100)", fg: "var(--color-accent-800)", dot: "var(--color-accent-600)" }
    : { text: "not set up", bg: "var(--color-neutral-200)", fg: "var(--color-neutral-800)", dot: "var(--color-neutral-500)" };
  const keyErrorBox = keyError && (
    <div style={{ display: "flex", gap: 10, padding: "9px 13px", borderRadius: 16, background: "var(--color-danger-bg)", border: "1px solid var(--color-danger-border)" }}>
      <span style={{ color: "var(--color-danger)", fontSize: 13 }}>!</span>
      <span style={{ fontSize: 12.5, color: "var(--color-danger-text)" }}>{keyError}</span>
    </div>
  );

  return (
    <div style={{ maxWidth: 720, animation: "pd-rise .28s ease backwards" }}>
      <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>Account</p>
      <h1 style={{ margin: "0 0 22px", fontSize: 34 }}>Settings</h1>

      <div className="card elev-sm" style={{ padding: 22, gap: 16, marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 20 }}>Profile</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <ProfileAvatar profile={state.me} size={64} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <Input
                className="flex-1"
                label="Display name"
                value={nameDraft}
                onChange={setNameDraft}
                isInvalid={nameEmpty}
                hint={nameEmpty ? "Enter a display name to save it." : undefined}
              />
              {nameDirty && (
                <div style={ALIGN_WITH_INPUT}>
                  <Button size="md" onClick={() => updateDisplayName(nameDraft)}>Save</Button>
                </div>
              )}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--color-text-muted)" }}>From Google until you change it · {state.me?.email}</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatarChosen} style={{ display: "none" }} />
            <Button color="secondary" size="md" isDisabled={avatarBusy} isLoading={avatarBusy} showTextWhileLoading onClick={() => fileInputRef.current?.click()}>
              {avatarBusy ? "Uploading…" : "Upload avatar"}
            </Button>
            {avatarError && <p role="alert" style={{ margin: 0, fontSize: 11.5, color: "var(--color-danger)", maxWidth: 180, textAlign: "right" }}>{avatarError}</p>}
          </div>
        </div>
        <Button
          color="secondary"
          size="md"
          className="self-start"
          onClick={() =>
            apiFetch("/api/auth/logout", { method: "POST" }).finally(() => {
              window.location.href = "/?auth=signedout";
            })
          }
        >
          Sign out
        </Button>
      </div>

      <div className="card elev-sm" style={{ padding: 22, gap: 16, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: "0 0 4px", fontSize: 20 }}>Appearance</h3>
          <p style={{ margin: 0, fontSize: 12.5, opacity: 0.7 }}>Choose a color scheme. Your preference is saved in this browser and applies everywhere instantly.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: bp.phone ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(128px, 1fr))", gap: 10 }}>
          {THEMES.map((t) => {
            const on = theme === t.id;
            return (
              <button
                key={t.id} type="button" onClick={() => setTheme(t.id)}
                style={{
                  display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 22, cursor: "pointer",
                  textAlign: "left", font: "inherit", color: "var(--color-text)",
                  background: on ? "var(--color-accent-100)" : "var(--color-neutral-100)",
                  border: `2px solid ${on ? "var(--color-accent)" : "transparent"}`
                }}
              >
                <span style={{ display: "flex", alignItems: "center", height: 46, borderRadius: 14, padding: "0 12px", gap: 7, background: t.bg }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: t.accent }} />
                  <span style={{ width: 14, height: 14, borderRadius: "50%", background: t.accent2 }} />
                  <span style={{ flex: 1, height: 6, borderRadius: 999, background: t.line }} />
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.name}</span>
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{t.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card elev-sm" style={{ padding: 22, gap: 16, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: "0 0 4px", fontSize: 20 }}>Mark aliases</h3>
          <p style={{ margin: 0, fontSize: 12.5, opacity: 0.7 }}>
            Name what each highlight color means to you. The name follows you everywhere; the color follows your chosen theme above.
          </p>
        </div>
        {MARK_STYLES.map((style, i) => {
          const draft = aliasDrafts[style];
          const current = state.markAliases[style];
          const dirty = draft.trim() !== "" && draft.trim() !== current;
          return (
            // Composed from TextField/Label/InputBase rather than <Input label>,
            // whose label prop takes a plain string: the swatch has to sit
            // inside the label so it stays part of the field's own heading.
            <TextField
              key={style}
              value={draft}
              onChange={(value) => setAliasDrafts((d) => ({ ...d, [style]: value }))}
            >
              <Label>
                <span
                  aria-hidden="true"
                  style={{ width: 16, height: 16, marginRight: 4, borderRadius: 4, background: HL[style]?.background, border: "1px solid var(--color-divider)" }}
                />
                {["First mark", "Second mark", "Third mark"][i]}
              </Label>
              {/* TextField lays its children out with `items-start`, so this row
                  has to claim the width itself. */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%" }}>
                <InputBase maxLength={MARK_ALIAS_MAX_LENGTH} />
                {dirty && <Button size="md" onClick={() => updateMarkAlias(style, draft)}>Save</Button>}
              </div>
            </TextField>
          );
        })}
      </div>

      <div className="card elev-sm" style={{ padding: 22, gap: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 20, marginRight: "auto" }}>AI explanations</h3>
          <span className="tag" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: keyPill.bg, color: keyPill.fg, fontSize: 10.5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: keyPill.dot }} />
            {keyPill.text}
          </span>
        </div>

        {showKeyDoneRow && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 16px", borderRadius: 24, background: "var(--color-accent-2-100)", border: "1.5px solid var(--color-accent-2-300)" }}>
            <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, flex: "none", borderRadius: "50%", background: "var(--color-accent-2-600)", color: "#fff", fontSize: 15 }}>✓</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>Key loaded for this session</span>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--color-accent-2-800)", marginTop: 2 }}>{providerLabel} · {state.model} · {storageLabel}</span>
            </span>
            <Button color="secondary" size="md" onClick={() => openKeyManager(1)}>Manage</Button>
          </div>
        )}

        {showKeyLockedCard && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "15px 16px", borderRadius: 20, background: "var(--color-accent-100)" }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Unlock your saved key</p>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-accent-800)" }}>{storageLabel} · {providerLabel}</p>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
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
            <div style={{ display: "flex", gap: 14 }}>
              <Button color="link-color" size="sm" onClick={() => openKeyManager(2)}>Use a different key</Button>
              <Button color="link-destructive" size="sm" onClick={forgetStoredKey}>Forget saved key</Button>
            </div>
          </div>
        )}

        {showKeySetup && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>
                <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: "50%", fontSize: 11, background: "var(--color-accent)", color: "#fff" }}>1</span>
                Configure
              </span>
              <span style={{ flex: 1, height: 2, borderRadius: 2, background: keyStep >= 2 ? "var(--color-accent)" : "var(--color-neutral-300)" }} />
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: keyStep >= 2 ? "var(--color-text)" : "var(--color-text-muted)" }}>
                <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: "50%", fontSize: 11, background: keyStep >= 2 ? "var(--color-accent)" : "var(--color-neutral-200)", color: keyStep >= 2 ? "#fff" : "var(--color-text-muted)" }}>2</span>
                Key
              </span>
            </div>

            {keyStep === 1 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <span style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 8 }}>Provider</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {([{ id: "anthropic", label: "Anthropic" }, { id: "openai", label: "OpenAI" }] as const).map((o) => {
                      const on = state.provider === o.id;
                      return (
                        <button
                          key={o.id} type="button" onClick={() => setProvider(o.id)}
                          style={{ display: "inline-flex", alignItems: "center", padding: "7px 17px", borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 13, whiteSpace: "nowrap", background: segBg(on), color: segFg(on), border: `1.5px solid ${segBd(on)}` }}
                        >
                          {o.label}
                        </button>
                      );
                    })}
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
                  <span style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 8 }}>Key storage</span>
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
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-neutral-700)" }}>Sent to this app's server only, relayed once per request, never stored.</p>
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

        <p style={{ margin: 0, fontSize: 11.5, color: "var(--color-text-muted)" }}>
          Your key is only ever sent to this app's own server, which relays it to {providerLabel} for a single request and never stores it.
        </p>
      </div>

      <McpTokensCard
        title="MCP access"
        description="Personal access tokens for connecting AI clients (Claude, ChatGPT, etc.) to your PrepDeck study data over MCP. Each token acts as you and can be revoked at any time."
        apiBase="/api/mcp-tokens"
        enableSetupPrompt
        namePlaceholder="e.g. claude-desktop"
      />

      <div className="card elev-sm" style={{ padding: 22, gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 20 }}>Notes &amp; privacy</h3>
        {/* flex-row-reverse keeps the switch on the trailing edge while the whole
            row stays one <label>, so the text still toggles it. */}
        <Toggle
          size="md"
          className="w-full flex-row-reverse items-center justify-between"
          label="Show other users' shared notes"
          hint="Your own notes always show, private or shared."
          isSelected={state.showShared}
          onChange={toggleShared}
        />
      </div>

      <div className="card elev-sm" style={{ padding: 22, gap: 16, marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontSize: 20, fontFamily: "var(--font-heading)", fontWeight: "var(--font-heading-weight)" }}>Daily review email</span>
            <span style={{ display: "block", fontSize: 12.5, opacity: 0.7, marginTop: 4 }}>Off by default. Sends a few practice questions to your inbox — no answers included.</span>
          </span>
          <Toggle
            size="md"
            aria-label="Daily review email"
            isSelected={!!emailSettings?.enabled}
            onChange={(enabling) => {
              // First time this is turned on with the server's untouched
              // "UTC" default, switch to the browser's own zone instead of
              // silently scheduling delivery against UTC.
              const timezone = enabling && emailSettings?.timezone === "UTC" ? browserTimezone : undefined;
              updateEmailSettings({ enabled: enabling, ...(timezone ? { timezone } : {}) });
            }}
          />
        </div>

        {emailSettings?.enabled && (
          <>
            <div>
              <span style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 8 }}>Questions per email</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Array.from({ length: DAILY_EMAIL_MAX_QUESTIONS - DAILY_EMAIL_MIN_QUESTIONS + 1 }, (_, i) => DAILY_EMAIL_MIN_QUESTIONS + i).map((n) => {
                  const on = emailSettings.questionsPerEmail === n;
                  return (
                    <button
                      key={n} type="button" onClick={() => updateEmailSettings({ questionsPerEmail: n })}
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 13, background: segBg(on), color: segFg(on), border: `1.5px solid ${segBd(on)}` }}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <span style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 8 }}>Question source</span>
              <RadioGroup
                aria-label="Question source"
                size="md"
                value={emailSettings.source}
                onChange={(value) => updateEmailSettings({ source: value as DailyEmailSource })}
                className="flex flex-col gap-2"
              >
                {DAILY_EMAIL_SOURCES.map((source) => (
                  <RadioButton
                    key={source}
                    value={source}
                    size="md"
                    label={SOURCE_LABELS[source].title}
                    hint={SOURCE_LABELS[source].body}
                    className={optionCardClass(emailSettings.source === source)}
                  />
                ))}
              </RadioGroup>
            </div>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <Select
                  label="Delivery time"
                  selectedKey={String(emailSettings.sendHourLocal)}
                  onSelectionChange={(key) => updateEmailSettings({ sendHourLocal: Number(key) })}
                  items={deliveryHourOptions}
                >
                  {(item) => <Select.Item key={item.id} id={item.id} label={item.label}>{item.label}</Select.Item>}
                </Select>
              </div>
              <div style={{ flex: 2, minWidth: 220 }}>
                {/* A combo box rather than a plain select: the zone list runs to
                    several hundred entries, which the native control made
                    searchable by type-ahead. */}
                <Select.ComboBox
                  label="Timezone"
                  selectedKey={emailSettings.timezone}
                  onSelectionChange={(key) => key !== null && updateEmailSettings({ timezone: String(key) })}
                  items={timezoneSelectOptions}
                >
                  {(item) => <Select.Item key={item.id} id={item.id} label={item.label}>{item.label}</Select.Item>}
                </Select.ComboBox>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
