// implementation — cryptographically signed, scoped one-click unsubscribe token
// for the daily review email. Mirrors lib/session.ts's HMAC pattern
// (deliberately no external JWT dependency — verification never needs to
// happen anywhere but this Worker) but reuses SESSION_SECRET with a distinct
// signed payload prefix, so a session cookie can never be replayed as an
// unsubscribe link or vice versa. No expiry: the link should keep working
// for as long as the email that contains it might still be read.

import type { Env } from "../bindings";

const PURPOSE = "daily-email-unsub.v1";

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

export async function createUnsubscribeToken(userId: string, env: Env): Promise<string> {
  const payload = `${PURPOSE}.${userId}`;
  const key = await hmacKey(env);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyUnsubscribeToken(token: string, env: Env): Promise<{ userId: string } | null> {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const signatureB64 = token.slice(lastDot + 1);

  const key = await hmacKey(env);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(signatureB64), new TextEncoder().encode(payload));
  } catch {
    return null;
  }
  if (!valid) return null;

  const prefix = `${PURPOSE}.`;
  if (!payload.startsWith(prefix)) return null;
  const userId = payload.slice(prefix.length);
  if (!userId) return null;
  return { userId };
}
