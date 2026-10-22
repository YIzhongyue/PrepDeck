import { useEffect, useMemo, useRef, useState } from "react";
import { MARK_ALIAS_MAX_LENGTH, MARK_STYLES, type MarkStyle } from "@prepdeck/shared";
import { HL, THEMES } from "../data/constants";
import { useAccountActions, useAccountState, useNotesActions, useNotesState, useWorkspaceState } from "../store/PrepDeckContext";
import { ApiError, isSessionExpired } from "../lib/api";
import { AvatarValidationError, prepareAvatarUpload } from "../lib/avatar";
import ProfileAvatar from "../components/ProfileAvatar";
import McpTokensCard from "../components/McpTokensCard";
import McpConnectionsCard from "../components/McpConnectionsCard";
import { contentInset, type Breakpoints } from "../lib/responsive";
import { DEFAULT_THEME } from "../lib/themeStorage";
// implementation — shared Untitled UI primitives. docs/guides/ui-components.md
// covers the token mapping and which screens are still to be migrated.
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input, InputBase, TextField } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";
import AiExplanationsCard, { aiKeyStatus } from "./settings/AiExplanationsCard";
import DailyEmailCard from "./settings/DailyEmailCard";
import { SettingsChips, SettingsToc, sectionAnchor, takeRequestedSettingsSection, useSectionNavigation, type SectionId, type SectionMeta } from "./settings/SettingsNav";
import { useNow, zoneClock } from "./settings/zoneClock";
import "./settings/settings.css";
import { t as translate, useI18n } from "../i18n";
import LanguageSelect from "../components/LanguageSelect";

// The server's own message for a refused profile change (a 400 or the 413
// "Avatar must be 2 MB or smaller"). A lost session has its own dialog, so it
// needs no message here.
function profileErrorMessage(err: unknown, fallback: string): string | null {
  if (isSessionExpired(err)) return null;
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
}


// A row's title, description and control, side by side on a wide card and
// stacked once the card is too narrow for both.
function Row({ id, title, desc, children, inline = false, anchor }: {
  id: string;
  title: string;
  desc: string;
  children: React.ReactNode;
  inline?: boolean;
  anchor?: SectionId;
}) {
  return (
    <div {...(anchor ? sectionAnchor(anchor) : {})} className={cx("settings-row", inline && "settings-row-inline")}>
      <div className={cx("settings-row-text", inline && "settings-row-text-grow")}>
        <h3 id={`${id}-title`} className="settings-row-title">{title}</h3>
        <p id={`${id}-desc`} className="settings-row-desc">{desc}</p>
      </div>
      {inline ? children : <div className="settings-row-control">{children}</div>}
    </div>
  );
}

export default function Settings({ bp }: { bp: Breakpoints }) {
  const { markAliases, showShared } = useNotesState();
  const state = { ...useAccountState(), me: useWorkspaceState().me, markAliases, showShared };

  const { setTheme, signOut, updateTimeZone, updateDisplayName, uploadAvatar } = useAccountActions();
  const { toggleShared, updateMarkAlias } = useNotesActions();
  const { t, rich } = useI18n();

  const theme = state.theme || DEFAULT_THEME;
  const [removeSavedKey, setRemoveSavedKey] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // FR-12.2: a controlled draft so the input can be edited before saving,
  // re-synced whenever the server-confirmed name changes underneath it.
  const [nameDraft, setNameDraft] = useState(state.me?.displayName ?? "");
  useEffect(() => { setNameDraft(state.me?.displayName ?? ""); }, [state.me?.displayName]);
  const nameDirty = nameDraft.trim() !== "" && nameDraft.trim() !== (state.me?.displayName ?? "");
  // updateDisplayName() already refuses a blank name; this only surfaces why.
  const nameEmpty = nameDraft.trim() === "";
  // A save the server refused, shown instead of silently keeping the old name (issue #52).
  const [nameError, setNameError] = useState<string | null>(null);
  const saveName = () => {
    setNameError(null);
    updateDisplayName(nameDraft).catch((err) => setNameError(profileErrorMessage(err, translate("settings.profile.nameSaveFailed"))));
  };

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
      await uploadAvatar(blob);
    } catch (err) {
      setAvatarError(err instanceof AvatarValidationError ? err.message : profileErrorMessage(err, translate("settings.profile.avatarUploadFailed")));
    } finally {
      setAvatarBusy(false);
    }
  };

  const timezoneOptions = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [Intl.DateTimeFormat().resolvedOptions().timeZone];
    }
  }, []);
  const [timeZoneError, setTimeZoneError] = useState<string | null>(null);
  const changeTimeZone = (timeZone: string) => {
    setTimeZoneError(null);
    updateTimeZone(timeZone).catch(() => setTimeZoneError(translate("settings.timezone.saveFailed")));
  };
  // A zone the server already stores but this browser does not list still has
  // to be selectable, exactly as the native <select> kept it as an option.
  const timezoneSelectOptions = useMemo(() => {
    const current = state.timeZone;
    const names = current && !timezoneOptions.includes(current) ? [current, ...timezoneOptions] : timezoneOptions;
    return names.map((tz) => ({ id: tz, label: tz }));
  }, [state.timeZone, timezoneOptions]);
  const now = useNow();
  const clock = state.timeZone ? zoneClock(state.timeZone, now) : null;

  const [activeTokens, setActiveTokens] = useState(0);
  const chipBarRef = useRef<HTMLElement | null>(null);
  const { active, jump } = useSectionNavigation(chipBarRef);
  // Arriving from a link to one section (an explanation panel's "Add a key"),
  // open there rather than at the top.
  useEffect(() => {
    const requested = takeRequestedSettingsSection();
    if (requested) jump(requested);
  }, [jump]);
  const keyStatus = aiKeyStatus(state);
  const on = "var(--color-accent-2-600)";
  const off = "var(--color-neutral-400)";
  const navMeta: Partial<Record<SectionId, SectionMeta>> = {
    ...(state.emailSettings && { email: state.emailSettings.enabled ? { text: t("common.on"), dot: on } : { text: t("common.off"), dot: off } }),
    ai: keyStatus === "done" ? { text: t("settings.nav.aiReady"), dot: on } : keyStatus === "locked" ? { text: t("settings.nav.aiLocked"), dot: "var(--color-accent-600)" } : { text: t("settings.nav.aiNotSet"), dot: off },
    ...(activeTokens > 0 && { mcp: { text: String(activeTokens), dot: "var(--color-accent-600)" } })
  };
  const navProps = { active, meta: navMeta, onJump: jump };

  const me = state.me;
  const roleLabel = t(me?.role === "admin" ? "common.roles.admin" : "common.roles.user");

  return (
    <div className={cx("pd-settings", bp.narrow && "is-narrow")}>
      {bp.narrow && <SettingsChips {...navProps} barRef={chipBarRef} inset={contentInset(bp)} />}

      <div className="settings-layout">
        {!bp.narrow && <SettingsToc {...navProps} />}

        <div className="settings-main">
          {/* The top bar names the screen on narrow layouts; the heading stays
              for assistive technology. */}
          <header className={bp.narrow ? "sr-only" : "settings-header"}>
            <p className="settings-kicker">{t("settings.groups.account")}</p>
            <h1>{t("nav.screens.settings")}</h1>
          </header>

          <section aria-label={t("settings.groups.account")} className="settings-section">
            <div {...sectionAnchor("profile")} className="settings-hero">
              <span className="settings-hero-orb" aria-hidden="true" />
              <span className="settings-hero-orb settings-hero-orb-2" aria-hidden="true" />
              <span className="settings-hero-avatar"><ProfileAvatar profile={me} size={88} /></span>
              <div className="settings-hero-id">
                <h2>{me?.displayName || me?.email || t("settings.profile.yourProfile")}</h2>
                <div className="settings-hero-meta">
                  <span className="settings-hero-email">{me?.email}</span>
                  <span className="settings-hero-pill">{roleLabel}</span>
                  <span className="settings-hero-pill settings-hero-pill-google">{t("settings.profile.signedInWithGoogle")}</span>
                </div>
              </div>
              <div className="settings-hero-actions">
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatarChosen} style={{ display: "none" }} />
                <Button color="secondary" size="md" className="settings-hero-button" isDisabled={avatarBusy} isLoading={avatarBusy} showTextWhileLoading onClick={() => fileInputRef.current?.click()}>
                  {avatarBusy ? t("settings.profile.uploading") : t("settings.profile.uploadAvatar")}
                </Button>
                {avatarError && <p role="alert" className="settings-hero-error">{avatarError}</p>}
              </div>
            </div>

            <div className="settings-card">
              <Row id="settings-name" title={t("settings.profile.displayName")} desc={t("settings.profile.displayNameDesc")}>
                <div className="settings-inline">
                  <Input
                    className="flex-1 settings-field"
                    aria-labelledby="settings-name-title"
                    value={nameDraft}
                    onChange={(v) => { setNameDraft(v); setNameError(null); }}
                    isInvalid={nameEmpty || !!nameError}
                    hint={nameEmpty ? t("settings.profile.displayNameEmpty") : nameError ?? undefined}
                  />
                  {nameDirty && <Button size="md" onClick={saveName}>{t("common.save")}</Button>}
                </div>
              </Row>
              {/* Issue #46: signing out ends every session of the account, and a
                  saved AI key can go with it on a shared browser. */}
              <Row
                id="settings-signout" anchor="session" title={t("settings.session.title")}
                desc={t("settings.session.desc")}
              >
                <div className="settings-row-stack">
                  {state.hasStoredKey && (
                    <Checkbox label={t("settings.session.removeKey")} isSelected={removeSavedKey} onChange={setRemoveSavedKey} />
                  )}
                  <Button
                    color="secondary-destructive"
                    size="md"
                    isDisabled={signingOut}
                    onClick={() => { setSigningOut(true); void signOut({ removeSavedKey: state.hasStoredKey && removeSavedKey }); }}
                  >
                    {t("settings.session.signOut")}
                  </Button>
                </div>
              </Row>
            </div>
          </section>

          <section aria-labelledby="settings-study-heading" className="settings-section">
            <div className="settings-section-head">
              <h2 id="settings-study-heading">{t("settings.groups.study")}</h2>
              <p>{t("settings.groups.studyDesc")}</p>
            </div>

            <div {...sectionAnchor("appearance")} className="settings-panel">
              <div className="settings-panel-text">
                <h3 className="settings-row-title">{t("settings.appearance.title")}</h3>
                <p className="settings-row-desc">{t("settings.appearance.desc")}</p>
              </div>
              <div className="settings-themes">
                {THEMES.map((t) => {
                  const selected = theme === t.id;
                  return (
                    <button key={t.id} type="button" aria-pressed={selected} className="settings-theme" onClick={() => setTheme(t.id)}>
                      {/* A miniature page in the scheme's own colours: sidebar, heading, card. */}
                      <span className="settings-theme-preview" aria-hidden="true" style={{ background: t.bg }}>
                        <span className="settings-theme-rail" style={{ borderColor: t.line }}>
                          <span style={{ background: t.accent }} /><span style={{ background: t.line }} /><span style={{ background: t.line }} />
                        </span>
                        <span className="settings-theme-page">
                          <span className="settings-theme-title" style={{ background: t.ink }} />
                          <span className="settings-theme-card" style={{ background: t.surface }}>
                            <span style={{ width: 12, height: 12, background: t.accent }} />
                            <span style={{ width: 8, height: 8, background: t.accent2 }} />
                            <span className="settings-theme-line" style={{ background: t.line }} />
                          </span>
                        </span>
                      </span>
                      <span className="settings-theme-name">
                        <span className="settings-theme-label">{translate(`settings.themes.${t.id}.name`)}</span>
                        <span className="settings-theme-hint">{translate(`settings.themes.${t.id}.hint`)}</span>
                        {selected && <span className="settings-check" aria-hidden="true">✓</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settings-card">
              {/* Issue #191: the interface language, kept per browser like the theme. */}
              <Row id="settings-language" anchor="language" title={t("language.label")} desc={t("language.description")}>
                <div className="settings-field">
                  <LanguageSelect aria-labelledby="settings-language-title" />
                </div>
              </Row>

              <Row
                id="settings-marks" anchor="marks" title={t("settings.marks.title")}
                desc={t("settings.marks.desc")}
              >
                <div className="settings-marks">
                  {MARK_STYLES.map((style) => {
                    const draft = aliasDrafts[style];
                    const current = state.markAliases[style];
                    const dirty = draft.trim() !== "" && draft.trim() !== current;
                    return (
                      <div key={style} className="settings-mark">
                        <span className="settings-mark-swatch" aria-hidden="true" style={{ background: HL[style]?.background, color: HL[style]?.text }}>Aa</span>
                        <TextField
                          aria-label={t(`settings.marks.names.${style}`)}
                          className="settings-mark-field settings-field"
                          value={draft}
                          onChange={(value) => setAliasDrafts((d) => ({ ...d, [style]: value }))}
                        >
                          <InputBase maxLength={MARK_ALIAS_MAX_LENGTH} />
                          <span className="settings-mark-tag" aria-hidden="true">{t(`settings.marks.names.${style}`)}</span>
                        </TextField>
                        {dirty && <Button size="md" onClick={() => updateMarkAlias(style, draft)}>{t("common.save")}</Button>}
                      </div>
                    );
                  })}
                  <p className="settings-mark-sample">
                    {rich("settings.marks.sample", {
                      hl1: (chunks) => <mark style={{ background: HL.hl1?.background, color: HL.hl1?.text }} title={state.markAliases.hl1}>{chunks}</mark>,
                      hl2: (chunks) => <mark style={{ background: HL.hl2?.background, color: HL.hl2?.text }} title={state.markAliases.hl2}>{chunks}</mark>,
                      hl3: (chunks) => <mark style={{ background: HL.hl3?.background, color: HL.hl3?.text }} title={state.markAliases.hl3}>{chunks}</mark>
                    })}
                  </p>
                </div>
              </Row>

              <Row id="settings-shared" anchor="notes" inline title={t("settings.sharedNotes.title")} desc={t("settings.sharedNotes.desc")}>
                <Toggle
                  size="md"
                  aria-labelledby="settings-shared-title"
                  aria-describedby="settings-shared-desc"
                  isSelected={state.showShared}
                  onChange={toggleShared}
                />
              </Row>

              {/* issue #47: one zone for the account. The Statistics screen counts its
                  days, weeks and countdown in it, and the daily email is sent in it. */}
              <Row id="settings-zone" anchor="timezone" title={t("settings.timezone.title")} desc={t("settings.timezone.desc")}>
                {/* A combo box rather than a plain select: the zone list runs to
                    several hundred entries, which the native control made
                    searchable by type-ahead. */}
                <div className="settings-field">
                  <Select.ComboBox
                    aria-labelledby="settings-zone-title"
                    shortcut={false}
                    hint={timeZoneError ?? (clock ? t("settings.timezone.now", { offset: clock.offset, time: clock.time }) : undefined)}
                    isInvalid={!!timeZoneError}
                    selectedKey={state.timeZone}
                    onSelectionChange={(key) => key !== null && changeTimeZone(String(key))}
                    items={timezoneSelectOptions}
                  >
                    {(item) => <Select.Item key={item.id} id={item.id} label={item.label}>{item.label}</Select.Item>}
                  </Select.ComboBox>
                </div>
              </Row>
            </div>

            <DailyEmailCard clock={clock} />
          </section>

          <section aria-labelledby="settings-integrations-heading" className="settings-section">
            <div className="settings-section-head">
              <h2 id="settings-integrations-heading">{t("settings.groups.integrations")}</h2>
              <p>{t("settings.groups.integrationsDesc")}</p>
            </div>

            <AiExplanationsCard />

            <div {...sectionAnchor("mcp")}>
              <McpTokensCard
                title={t("settings.mcp.title")}
                description={t("settings.mcp.desc")}
                apiBase="/api/mcp-tokens"
                enableSetupPrompt
                namePlaceholder={t("settings.mcp.namePlaceholder")}
                onActiveCountChange={setActiveTokens}
              />
            </div>

            <McpConnectionsCard
              title={t("settings.connections.title")}
              description={t("settings.connections.desc")}
              apiBase="/api/mcp-connections"
            />
          </section>
        </div>
      </div>
    </div>
  );
}
