// Shared FR-1.3 authorization check: given a verified external identity
// (email + provider subject + best-effort profile info), decide whether it
// may use PrepDeck at all, and activate it on first sign-in. Used by both
// verified-identity entry points — the Google OAuth callback (the primary
// path, routes/auth.ts) and Cloudflare Access's JWT (the opt-in rollback
// path, middleware/access.ts) — so the activation logic lives in exactly one
// place regardless of which identity provider produced it.

import type { Env } from "../bindings";
import type { Role, UserStatus } from "@prepdeck/shared";
import { getCachedUserByEmail, setCachedUser, type CachedUserRow } from "./userCache";

interface UserRow {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  display_name: string | null;
  avatar_url: string | null;
}

export interface AuthorizedIdentity {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
  avatarUrl: string | null;
}

export type AuthorizeResult = { ok: true; user: AuthorizedIdentity } | { ok: false; email: string };

export interface ExternalProfile {
  sub: string;
  name: string | null;
  picture: string | null;
}

// `getProfile` is lazy (called at most once, and only on first sign-in) so
// that callers whose profile lookup is an extra network call — Access's
// get-identity endpoint — don't pay for it on every request once a user is
// already active; the sub/name/picture are only actually needed to populate
// a brand-new row.
export async function authorizeIdentity(
  env: Env,
  rawEmail: string,
  getProfile: () => Promise<ExternalProfile>
): Promise<AuthorizeResult> {
  const email = rawEmail.toLowerCase();

  const cached = await getCachedUserByEmail(env, email);
  if (cached) {
    if (cached.status === "revoked") return { ok: false, email };
    return { ok: true, user: toIdentity(cached) };
  }

  const row = await env.DB.prepare("SELECT id, email, role, status, display_name, avatar_url FROM users WHERE email = ?")
    .bind(email)
    .first<UserRow>();

  // No row at all, or explicitly revoked -> not authorized, per FR-1.3.
  // A valid Google account is not sufficient; the email must have been
  // invited by an Admin.
  if (!row || row.status === "revoked") {
    return { ok: false, email };
  }

  const now = new Date().toISOString();
  let cacheRow: CachedUserRow;

  // Fetch the identity provider's profile on first sign-in (to activate the
  // account) and also on any later sign-in where the avatar is still unset —
  // e.g. Google had no `picture` claim on an earlier login. Once avatar_url
  // is non-null (Google-sourced or a custom upload) it's left alone, so this
  // never clobbers a user's own choice; COALESCE below is the actual guard,
  // this check just avoids the identity-provider profile lookup entirely
  // once nothing is left to backfill.
  if (row.status === "invited" || row.avatar_url === null) {
    const profile = await getProfile();
    const displayName = row.display_name ?? profile.name ?? email.split("@")[0] ?? email;
    const avatarUrl = row.avatar_url ?? profile.picture ?? null;
    const activated = await env.DB.prepare(
      "UPDATE users SET google_sub = COALESCE(google_sub, ?), status = 'active', display_name = COALESCE(display_name, ?), avatar_url = COALESCE(avatar_url, ?), last_login_at = ? WHERE id = ? AND status IN ('invited', 'active') RETURNING id, email, role, status, display_name, avatar_url"
    )
      .bind(profile.sub, displayName, avatarUrl, now, row.id)
      .first<UserRow>();
    if (!activated) return { ok: false, email };
    cacheRow = activated;
  } else {
    const active = await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ? AND status = 'active' RETURNING id, email, role, status, display_name, avatar_url")
      .bind(now, row.id).first<UserRow>();
    if (!active) return { ok: false, email };
    cacheRow = active;
  }

  await setCachedUser(env, cacheRow);
  return { ok: true, user: toIdentity(cacheRow) };
}

function toIdentity(row: CachedUserRow): AuthorizedIdentity {
  return { id: row.id, email: row.email, role: row.role, displayName: row.display_name, avatarUrl: row.avatar_url };
}
