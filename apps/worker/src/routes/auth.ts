// docs/requirements/authentication-and-users.md — sign-in. The primary path is direct Google OAuth
// (/google/start, /google/callback), so the app can present its own
// custom-designed login page (screens/Login.tsx) instead of Cloudflare
// Access's hosted one. Email+password (/login) remains as a local-dev-only
// fallback that doesn't need a registered OAuth redirect URI. /me is gated
// by the normal auth middleware, so it doubles as a "is my session still
// valid" check for the frontend's login gate.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAccessUser } from "../middleware/access";
import { verifyPassword } from "../lib/password";
import { isDevPasswordLoginEnabled } from "../lib/devPasswordLogin";
import { issueSessionToken, buildSessionCookie, clearSessionCookie, readSessionCookie, verifySessionToken } from "../lib/session";
import { invalidateCachedUser } from "../lib/userCache";
import { authorizeIdentity } from "../lib/authorizeIdentity";
import {
  buildGoogleAuthUrl,
  buildOAuthStateCookie,
  clearOAuthStateCookie,
  exchangeCodeForIdentity,
  pkceChallengeFromVerifier,
  randomBase64Url,
  readOAuthStateCookie
} from "../lib/google-oauth";

interface UserRow {
  id: string;
  email: string;
  role: "admin" | "user";
  status: "invited" | "active" | "revoked";
  display_name: string | null;
  avatar_url: string | null;
  password_hash: string | null;
}

export const authRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

function googleRedirectUri(c: { req: { url: string } }): string {
  return `${new URL(c.req.url).origin}/api/auth/google/callback`;
}

// Kicks off the OAuth round trip: stash a CSRF `state` + PKCE `code_verifier`
// in a short-lived cookie, then send the browser to Google's consent screen.
authRouter.get("/google/start", async (c) => {
  // The direct OAuth callback creates a PrepDeck session cookie. Access mode
  // deliberately ignores that cookie and requires Cf-Access-Jwt-Assertion,
  // so allowing this flow in Access mode can only end in a confusing 401.
  if (c.env.AUTH_MODE !== "cookie") {
    console.error("auth.google.start.invalid_mode", { authMode: c.env.AUTH_MODE });
    return c.json({ error: "Direct Google sign-in requires AUTH_MODE=cookie" }, 503);
  }

  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await pkceChallengeFromVerifier(codeVerifier);

  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", buildOAuthStateCookie(state, codeVerifier, secure));

  const redirectUri = googleRedirectUri(c);
  console.info("auth.google.start", { redirectUri });
  return c.redirect(buildGoogleAuthUrl(c.env, redirectUri, state, codeChallenge), 302);
});

// Google redirects back here with ?code&state. Exchanges the code, verifies
// the id_token, runs the FR-1.3 authorization check, and — on success — sets
// the same session cookie /login (below) uses. Every outcome redirects back
// to the SPA shell with a `?auth=` flag so screens/Login.tsx can render the
// matching state; it never renders anything itself.
authRouter.get("/google/callback", async (c) => {
  const secure = new URL(c.req.url).protocol === "https:";
  const clearOAuthCookie = clearOAuthStateCookie(secure);

  // `conflict` is a denial like `denied`, but the two need opposite advice on
  // the login screen: an unlisted address needs an invitation, while a
  // conflicting one is already invited and needs an Admin to clear its stale
  // Google binding (FR-1.9). Telling a conflicted user to "ask an admin to
  // invite it" sends them down a path that dead-ends in a 409.
  const fail = (reason: "error" | "denied" | "conflict", email?: string) => {
    c.header("Set-Cookie", clearOAuthCookie);
    const qs = reason !== "error" && email ? `?auth=${reason}&email=${encodeURIComponent(email)}` : `?auth=${reason}`;
    return c.redirect(`/${qs}`, 302);
  };

  // Google can return an OAuth error instead of a code (for example when a
  // user declines consent). Log only the error category; never log the code,
  // state, token, or OAuth cookie.
  const providerError = c.req.query("error");
  if (providerError) {
    console.warn("auth.google.callback.provider_error", { error: providerError });
    return fail("error");
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    console.warn("auth.google.callback.missing_parameters", { hasCode: !!code, hasState: !!state });
    return fail("error");
  }

  const stored = readOAuthStateCookie(c.req.header("Cookie") ?? null);
  if (!stored || stored.state !== state) {
    console.warn("auth.google.callback.invalid_state", { hasStateCookie: !!stored });
    return fail("error");
  }

  let identity: { email: string; sub: string; name: string | null; picture: string | null };
  try {
    identity = await exchangeCodeForIdentity(c.env, code, googleRedirectUri(c), stored.codeVerifier);
  } catch (error) {
    console.error("auth.google.callback.exchange_failed", {
      message: error instanceof Error ? error.message : "Unknown token exchange error"
    });
    return fail("error");
  }

  let result: Awaited<ReturnType<typeof authorizeIdentity>>;
  try {
    result = await authorizeIdentity(
      c.env,
      { provider: "google", subject: identity.sub, email: identity.email },
      async () => identity
    );
  } catch (error) {
    console.error("auth.google.callback.authorization_failed", {
      message: error instanceof Error ? error.message : "Unknown authorization error"
    });
    return fail("error");
  }
  if (!result.ok) return fail(result.reason === "subject_conflict" ? "conflict" : "denied", result.email);

  const token = await issueSessionToken(c.env, result.user.id);
  c.header("Set-Cookie", buildSessionCookie(token, secure));
  c.header("Set-Cookie", clearOAuthCookie, { append: true });
  return c.redirect("/", 302);
});

// Local-dev-only fallback: doesn't need a registered Google OAuth redirect
// URI, useful when testing against a URL Google hasn't been told about.
authRouter.post("/login", async (c) => {
  // Check trusted deployment bindings before parsing the request or touching
  // D1. In particular, do not use URL scheme, Host, or client headers as a
  // proxy for whether this Worker is local.
  if (c.env.AUTH_MODE !== "cookie" || !isDevPasswordLoginEnabled(c.env)) {
    return c.json({ error: "Not found" }, 404);
  }

  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => null);
  if (!body?.email || !body.password) {
    return c.json({ error: "email and password are required" }, 400);
  }

  const email = body.email.toLowerCase();
  const row = await c.env.DB.prepare(
    "SELECT id, email, role, status, display_name, avatar_url, password_hash FROM users WHERE email = ?"
  )
    .bind(email)
    .first<UserRow>();

  if (!row || !row.password_hash || row.status === "revoked" || !(await verifyPassword(body.password, row.password_hash))) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE users SET status = 'active', last_login_at = ? WHERE id = ?").bind(now, row.id).run();

  const token = await issueSessionToken(c.env, row.id);
  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", buildSessionCookie(token, secure));
  return c.json({ user: { id: row.id, email: row.email, role: row.role, displayName: row.display_name, avatarUrl: row.avatar_url } });
});

// Signing out ends every session of the account, not only this browser's
// (issue #46): a stateless token cannot be withdrawn on its own, so the
// account's session version moves on and every token minted before it is
// refused. Only a token that is still current can do that, so an old copied
// token cannot be used to sign the account out elsewhere. MCP tokens are
// separate credentials and are not affected.
authRouter.post("/logout", async (c) => {
  const secure = new URL(c.req.url).protocol === "https:";
  const token = c.env.AUTH_MODE === "cookie" ? readSessionCookie(c.req.header("Cookie") ?? null) : null;
  const session = token ? await verifySessionToken(token, c.env) : null;
  if (session) {
    const row = await c.env.DB.prepare(
      "UPDATE users SET session_version = session_version + 1 WHERE id = ? AND session_version = ? RETURNING id, email"
    )
      .bind(session.userId, session.sessionVersion)
      .first<{ id: string; email: string }>();
    if (row) await invalidateCachedUser(c.env, row.id, row.email);
  }
  c.header("Set-Cookie", clearSessionCookie(secure));
  return c.json({ ok: true });
});

authRouter.get("/me", requireAccessUser, (c) => c.json({ user: c.get("user") }));
