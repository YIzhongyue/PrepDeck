// Request bodies for Authorized Users management (FR-1.2/FR-1.4, FR-1.9),
// POST and PATCH /api/admin/users. See admin.ts for the response DTOs.

import { z } from "zod";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_EMAIL = "A valid email is required";
const ROLE = "role must be 'admin' or 'user'";

export const inviteUserRequestSchema = z.object({
  // Stored trimmed and lowercased.
  email: z.string(VALID_EMAIL).trim().toLowerCase().regex(EMAIL_RE, VALID_EMAIL),
  role: z.enum(["admin", "user"], ROLE),
  // Optional initial password, meaningful only while the Worker's
  // explicit development password-login bindings are enabled (see
  // apps/worker/src/routes/auth.ts) — lets an
  // invited account sign in locally before Cloudflare Access is wired up.
  // Ignored in production and whenever the fail-closed feature flag is off.
  password: z.string("password must be a string").optional(),
}, VALID_EMAIL);

export const updateUserRequestSchema = z.object({
  role: z.enum(["admin", "user"], ROLE).optional(),
  status: z.enum(["active", "revoked"], "status must be 'active' or 'revoked'").optional(),
  // Clearing only: an Admin can unbind a Google account, never hand-pick which
  // one an account answers to. A subject is only ever written by a sign-in
  // that verified it against Google's JWKS (FR-1.9), so accepting one here
  // would turn the Authorized Users screen into a way to take over an account
  // by typing a number.
  googleSub: z.null("googleSub can only be cleared (null)").optional(),
}, "Invalid JSON body").refine(
  (body) => body.role !== undefined || body.status !== undefined || body.googleSub !== undefined,
  "Nothing to update",
);
