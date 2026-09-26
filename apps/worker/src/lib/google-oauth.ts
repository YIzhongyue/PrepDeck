// Direct Google OAuth 2.0 (Authorization Code + PKCE) — the primary sign-in
// path (docs/requirements/authentication-and-users.md / FR-1.1), used instead of Cloudflare Access so the app
// can present its own custom-designed login page (screens/Login.tsx) rather
// than Access's hosted one. See routes/auth.ts for the /google/start and
// /google/callback handlers that drive this.

import { safeReturnTo } from "./returnTo";
import type { Env } from "../bindings";
import { verifyRs256Jwt } from "./jwt-verify";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBase64Url(byteLength: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

export function buildGoogleAuthUrl(env: Env, redirectUri: string, state: string, codeChallenge: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Always show the account chooser rather than silently reusing whichever
  // Google session happens to be active in the browser — a shared/kiosk
  // machine shouldn't sign a user into the last person's PrepDeck account.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

interface GoogleTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleIdentity {
  email: string;
  sub: string;
  name: string | null;
  picture: string | null;
}

// Exchanges the authorization code for an id_token and verifies it against
// Google's published JWKS (signature, expiry, issuer, audience — FR-1.6's
// direct-OAuth equivalent), then extracts the OIDC claims we need.
export async function exchangeCodeForIdentity(
  env: Env,
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<GoogleIdentity> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  const json = (await res.json().catch(() => null)) as GoogleTokenResponse | null;
  if (!res.ok || !json?.id_token) {
    throw new Error(json?.error_description || json?.error || `Token exchange failed (${res.status})`);
  }

  const payload = await verifyRs256Jwt(
    json.id_token,
    { jwksUrl: JWKS_URL, jwksCacheKey: "google_oauth_jwks", issuer: ISSUERS, audience: env.GOOGLE_CLIENT_ID },
    env
  );

  if (typeof payload.email !== "string" || !payload.email) throw new Error("Missing email claim");
  if (payload.email_verified !== true) throw new Error("Google email is not verified");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("Missing sub claim");

  return {
    email: payload.email,
    sub: payload.sub,
    name: typeof payload.name === "string" && payload.name ? payload.name : null,
    picture: typeof payload.picture === "string" && payload.picture ? payload.picture : null
  };
}

// Short-lived cookie carrying the CSRF `state` and PKCE `code_verifier`
// across the redirect to Google and back. Not HMAC-signed like the real
// session cookie (session.ts) — a tampered value only ever fails the state
// comparison in /google/callback and aborts the login, since the final
// identity always comes from Google's independently-verified id_token, never
// from anything read out of this cookie.
const OAUTH_COOKIE_NAME = "pd_oauth";
const OAUTH_COOKIE_TTL_SECONDS = 10 * 60;

export function buildOAuthStateCookie(state: string, codeVerifier: string, secure: boolean, returnTo: string | null = null): string {
  const value = encodeURIComponent(JSON.stringify({ state, codeVerifier, ...(returnTo ? { returnTo } : {}) }));
  return `${OAUTH_COOKIE_NAME}=${value}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=${OAUTH_COOKIE_TTL_SECONDS}`;
}

export function readOAuthStateCookie(cookieHeader: string | null): { state: string; codeVerifier: string; returnTo: string | null } | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== OAUTH_COOKIE_NAME) continue;
    try {
      const parsed = JSON.parse(decodeURIComponent(part.slice(eq + 1).trim())) as { state?: unknown; codeVerifier?: unknown; returnTo?: unknown };
      if (typeof parsed.state === "string" && typeof parsed.codeVerifier === "string") {
        // Re-validated on the way out: this cookie is not signed.
        return { state: parsed.state, codeVerifier: parsed.codeVerifier, returnTo: safeReturnTo(parsed.returnTo) };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function clearOAuthStateCookie(secure: boolean): string {
  return `${OAUTH_COOKIE_NAME}=; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=0`;
}
