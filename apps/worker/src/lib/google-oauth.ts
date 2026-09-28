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

// Short-lived cookie carrying the CSRF `state`, the PKCE `code_verifier` and
// where to land, across the redirect to Google and back. HMAC-signed with
// SESSION_SECRET under its own purpose prefix (as lib/unsubscribeToken.ts
// does), with its expiry inside the signed payload (issue #82). Only
// /google/start issues one, after it has checked Turnstile, so the callback's
// token exchange cannot be reached by writing a matching cookie by hand.
const OAUTH_COOKIE_NAME = "pd_oauth";
const OAUTH_COOKIE_TTL_SECONDS = 10 * 60;
const OAUTH_COOKIE_PURPOSE = "oauth-state.v1";

type SigningEnv = Pick<Env, "SESSION_SECRET">;

export interface OAuthState {
  state: string;
  codeVerifier: string;
  returnTo: string | null;
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function oauthStateKey(env: SigningEnv): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function buildOAuthStateCookie(env: SigningEnv, state: string, codeVerifier: string, secure: boolean, returnTo: string | null = null): Promise<string> {
  const claims = { state, codeVerifier, exp: Date.now() + OAUTH_COOKIE_TTL_SECONDS * 1000, ...(returnTo ? { returnTo } : {}) };
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await oauthStateKey(env), new TextEncoder().encode(`${OAUTH_COOKIE_PURPOSE}.${payload}`));
  const value = `${payload}.${toBase64Url(new Uint8Array(signature))}`;
  return `${OAUTH_COOKIE_NAME}=${value}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=${OAUTH_COOKIE_TTL_SECONDS}`;
}

/** The state this Worker issued, or null for a missing, unsigned, tampered or expired cookie. */
export async function readOAuthStateCookie(env: SigningEnv, cookieHeader: string | null): Promise<OAuthState | null> {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== OAUTH_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    const dot = value.lastIndexOf(".");
    const payload = value.slice(0, dot);
    const signature = value.slice(dot + 1);
    // 43 characters: an unpadded base64url SHA-256 HMAC, as in session.ts.
    if (dot < 0 || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
    const valid = await crypto.subtle.verify("HMAC", await oauthStateKey(env), fromBase64Url(signature), new TextEncoder().encode(`${OAUTH_COOKIE_PURPOSE}.${payload}`));
    if (!valid) return null;
    let claims: { state?: unknown; codeVerifier?: unknown; returnTo?: unknown; exp?: unknown };
    try {
      claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    } catch {
      return null;
    }
    if (typeof claims.state !== "string" || typeof claims.codeVerifier !== "string") return null;
    if (typeof claims.exp !== "number" || !(Date.now() < claims.exp)) return null;
    // Signed by us, but still re-validated on the way out, as any redirect target is.
    return { state: claims.state, codeVerifier: claims.codeVerifier, returnTo: safeReturnTo(claims.returnTo) };
  }
  return null;
}

export function clearOAuthStateCookie(secure: boolean): string {
  return `${OAUTH_COOKIE_NAME}=; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=0`;
}
