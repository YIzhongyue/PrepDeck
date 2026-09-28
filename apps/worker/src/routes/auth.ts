// docs/requirements/authentication-and-users.md — sign-in. The primary path is direct Google OAuth
// (/google/start, /google/callback), so the app can present its own
// custom-designed login page (screens/Login.tsx) instead of Cloudflare
// Access's hosted one. Email+password (/login) remains as a local-dev-only
// fallback that doesn't need a registered OAuth redirect URI. /me is gated
// by the normal auth middleware, so it doubles as a "is my session still
// valid" check for the frontend's login gate. When the deployment uses
// Cloudflare Turnstile (issue #82, lib/turnstile.ts), starting Google sign-in
// requires a verified token; /turnstile tells the login screen whether it does.

import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { TURNSTILE_ACTIONS, TURNSTILE_FORM_FIELD, type TurnstileConfigResponse } from "@prepdeck/shared";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAccessUser } from "../middleware/access";
import { turnstileRemoteIp, turnstileSiteKey, verifyTurnstileToken, type TurnstileFailure } from "../lib/turnstile";
import { verifyPassword } from "../lib/password";
import { isDevPasswordLoginEnabled } from "../lib/devPasswordLogin";
import { issueSessionToken, buildSessionCookie, clearSessionCookie, readSessionCookie, verifySessionToken } from "../lib/session";
import { invalidateCachedUser } from "../lib/userCache";
import { safeReturnTo } from "../lib/returnTo";
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

// The Turnstile site key the login screen renders its widget with (issue
// #82), or null when this deployment does not ask for human verification.
// Public and storage-free: the login screen needs it before anyone is signed in.
authRouter.get("/turnstile", (c) => {
  const body: TurnstileConfigResponse = { siteKey: turnstileSiteKey(c.env) };
  return c.json(body, 200, { "Cache-Control": "no-store" });
});

// The `?auth=` flag the login screen explains a refused check with. Only a
// missing or rejected token is the visitor's to fix by verifying again.
const VERIFICATION_FLAGS: Record<TurnstileFailure, string> = {
  missing: "verification",
  rejected: "verification",
  unavailable: "verification-unavailable",
  misconfigured: "verification-misconfigured",
};

// `returnTo` with the `?auth=` flag the login screen reports `reason` from.
function withAuthFlag(returnTo: string | null, reason: string): string {
  const url = new URL(returnTo ?? "/", "https://prepdeck.invalid");
  url.searchParams.set("auth", reason);
  return `${url.pathname}${url.search}`;
}

// Kicks off the OAuth round trip: stash a CSRF `state` + PKCE `code_verifier`
// in a short-lived cookie, then send the browser to Google's consent screen.
//
// The login screen submits a form POST carrying `returnTo` and, when the
// deployment uses Turnstile (issue #82), the widget's token. That token is
// redeemed here, before the state cookie exists, so the callback — which is
// what does the D1 and Google work — cannot complete without a human having
// passed the check. GET remains for deployments without Turnstile; with it,
// a GET (an old tab, a bookmarked link) is sent back to the login screen.
async function startGoogleSignIn(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  input: { returnTo: unknown; turnstileToken: unknown },
) {
  // The direct OAuth callback creates a PrepDeck session cookie. Access mode
  // deliberately ignores that cookie and requires Cf-Access-Jwt-Assertion,
  // so allowing this flow in Access mode can only end in a confusing 401.
  if (c.env.AUTH_MODE !== "cookie") {
    console.error("auth.google.start.invalid_mode", { authMode: c.env.AUTH_MODE });
    return c.json({ error: "Direct Google sign-in requires AUTH_MODE=cookie" }, 503);
  }

  // Where to land after signing in (issues #41 and #52): the page a signed-out
  // learner opened, for example from a review email. Same-origin paths only.
  const returnTo = safeReturnTo(input.returnTo);
  // A GET answers 302 as it always has; a form POST answers 303 so the
  // browser follows it with a GET.
  const redirectStatus = c.req.method === "POST" ? 303 : 302;

  if (turnstileSiteKey(c.env)) {
    if (c.req.method !== "POST") return c.redirect(returnTo ?? "/", 302);
    const verdict = await verifyTurnstileToken(c.env, input.turnstileToken, TURNSTILE_ACTIONS.signIn, turnstileRemoteIp(c.req.raw.headers));
    if (!verdict.ok) return c.redirect(withAuthFlag(returnTo, VERIFICATION_FLAGS[verdict.reason]), 303);
  }

  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await pkceChallengeFromVerifier(codeVerifier);

  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", await buildOAuthStateCookie(c.env, state, codeVerifier, secure, returnTo));

  const redirectUri = googleRedirectUri(c);
  console.info("auth.google.start", { redirectUri });
  return c.redirect(buildGoogleAuthUrl(c.env, redirectUri, state, codeChallenge), redirectStatus);
}

authRouter.get("/google/start", (c) => startGoogleSignIn(c, { returnTo: c.req.query("returnTo"), turnstileToken: null }));

authRouter.post(
  "/google/start",
  // Two short fields; refuse anything larger before it is buffered.
  bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: "Request body too large" }, 413) }),
  async (c) => {
    const form = await c.req.parseBody().catch(() => null);
    const field = (name: string) => (typeof form?.[name] === "string" ? form[name] : null);
    return startGoogleSignIn(c, { returnTo: field("returnTo"), turnstileToken: field(TURNSTILE_FORM_FIELD) });
  },
);

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

  // Signed and expiring (issue #82): a cookie this Worker did not issue from
  // /google/start, where Turnstile is checked, is refused here.
  const stored = await readOAuthStateCookie(c.env, c.req.header("Cookie") ?? null);
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
  return c.redirect(stored.returnTo ?? "/", 302);
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
