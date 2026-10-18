import type { ActiveAttemptResponse, UpdateUserSettingsRequest, UserSettingsResponse } from "@prepdeck/shared";
import { apiFetch, ApiError } from "../lib/api";
import type { AppState } from "./appState";

// Pure helpers shared by the store's actions (store/actions/*).

// Keyboard targets whose Enter key activates the control itself.
export const ACTIVATABLE_CONTROLS = "button, a[href], summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=switch], [role=menuitem], [role=option]";

// A prefetch (issue #106) is speculative: it leaves a question that already
// failed alone, and its own failure clears the entry rather than recording an
// error, so opening that question later makes an ordinary request.
export interface LoadOptions { prefetch?: boolean }

export function without<T>(entries: Record<string, T>, id: string): Record<string, T> {
  if (!(id in entries)) return entries;
  const rest = { ...entries }; delete rest[id];
  return rest;
}

export function base(node: Node | null): number | null {
  let el = node && node.nodeType === 3 ? (node.parentElement as HTMLElement | null) : (node as HTMLElement | null);
  while (el && el.dataset.off === undefined) el = el.parentElement;
  return el ? parseInt(el.dataset.off || "0", 10) : null;
}

// A navigation clears the error of the screen it leaves (issue #52), not one
// raised while it was waiting on saves: an expired draft reports "Time is up"
// exactly then, and wiping it left the exam submitted unexplained (issue #83).
export function errorLeftBehind(before: string | null) {
  return (s: AppState) => s.actionError === before ? null : s.actionError;
}

// The Worker refuses draft writes once a mock is past its deadline (FR-4.3) and
// marks that refusal `expired`, which is the one 409 the client must not treat
// as retryable: telling the user "it will be retried before submitting" would
// promise a retry that can only fail again.
export function isExpiredAttempt(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && (error.body as { expired?: boolean } | null)?.expired === true;
}

// The attempt was submitted from another tab or device. Local drafts can never
// be saved to it again, so replaying them would block this tab's submission
// forever; POST /complete instead returns the result it was graded with.
export function isCompletedElsewhere(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && (error.body as { completed?: boolean } | null)?.completed === true;
}

// Neither refusal can succeed on a retry.
export function isClosedAttempt(error: unknown): boolean {
  return isExpiredAttempt(error) || isCompletedElsewhere(error);
}

// The server refused the draft itself: not a possible answer to the question
// (for example an option removed since this tab loaded it), or a question no
// longer in the bank. A retry sends the same body and fails the same way, so it
// must not block submission; the server keeps the last draft it accepted.
export function isRejectedDraft(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 400 || error.status === 404);
}

export function remainingSeconds(active: ActiveAttemptResponse): number {
  if (active.timeLimitSeconds == null) return 0;
  const elapsed = Math.floor((Date.now() - new Date(active.startedAt).getTime()) / 1000);
  return Math.max(0, active.timeLimitSeconds - elapsed);
}

export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export async function saveTimeZone(timeZone: string): Promise<string | null> {
  const body: UpdateUserSettingsRequest = { timezone: timeZone };
  const { timezone } = await apiFetch<UserSettingsResponse>("/api/settings", { method: "PATCH", body: JSON.stringify(body) });
  return timezone;
}

export function timeZoneSaved(timeZone: string | null) {
  return (s: AppState): Partial<AppState> => ({
    timeZone,
    emailSettings: s.emailSettings && timeZone ? { ...s.emailSettings, timezone: timeZone } : s.emailSettings,
    activityRevision: s.activityRevision + 1,
  });
}
