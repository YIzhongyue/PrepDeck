import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";
import { fetchAccessProfile, verifyAccessJwt } from "../lib/access-jwt";
import { authorizeIdentity } from "../lib/authorizeIdentity";
import { readSessionCookie, verifySessionToken } from "../lib/session";

interface UserRow {
  id: string;
  email: string;
  role: "admin" | "user";
  status: "invited" | "active" | "revoked";
  display_name: string | null;
  avatar_url: string | null;
  session_version: number;
}

type Handler = MiddlewareHandler<AppEnv>;

// Validates the Cloudflare Access JWT, then applies the same FR-1.3
// authorization check as the primary Google OAuth path (lib/authorizeIdentity).
// The client-supplied role claim, if any, is never trusted: role always
// comes from our own `users` row.
const requireAccessJwtUser: Handler = async (c, next) => {
  const assertion = c.req.header("Cf-Access-Jwt-Assertion");
  if (!assertion) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let identity: { email: string; sub: string };
  try {
    identity = await verifyAccessJwt(assertion, c.env);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // FR-12.1: the compact Access JWT only carries email/sub, so profile info
  // (name/picture) needs a second, best-effort call — see fetchAccessProfile.
  // Fetched lazily: only actually needed on a brand-new row's first sign-in.
  //
  // The `sub` here is Access's own subject for this person, not the Google
  // subject the primary path resolves on (FR-1.9), so it is tagged with its
  // provider and lib/authorizeIdentity keeps this path on the email lookup
  // rather than storing an Access id in `users.google_sub`.
  const result = await authorizeIdentity(c.env, { provider: "cloudflare-access", subject: identity.sub, email: identity.email }, async () => {
    const profile = await fetchAccessProfile(assertion, c.env);
    return { name: profile.name, picture: profile.picture };
  });
  if (!result.ok) {
    return c.json({ error: "Forbidden", email: result.email }, 403);
  }

  c.set("user", result.user);
  c.set("sessionVersion", result.sessionVersion);
  await next();
};

// AUTH_MODE = "cookie" (the production default): verifies our own signed
// session cookie instead of a Cf-Access-Jwt-Assertion header. The cookie is
// established either by direct Google OAuth (POST-redirect through
// /api/auth/google/*, docs/requirements/authentication-and-users.md) or, for local dev only, email+password
// login (POST /api/auth/login) — both land here identically once the cookie
// exists. See lib/session.ts.
const requireCookieSessionUser: Handler = async (c, next) => {
  const token = readSessionCookie(c.req.header("Cookie") ?? null, c.env.ENVIRONMENT !== "development" || new URL(c.req.url).protocol === "https:");
  const session = token ? await verifySessionToken(token, c.env) : null;
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Security decisions always read D1's primary through the direct binding.
  // Do not replace this with KV or a replica session: role/status/version
  // changes must be visible to requests admitted after the mutation commits.
  const row = await c.env.DB.prepare("SELECT id, email, role, status, display_name, avatar_url, session_version FROM users WHERE id = ?")
    .bind(session.userId)
    .first<UserRow>();
  if (!row || row.status === "revoked") {
    return c.json({ error: "Forbidden", email: row?.email ?? null }, 403);
  }
  if (row.session_version !== session.sessionVersion) return c.json({ error: "Unauthorized" }, 401);

  c.set("sessionVersion", row.session_version);
  c.set("user", { id: row.id, email: row.email, role: row.role, displayName: row.display_name, avatarUrl: row.avatar_url });
  await next();
};

export const requireAccessUser: Handler = async (c, next) => {
  const delegate = c.env.AUTH_MODE === "access" ? requireAccessJwtUser : requireCookieSessionUser;
  return delegate(c, next);
};
