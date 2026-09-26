// docs/requirements/authentication-and-users.md — Authorized Users management (FR-1.2, FR-1.4): Admin
// invites a Google email with an initial role, and can later change an
// account's role or revoke/restore its access. Admin-only (requireAdmin).

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAdmin } from "../middleware/admin";
import { hashPassword } from "../lib/password";
import { isDevPasswordLoginEnabled } from "../lib/devPasswordLogin";
import { invalidateCachedUser } from "../lib/userCache";
import type { Role, User, UserStatus } from "@prepdeck/shared";

interface UserRow {
  id: string;
  email: string;
  google_sub: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: Role;
  status: UserStatus;
  invited_by: string | null;
  show_shared_notes: number;
  created_at: string;
  last_login_at: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    googleSub: row.google_sub,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by,
    showSharedNotes: !!row.show_shared_notes,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const adminUsersRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

adminUsersRouter.use("*", requireAdmin);

// FR-1.2/FR-1.4 (surfaced under the /admin console per FR-13.3): the full
// Authorized Users list, newest invite last.
adminUsersRouter.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM users ORDER BY created_at ASC").all<UserRow>();
  return c.json({ users: (results ?? []).map(toUser) });
});

// FR-1.2: invite a new Google email with an initial role. Creates a row with
// status 'invited' and no google_sub — first sign-in (FR-1.3, middleware/access.ts)
// fills those in. `password` is optional and only meaningful for the local-dev
// email+password fallback (POST /api/auth/login) — Google OAuth ignores it.
adminUsersRouter.post("/", async (c) => {
  const body = await c.req.json<{ email?: string; role?: Role; password?: string }>().catch(() => null);
  const email = body?.email?.trim().toLowerCase();
  const role = body?.role;
  if (!email || !EMAIL_RE.test(email)) return c.json({ error: "A valid email is required" }, 400);
  if (role !== "admin" && role !== "user") return c.json({ error: "role must be 'admin' or 'user'" }, 400);

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return c.json({ error: "This email is already on the Authorized Users list" }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // Never create reusable password credentials in production. The same
  // fail-closed gate used by /auth/login is required before hashing a supplied
  // local-development password.
  const passwordHash = body?.password && isDevPasswordLoginEnabled(c.env) ? await hashPassword(body.password) : null;

  await c.env.DB.prepare(
    "INSERT INTO users (id, email, role, status, invited_by, created_at, password_hash) VALUES (?, ?, ?, 'invited', ?, ?, ?)"
  )
    .bind(id, email, role, c.get("user").id, now, passwordHash)
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  return c.json({ user: toUser(row!) }, 201);
});

// FR-1.4: change an account's role, or revoke/restore its access; FR-1.9:
// clear a stale Google binding so the account can be claimed again. Guards
// against an admin editing their own row here (Settings is for that) —
// which, as a side effect, also means an active admin can never demote or
// revoke themselves into leaving zero active admins: whoever performs the
// mutation is necessarily a *different*, still-active admin.
adminUsersRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const actingUser = c.get("user");
  if (id === actingUser.id) {
    return c.json({ error: "Use your own Settings page to change your own account" }, 400);
  }

  const body = await c.req.json<{ role?: Role; status?: "active" | "revoked"; googleSub?: null }>().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);
  if (body.role !== undefined && body.role !== "admin" && body.role !== "user") {
    return c.json({ error: "role must be 'admin' or 'user'" }, 400);
  }
  if (body.status !== undefined && body.status !== "active" && body.status !== "revoked") {
    return c.json({ error: "status must be 'active' or 'revoked'" }, 400);
  }
  // Clearing only: an Admin can unbind a Google account, never hand-pick which
  // one an account answers to. A subject is only ever written by a sign-in
  // that verified it against Google's JWKS (FR-1.9), so accepting one here
  // would turn the Authorized Users screen into a way to take over an account
  // by typing a number.
  if (body.googleSub !== undefined && body.googleSub !== null) {
    return c.json({ error: "googleSub can only be cleared (null)" }, 400);
  }
  if (body.role === undefined && body.status === undefined && body.googleSub === undefined) {
    return c.json({ error: "Nothing to update" }, 400);
  }

  const target = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!target) return c.json({ error: "User not found" }, 404);

  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.role !== undefined) {
    fields.push("role = ?");
    values.push(body.role);
  }
  if (body.status !== undefined) {
    fields.push("status = ?");
    values.push(body.status);
    // A revoke also ends the account's sessions (issue #46), so it holds even
    // where a cached user row has not caught up yet.
    if (body.status === "revoked") fields.push("session_version = session_version + 1");
  }
  // FR-1.9 recovery: re-arms the one-time email-based binding, so the next
  // successful Google sign-in on this address adopts whichever account signs
  // in. The row — and everything hanging off its id — stays exactly as it is.
  if (body.googleSub === null) {
    fields.push("google_sub = NULL");
  }
  await c.env.DB.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  // A role change or revoke must take effect immediately, not after the
  // auth cache's TTL (see lib/userCache.ts) expires.
  if (row) await invalidateCachedUser(c.env, row.id, row.email);
  return c.json({ user: toUser(row!) });
});
