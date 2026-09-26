// Signing in again after a session expired mid-study (issue #52). Google
// sign-in is a full-page round trip, so what only this tab knows would be lost
// on the way: the page to come back to, and mock answers the server refused
// to save while the session was gone.

const MOCK_STASH_KEY = "prepdeck:reauth-mock";
// A stash older than this is from another sitting, not this sign-in.
const MOCK_STASH_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** The Google sign-in URL that comes back to `returnTo` (same-origin path). */
export function signInUrl(returnTo: string = currentPath()): string {
  return returnTo === "/" ? "/api/auth/google/start" : `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function currentPath(): string {
  return typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
}

export interface MockStash {
  attemptId: string;
  sel: Record<string, string[]>;
}

export function stashMockSelections(stash: MockStash): void {
  try {
    sessionStorage.setItem(MOCK_STASH_KEY, JSON.stringify({ ...stash, at: Date.now() }));
  } catch {
    // Without storage the server's saved drafts are what resume shows.
  }
}

/** The stashed selections for `attemptId`, removed as they are read. */
export function takeMockSelections(attemptId: string, now = Date.now()): Record<string, string[]> | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(MOCK_STASH_KEY);
    sessionStorage.removeItem(MOCK_STASH_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { attemptId?: unknown; sel?: unknown; at?: unknown };
    if (parsed.attemptId !== attemptId || typeof parsed.at !== "number" || now - parsed.at > MOCK_STASH_MAX_AGE_MS) return null;
    if (!parsed.sel || typeof parsed.sel !== "object") return null;
    const entries = Object.entries(parsed.sel as Record<string, unknown>)
      .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((v) => typeof v === "string"));
    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}
