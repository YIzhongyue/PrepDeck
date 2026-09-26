// Thin fetch wrapper for the Worker API. In dev, Vite proxies /api/* to
// `wrangler dev` (see vite.config.ts); in production the SPA and the API are
// served from the same Worker (see apps/worker/wrangler.toml [assets]), so a
// relative path works in both cases.

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Session loss during use (issue #52). The gate in App.tsx checks the session
// once, on load; a session that expires later (7 days, or a sign-out elsewhere)
// used to surface as every action's own "please retry" message. The first
// request that learns of it announces it once, and the app asks the learner to
// sign in again. /api/auth/* is excluded: those calls report their own state.
export const SESSION_EXPIRED_EVENT = "prepdeck:session-expired";
// The account was revoked while signed in: the gate shows "access not authorized".
export const ACCESS_REVOKED_EVENT = "prepdeck:access-revoked";
let sessionLossAnnounced = false;

function announceSessionLoss(path: string, status: number, body: unknown): void {
  if (sessionLossAnnounced || path.startsWith("/api/auth/") || typeof window === "undefined") return;
  if (status === 401) {
    sessionLossAnnounced = true;
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  } else if (status === 403 && body && typeof body === "object" && "email" in body) {
    // Only the session check puts `email` on a 403; an admin-only refusal does not.
    sessionLossAnnounced = true;
    window.dispatchEvent(new CustomEvent(ACCESS_REVOKED_EVENT, { detail: { email: (body as { email: unknown }).email } }));
  }
}

/** Whether session loss has been announced and not yet dismissed. */
export function isSessionLost(): boolean {
  return sessionLossAnnounced;
}

/** Lets the next refused request announce session loss again. */
export function resetSessionLoss(): void {
  sessionLossAnnounced = false;
}

/** A 401: retrying the same request cannot succeed until the learner signs in again. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include"
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    announceSessionLoss(path, res.status, body);
    throw new ApiError(res.status, (body && body.error) || `Request to ${path} failed with ${res.status}`, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
