// Signed session cookie for AUTH_MODE = "cookie" (see routes/auth.ts and
// middleware/access.ts) — established by Google OAuth or, locally,
// email+password login. Deliberately simple — no external JWT dependency,
// since verification never needs to happen anywhere but this Worker.
//
// Session lifecycle (issue #46): a token carries its user's session version
// (users.session_version, migration 0037). Signing out increments it, which
// ends every session of that account at once, and so does revoking the
// account; middleware/access.ts refuses a token whose version is no longer the
// account's. The signature alone cannot be withdrawn, so without the version a
// copied token stayed usable for its whole 7-day life after sign-out. Tokens
// from before the version existed have no "v2" marker and are refused: the
// cost of that cut-over is one extra sign-in.

import type { Env } from "../bindings";

const COOKIE_NAME = "pd_session";
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

const TOKEN_FORMAT = "v2";

export interface SessionClaims {
  userId: string;
  sessionVersion: number;
}

export async function createSessionToken(userId: string, sessionVersion: number, env: Env): Promise<string> {
  const payload = `${TOKEN_FORMAT}.${userId}.${sessionVersion}.${Date.now() + TTL_SECONDS * 1000}`;
  const key = await hmacKey(env);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string, env: Env): Promise<SessionClaims | null> {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const signatureB64 = token.slice(lastDot + 1);
  // fromBase64Url throws on input that isn't base64url, which would surface as
  // a 500 rather than "not signed in" for an arbitrary cookie value. 43 chars
  // is the unpadded base64url length of the 32-byte SHA-256 HMAC signed below
  // (ceil(32 / 3) * 4 - 1); change both together if the digest ever changes.
  if (!/^[A-Za-z0-9_-]{43}$/.test(signatureB64)) return null;

  const key = await hmacKey(env);
  const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(signatureB64), new TextEncoder().encode(payload));
  if (!valid) return null;

  // v2.<userId>.<sessionVersion>.<expiresAtMs>, read from both ends so a dot
  // in a user id could never shift the fields.
  const parts = payload.split(".");
  if (parts.length < 4 || parts[0] !== TOKEN_FORMAT) return null;
  const expiresAt = Number(parts[parts.length - 1]);
  const sessionVersion = Number(parts[parts.length - 2]);
  const userId = parts.slice(1, -2).join(".");
  if (!userId || !Number.isSafeInteger(sessionVersion) || sessionVersion < 0 || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return { userId, sessionVersion };
}

/** A fresh session token for `userId`, at the account's current session version. */
export async function issueSessionToken(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT session_version FROM users WHERE id = ?").bind(userId).first<{ session_version: number }>();
  return createSessionToken(userId, row?.session_version ?? 0, env);
}

export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// `secure` should be false only for plain-http local dev (`wrangler dev` /
// the Vite proxy) — browsers won't store a `Secure` cookie set over http.
export function buildSessionCookie(token: string, secure: boolean): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=${TTL_SECONDS}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=0`;
}
