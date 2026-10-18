import { useCallback } from "react";
import type { AvatarUploadResponse, DailyEmailSettingsResponse, ProfileResponse, UpdateDailyEmailSettingsRequest } from "@prepdeck/shared";
import { CURATED_MODELS } from "@prepdeck/shared";
import { apiFetch } from "../../lib/api";
import { stashMockSelections } from "../../lib/reauth";
import {
  setSessionKey,
  clearSessionKey,
  saveEncryptedKey,
  loadEncryptedKey,
  clearStoredEncryptedKey,
  deleteLegacyKeystore,
} from "../../lib/keyStorage";
import { clearLegacyKeyMode, storeKeyMode } from "../../lib/keyModeStorage";
import { storeTheme } from "../../lib/themeStorage";
import type { KeyMode, ThemeId } from "../../types";
import type { Provider } from "../appState";
import { saveTimeZone, timeZoneSaved } from "../storeHelpers";
import type { StoreCore } from "./useStoreCore";

// Account and device settings: time zone, daily email, AI provider and key
// storage, theme, profile and sign-out.
export type AccountSettings = ReturnType<typeof useAccountSettings>;

export function useAccountSettings(core: StoreCore) {
  const { setState, stateRef } = core;

  // issue #47. Not optimistic: every statistic is recounted in the new zone,
  // so the Statistics screen refetches once the server has it.
  const updateTimeZone = useCallback(async (timeZone: string) => {
    setState(timeZoneSaved(await saveTimeZone(timeZone)));
  }, [setState]);

  // implementation — daily review email settings. Not optimistic (unlike
  // toggleShared above): the enabled/source/timing fields are meaningful
  // enough to wait for the server's resolved response, same as
  // updateMarkAlias below.
  const updateEmailSettings = useCallback((patch: UpdateDailyEmailSettingsRequest) => {
    apiFetch<DailyEmailSettingsResponse>("/api/daily-email-settings", { method: "PATCH", body: JSON.stringify(patch) })
      .then((r) => setState({ emailSettings: r }))
      .catch(() => {});
  }, [setState]);

  // Switching provider resets to that provider's first curated model (FR-7.0(c)) —
  // a stale OpenAI model id chosen while on Anthropic would just fail upstream.
  const setProvider = useCallback((p: Provider) => setState({ provider: p, model: CURATED_MODELS[p][0]!.id }), [setState]);
  const setModel = useCallback((m: string) => setState({ model: m }), [setState]);
  // The storage-method choice itself is browser-local (FR-7.9), same
  // treatment as theme: it survives a refresh so "Encrypted in this browser"
  // stays selected without the user re-picking it every visit.
  const setKeyMode = useCallback((m: KeyMode) => {
    const id = stateRef.current.me?.id;
    if (id) storeKeyMode(id, m);
    setState({ keyMode: m });
  }, [setState, stateRef]);

  // FR-7.0: loads a key into browser runtime memory for this session (see
  // lib/keyStorage.ts) — optionally also persisted encrypted per FR-7.9,
  // which the Settings screen handles itself before calling this.
  const loadSessionApiKey = useCallback((key: string) => {
    setSessionKey(key);
    setState({ hasSessionKey: true });
  }, [setState]);
  const clearSessionApiKey = useCallback(() => {
    clearSessionKey();
    setState({ hasSessionKey: false });
  }, [setState]);

  // The encrypted key belongs to the signed-in account (issue #46). Reads the
  // ref, so the callbacks below never see a stale account.
  const signedInId = useCallback(() => {
    const id = stateRef.current.me?.id;
    if (!id) throw new Error("Not signed in");
    return id;
  }, [stateRef]);

  // FR-7.9: encrypts and stores the key for next visit, and loads it into
  // this session immediately so it's usable right away.
  const saveEncryptedApiKey = useCallback(async (apiKey: string, passphrase: string) => {
    await saveEncryptedKey(signedInId(), apiKey, passphrase);
    setSessionKey(apiKey);
    setState({ hasStoredKey: true, hasSessionKey: true });
  }, [setState, signedInId]);

  // Unlocks a previously encrypted key with its passphrase — from Settings,
  // or from an inline prompt next to "Generate explanation" once a refresh
  // (or enough idle time) has dropped the in-memory session key.
  const unlockSessionKey = useCallback(async (passphrase: string) => {
    const key = await loadEncryptedKey(signedInId(), passphrase);
    setSessionKey(key);
    setState({ hasSessionKey: true });
  }, [setState, signedInId]);

  const forgetStoredApiKey = useCallback(async () => {
    await clearStoredEncryptedKey(signedInId());
    setState({ hasStoredKey: false });
  }, [setState, signedInId]);

  // Signing out ends every session of the account (issue #46; the server moves
  // its session version on). This browser also drops the key held in memory,
  // the saved key when asked to, and the browser-wide key storage left by
  // earlier versions, whose owner is unknown.
  const signOut = useCallback(async (opts: { removeSavedKey: boolean }) => {
    const id = stateRef.current.me?.id;
    clearSessionKey();
    if (opts.removeSavedKey && id) await clearStoredEncryptedKey(id).catch(() => {});
    await deleteLegacyKeystore();
    clearLegacyKeyMode();
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/?auth=signedout";
  }, [stateRef]);

  // Theme preference is deliberately browser-local: it can be restored before
  // the settings request completes and does not follow the account to a device
  // where the user may prefer a different display treatment.
  const setTheme = useCallback((t: ThemeId) => {
    storeTheme(t);
    setState({ theme: t });
  }, [setState]);

  // FR-12.2: edit one's own display name.
  const updateDisplayName = useCallback(async (displayName: string) => {
    const trimmed = displayName.trim();
    if (!trimmed) return;
    const { user } = await apiFetch<ProfileResponse>("/api/me", { method: "PATCH", body: JSON.stringify({ displayName: trimmed }) });
    setState({ me: user });
  }, [setState]);

  // FR-12.3/FR-12.4: upload a custom avatar. The caller (Settings) is
  // responsible for client-side resize/compression via lib/avatar.ts before
  // calling this — this just does the upload and reconciles state.me.
  const uploadAvatar = useCallback(async (blob: Blob) => {
    const { avatarUrl } = await apiFetch<AvatarUploadResponse>("/api/me/avatar", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    setState((s) => (s.me ? { me: { ...s.me, avatarUrl } } : {}));
  }, [setState]);

  // Before leaving to sign in again (issue #52): mock answers this tab holds
  // but the server refused while the session was gone.
  const preserveForReauth = useCallback(() => {
    const s = stateRef.current;
    if (s.mStage === "live" && s.mockAttemptId) stashMockSelections({ attemptId: s.mockAttemptId, sel: s.mSel });
  }, [stateRef]);
  return {
    updateTimeZone, updateEmailSettings, setProvider, setModel, setKeyMode, loadSessionApiKey,
    clearSessionApiKey, saveEncryptedApiKey, unlockSessionKey, forgetStoredApiKey, signOut, setTheme,
    updateDisplayName, uploadAvatar, preserveForReauth,
  };
}
