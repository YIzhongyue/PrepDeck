// Verifies a Cloudflare Access JWT (`Cf-Access-Jwt-Assertion` header) against
// Access's published JWKS — FR-1.6. Kept as an opt-in rollback path
// (AUTH_MODE = "access"); the primary login path is now direct Google OAuth,
// see lib/google-oauth.ts, which shares the RS256/JWKS mechanics below via
// lib/jwt-verify.ts.

import type { Env } from "../bindings";
import { verifyRs256Jwt } from "./jwt-verify";

export interface AccessIdentity {
  email: string;
  sub: string;
}

export interface AccessProfile {
  name: string | null;
  picture: string | null;
}

export async function verifyAccessJwt(token: string, env: Env): Promise<AccessIdentity> {
  const payload = await verifyRs256Jwt(
    token,
    {
      jwksUrl: `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`,
      jwksCacheKey: "cf_access_jwks",
      issuer: `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
      audience: env.CF_ACCESS_AUD
    },
    env
  );

  if (typeof payload.email !== "string" || !payload.email) throw new Error("Missing email claim");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("Missing sub claim");

  return { email: payload.email, sub: payload.sub };
}

// FR-12.1: the compact Access JWT above carries only email/sub, not the IdP's
// display name/photo, so first-sign-in profile init needs a second call —
// Access's own "get identity" endpoint, using the same JWT as a cookie —
// to read those from Google's OIDC claims. Best-effort only: this isn't
// exercised by AUTH_MODE = "cookie" and hasn't been verified against a live
// Access deployment, so every failure path (network error, unexpected
// shape) yields nulls rather than throwing — profile init must never block
// sign-in, and the caller already has an email-based fallback.
export async function fetchAccessProfile(assertion: string, env: Env): Promise<AccessProfile> {
  try {
    const res = await fetch(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/get-identity`, {
      headers: { Cookie: `CF_Authorization=${assertion}` }
    });
    if (!res.ok) return { name: null, picture: null };

    const identity = (await res.json()) as { name?: unknown; picture?: unknown; photos?: unknown };
    const name = typeof identity.name === "string" && identity.name ? identity.name : null;
    const picture =
      typeof identity.picture === "string" && identity.picture
        ? identity.picture
        : Array.isArray(identity.photos) && typeof identity.photos[0] === "string"
          ? (identity.photos[0] as string)
          : null;
    return { name, picture };
  } catch {
    return { name: null, picture: null };
  }
}
