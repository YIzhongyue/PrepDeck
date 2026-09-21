// Shared FR-1.3/FR-1.9 authorization check: given a verified external identity
// (provider + provider subject + email + best-effort profile info), decide
// whether it may use PrepDeck at all, and activate it on first sign-in. Used
// by both verified-identity entry points — the Google OAuth callback (the
// primary path, routes/auth.ts) and Cloudflare Access's JWT (the opt-in
// rollback path, middleware/access.ts) — so the activation logic lives in
// exactly one place regardless of which identity provider produced it.
//
// The canonical identity of a Google-authenticated user is the OIDC `sub`
// claim, not the email address: emails get renamed and domains get migrated,
// while `sub` is stable for the life of the Google account. Email stays as
// contact/profile information (invitations, the daily review mail, the
// Authorized Users list) and is only consulted to *find* an account that has
// not been bound to a subject yet.

import type { Env } from "../bindings";
import type { Role, UserStatus } from "@prepdeck/shared";
import { getCachedUserByEmail, invalidateCachedUser, setCachedUser, type CachedUserRow } from "./userCache";

interface UserRow {
  id: string;
  email: string;
  google_sub: string | null;
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

// `subject_conflict` is kept apart from a plain `not_authorized` because the
// two need opposite advice. An unlisted address needs an invitation; an
// address whose row is already bound to a different Google account cannot be
// invited again (it is already on the list) and needs an Admin to clear that
// binding — see routes/adminUsers.ts's `googleSub: null` patch.
export type DenialReason = "not_authorized" | "subject_conflict";

export type AuthorizeResult =
  | { ok: true; user: AuthorizedIdentity }
  | { ok: false; email: string; reason: DenialReason };

// Provider-scoped identity: a subject is only unique *within* the provider
// that issued it, so it is always carried together with that provider. Only
// Google subjects are persisted today (users.google_sub) — Cloudflare Access
// mints its own Access-scoped `sub` for the same person, a different value
// that must never be stored in that column or matched against it.
export type IdentityProvider = "google" | "cloudflare-access";

export interface ExternalIdentity {
  provider: IdentityProvider;
  subject: string;
  email: string;
}

export interface ExternalProfile {
  name: string | null;
  picture: string | null;
}

// `getProfile` is lazy (called at most once, and only when something is left
// to backfill) so that callers whose profile lookup is an extra network call —
// Access's get-identity endpoint — don't pay for it on every request once a
// user is already active; the name/picture are only actually needed to
// populate a brand-new row.
export async function authorizeIdentity(
  env: Env,
  identity: ExternalIdentity,
  getProfile: () => Promise<ExternalProfile>
): Promise<AuthorizeResult> {
  const email = identity.email.toLowerCase();
  const subject = identity.provider === "google" ? identity.subject : null;

  let row: UserRow | null;
  if (subject) {
    const resolved = await resolveByGoogleSubject(env, subject, email);
    if (resolved === "subject_conflict") return { ok: false, email, reason: "subject_conflict" };
    row = resolved;
  } else {
    // Access mode has no persisted subject to match on, so it stays on the
    // email lookup — and keeps using the email cache, which is what makes an
    // Access-authenticated request cheap. The OAuth callback deliberately
    // skips that cache: it runs once per sign-in, not once per request, and a
    // cached row carries no subject to match against anyway.
    const cached = await getCachedUserByEmail(env, email);
    if (cached) {
      if (cached.status === "revoked") return { ok: false, email, reason: "not_authorized" };
      return { ok: true, user: toIdentity(cached) };
    }
    row = await selectUser(env, "email = ?", email);
  }

  // No row at all, or explicitly revoked -> not authorized, per FR-1.3.
  // A valid Google account is not sufficient; the email must have been
  // invited by an Admin.
  if (!row || row.status === "revoked") {
    return { ok: false, email, reason: "not_authorized" };
  }

  // Keep the stored email in step with the provider's verified one so the
  // contact/display uses of it stay correct after a Google account rename.
  // `users.email` is UNIQUE, so a rename onto an address some *other* row
  // already holds is dropped rather than allowed to fail the sign-in: two
  // accounts are never merged just because their emails now collide, and the
  // subject match above has already settled which account this is.
  let storedEmail = row.email;
  if (row.email !== email) {
    if (await emailTakenByAnotherUser(env, email, row.id)) {
      console.warn("auth.identity.email_rename_conflict", { userId: row.id });
    } else {
      storedEmail = email;
      console.info("auth.identity.email_renamed", { userId: row.id });
    }
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
  //
  // `google_sub = COALESCE(google_sub, ?)` is what binds a subject to the
  // account the email lookup found, and binds it only once. The binding state
  // the read above saw is re-asserted in the WHERE clause (BIND_GUARD) rather
  // than assumed, because the read and this write are not one operation: two
  // first sign-ins carrying *different* subjects for the same invited address
  // can both see the row unbound, and COALESCE alone would let the loser walk
  // away with a session on an account now bound to the winner's Google
  // account. Losing the guard means updating no rows, so RETURNING yields
  // nothing and the sign-in is denied.
  if (row.status === "invited" || row.avatar_url === null) {
    const profile = await getProfile();
    const displayName = row.display_name ?? profile.name ?? storedEmail.split("@")[0] ?? storedEmail;
    const avatarUrl = row.avatar_url ?? profile.picture ?? null;
    const activated = await env.DB.prepare(
      `UPDATE users SET google_sub = COALESCE(google_sub, ?), email = ?, status = 'active', display_name = COALESCE(display_name, ?), avatar_url = COALESCE(avatar_url, ?), last_login_at = ? WHERE id = ? AND status IN ('invited', 'active') AND ${BIND_GUARD} RETURNING id, email, role, status, display_name, avatar_url`
    )
      .bind(subject, storedEmail, displayName, avatarUrl, now, row.id, subject, subject)
      .first<CachedUserRow>();
    if (!activated) return { ok: false, email, reason: await denialReason(env, subject, email) };
    cacheRow = activated;
  } else {
    const active = await env.DB.prepare(
      `UPDATE users SET google_sub = COALESCE(google_sub, ?), email = ?, last_login_at = ? WHERE id = ? AND status = 'active' AND ${BIND_GUARD} RETURNING id, email, role, status, display_name, avatar_url`
    )
      .bind(subject, storedEmail, now, row.id, subject, subject)
      .first<CachedUserRow>();
    if (!active) return { ok: false, email, reason: await denialReason(env, subject, email) };
    cacheRow = active;
  }

  // setCachedUser files the row under the *new* address, so drop the entry
  // still filed under the old one rather than leave it serving a stale row
  // for up to a TTL.
  if (row.email !== cacheRow.email) await invalidateCachedUser(env, row.id, row.email);

  await setCachedUser(env, cacheRow);
  return { ok: true, user: toIdentity(cacheRow) };
}

// FR-1.9 resolution order for a Google-authenticated user:
//
//  1. the stored `google_sub` — the only match that survives an email change;
//  2. failing that, the invited/legacy email association, trusted exactly
//     once: the caller's UPDATE binds the subject to that row, and every
//     later sign-in takes branch 1.
//
// A row found by email that already carries a *different* subject is a
// conflicting binding, not a match: two Google accounts that have at some
// point shared an address must not collapse into a single PrepDeck account.
// The ID token cannot tell the two readings apart — a person whose Workspace
// admin replaced their old account with a fresh one on a custom domain, and a
// stranger who was handed a recycled address — so this denies rather than
// guesses, and recovery is an explicit Admin act (clearing the binding from
// the Authorized Users screen) rather than something a sign-in can do to
// itself. Denying keeps the existing account's data where it is either way.
async function resolveByGoogleSubject(env: Env, subject: string, email: string): Promise<UserRow | null | "subject_conflict"> {
  const bound = await selectUser(env, "google_sub = ?", subject);
  if (bound) return bound;

  const byEmail = await selectUser(env, "email = ?", email);
  if (!byEmail) return null;
  if (byEmail.google_sub !== null) {
    console.warn("auth.identity.subject_conflict", { userId: byEmail.id });
    return "subject_conflict";
  }
  return byEmail;
}

// Takes the expected subject twice: the row must still be unbound, or already
// bound to this very subject. The leading `? IS NULL` makes the whole guard a
// no-op for Cloudflare Access, which carries no subject to assert and whose
// rows may legitimately hold a Google one from an earlier OAuth sign-in.
const BIND_GUARD = "(? IS NULL OR google_sub IS NULL OR google_sub = ?)";

// A guarded UPDATE comes back empty for one of two reasons, and they need
// opposite advice on the login screen: the account was revoked between the
// read and the write, or a concurrent sign-in won the binding with a different
// subject. One extra read on the (rare) failure path tells them apart. It only
// picks the wording — neither outcome retries the write.
async function denialReason(env: Env, subject: string | null, email: string): Promise<DenialReason> {
  if (!subject) return "not_authorized";
  const row = await selectUser(env, "email = ?", email);
  return row && row.google_sub !== null && row.google_sub !== subject ? "subject_conflict" : "not_authorized";
}

function selectUser(env: Env, where: string, value: string): Promise<UserRow | null> {
  return env.DB.prepare(`SELECT id, email, google_sub, role, status, display_name, avatar_url FROM users WHERE ${where}`)
    .bind(value)
    .first<UserRow>();
}

async function emailTakenByAnotherUser(env: Env, email: string, userId: string): Promise<boolean> {
  const clash = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND id <> ?").bind(email, userId).first<{ id: string }>();
  return clash !== null;
}

function toIdentity(row: CachedUserRow): AuthorizedIdentity {
  return { id: row.id, email: row.email, role: row.role, displayName: row.display_name, avatarUrl: row.avatar_url };
}
