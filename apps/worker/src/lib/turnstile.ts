// Cloudflare Turnstile human verification (issue #82). The one place a token
// is checked: Google sign-in (routes/auth.ts) calls verifyTurnstileToken()
// directly because its token arrives in a form field, and JSON endpoints opt
// in with middleware/turnstile.ts, which reads it from a header.
//
// Verification is on while TURNSTILE_SITE_KEY is set. From then on it fails
// closed: no token, a token Siteverify refuses, a token solved for another
// action or hostname, a missing secret and an unreachable Siteverify all
// refuse the request. The verdict says which kind of failure it was, so the
// visitor is only asked to verify again when that can help. Neither the
// secret nor a token is ever logged.

import type { TurnstileAction } from "@prepdeck/shared";
import type { Env } from "../bindings";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// Cloudflare documents 2048 characters as the longest token it issues.
const MAX_TOKEN_LENGTH = 2048;
const SITEVERIFY_TIMEOUT_MS = 10_000;
// Siteverify codes that describe this deployment's secret rather than the
// visitor's token, and the one that describes Siteverify itself.
const CONFIGURATION_ERROR_CODES = new Set(["missing-input-secret", "invalid-input-secret"]);
const SERVICE_ERROR_CODES = new Set(["internal-error"]);

type TurnstileEnv = Partial<Pick<Env, "ENVIRONMENT" | "APP_BASE_URL" | "TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET_KEY" | "TURNSTILE_HOSTNAMES">>;

/**
 * - `missing`/`rejected`: the visitor has no valid token; a fresh check helps.
 * - `unavailable`: Siteverify could not answer; trying later helps.
 * - `misconfigured`: this deployment's secret or hostnames are wrong, or it
 *   runs on test keys outside development; only an administrator can help.
 */
export type TurnstileFailure = "missing" | "rejected" | "unavailable" | "misconfigured";
export type TurnstileVerdict = { ok: true } | { ok: false; reason: TurnstileFailure };

interface SiteverifyResult {
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
  "error-codes"?: unknown;
  metadata?: { result_with_testing_key?: unknown };
}

/** The public site key, or null when this deployment does not use Turnstile. */
export function turnstileSiteKey(env: TurnstileEnv): string | null {
  return env.TURNSTILE_SITE_KEY?.trim() || null;
}

function expectedHostnames(env: TurnstileEnv): Set<string> {
  const configured = (env.TURNSTILE_HOSTNAMES ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
  if (configured.length) return new Set(configured);
  try {
    return new Set([new URL(env.APP_BASE_URL ?? "").hostname]);
  } catch {
    return new Set();
  }
}

function errorCodes(result: SiteverifyResult): string[] {
  const codes = result["error-codes"];
  return Array.isArray(codes) ? codes.filter((code): code is string => typeof code === "string").slice(0, 5).map((code) => code.slice(0, 64)) : [];
}

/**
 * Redeems `token` with Siteverify. A token is single-use: whatever the
 * verdict, the widget that produced it must be reset before a retry.
 */
export async function verifyTurnstileToken(
  env: TurnstileEnv,
  token: unknown,
  action: TurnstileAction,
  remoteIp: string | null,
): Promise<TurnstileVerdict> {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    console.warn("turnstile.missing_token", { action });
    return { ok: false, reason: "missing" };
  }

  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  const hostnames = expectedHostnames(env);
  if (!secret || hostnames.size === 0) {
    console.error("turnstile.misconfigured", { action, hasSecret: !!secret, hasHostnames: hostnames.size > 0 });
    return { ok: false, reason: "misconfigured" };
  }

  let result: SiteverifyResult;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetch(SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Siteverify returned ${response.status}`);
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object") throw new Error("Siteverify returned no result");
    result = parsed as SiteverifyResult;
  } catch (error) {
    console.error("turnstile.siteverify_unavailable", {
      action,
      message: error instanceof Error ? error.message.slice(0, 200) : "Unknown Siteverify error",
    });
    return { ok: false, reason: "unavailable" };
  }

  if (result.success !== true) {
    const codes = errorCodes(result);
    if (codes.some((code) => CONFIGURATION_ERROR_CODES.has(code))) {
      console.error("turnstile.misconfigured", { action, errorCodes: codes });
      return { ok: false, reason: "misconfigured" };
    }
    if (codes.some((code) => SERVICE_ERROR_CODES.has(code))) {
      console.error("turnstile.siteverify_unavailable", { action, errorCodes: codes });
      return { ok: false, reason: "unavailable" };
    }
    console.warn("turnstile.rejected", { action, errorCodes: codes });
    return { ok: false, reason: "rejected" };
  }

  // Cloudflare's test secrets pass any token, for "example.com" and with no
  // action, so the two checks below cannot apply. They are for local
  // development only; anywhere else they would switch verification off.
  if (result.metadata?.result_with_testing_key === true) {
    if (env.ENVIRONMENT === "development") return { ok: true };
    console.error("turnstile.test_key_outside_development", { action });
    return { ok: false, reason: "misconfigured" };
  }

  if (result.action !== action) {
    console.warn("turnstile.action_mismatch", { action, tokenAction: typeof result.action === "string" ? result.action.slice(0, 32) : null });
    return { ok: false, reason: "rejected" };
  }
  const hostname = typeof result.hostname === "string" ? result.hostname.toLowerCase() : "";
  if (!hostnames.has(hostname)) {
    console.warn("turnstile.hostname_mismatch", { action, hostname: hostname.slice(0, 253) });
    return { ok: false, reason: "rejected" };
  }
  return { ok: true };
}

/** The client address Cloudflare saw, for Siteverify's optional `remoteip`. */
export function turnstileRemoteIp(headers: Headers): string | null {
  return headers.get("CF-Connecting-IP")?.trim() || null;
}

/** The status and JSON body a JSON endpoint refuses an unverified request with. */
export function turnstileRefusal(reason: TurnstileFailure): { status: 403 | 503; message: string } {
  if (reason === "misconfigured") return { status: 503, message: "Human verification isn't set up correctly on this server. Contact your admin." };
  if (reason === "unavailable") return { status: 503, message: "Human verification is unavailable right now. Try again in a few minutes." };
  if (reason === "missing") return { status: 403, message: "Complete the human verification check, then try again." };
  return { status: 403, message: "Human verification failed or expired. Complete the check again, then retry." };
}
