// Shared RS256/JWKS JWT verification, used by both lib/access-jwt.ts
// (Cloudflare Access, kept as an opt-in rollback path) and lib/google-oauth.ts
// (the primary login path, docs/requirements/authentication-and-users.md). Both providers sign with RS256 and
// publish a standard JWKS endpoint, so the verification mechanics are
// identical — only the JWKS URL, issuer, and audience differ per caller.

import type { Env } from "../bindings";

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

interface Jwks {
  keys: Jwk[];
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function fetchJwks(jwksUrl: string, cacheKey: string, env: Env, bypassCache: boolean): Promise<Jwks> {
  if (!bypassCache) {
    const cached = await env.KV.get(cacheKey, "json");
    if (cached) return cached as Jwks;
  }

  const res = await fetch(jwksUrl);
  if (!res.ok) throw new Error(`Failed to fetch JWKS from ${jwksUrl} (${res.status})`);
  const jwks = (await res.json()) as Jwks;
  await env.KV.put(cacheKey, JSON.stringify(jwks), { expirationTtl: 3600 });
  return jwks;
}

export interface VerifyRs256JwtOptions {
  jwksUrl: string;
  jwksCacheKey: string;
  issuer: string | string[];
  audience: string;
}

// Verifies signature, expiry, issuer, and audience. Returns the decoded
// (but otherwise unvalidated) payload — callers are responsible for
// checking whatever claims they need beyond these (email, sub, etc.).
export async function verifyRs256Jwt(token: string, opts: VerifyRs256JwtOptions, env: Env): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64))) as { kid?: string; alg?: string };
  if (!header.kid) throw new Error("JWT header missing kid");

  let jwks = await fetchJwks(opts.jwksUrl, opts.jwksCacheKey, env, false);
  let jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Signing keys rotate periodically; bust the cache once and retry before failing.
    jwks = await fetchJwks(opts.jwksUrl, opts.jwksCacheKey, env, true);
    jwk = jwks.keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("Unknown signing key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(signatureB64);
  const isValid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedData);
  if (!isValid) throw new Error("Invalid JWT signature");

  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64))) as Record<string, unknown>;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) throw new Error("Token expired");

  const expectedIssuers = Array.isArray(opts.issuer) ? opts.issuer : [opts.issuer];
  if (typeof payload.iss !== "string" || !expectedIssuers.includes(payload.iss)) throw new Error("Unexpected issuer");

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(opts.audience)) throw new Error("Unexpected audience");

  return payload;
}
