import type { MiddlewareHandler } from "hono";
import { TURNSTILE_ERROR_CODE, TURNSTILE_TOKEN_HEADER, type TurnstileAction } from "@prepdeck/shared";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { turnstileRefusal, turnstileRemoteIp, turnstileSiteKey, verifyTurnstileToken } from "../lib/turnstile";

/**
 * Opts a JSON endpoint into human verification (issue #82): while the
 * deployment has a Turnstile site key, the request must carry a token for
 * `action` in the X-Turnstile-Token header, or it is refused before the
 * handler runs. Mount it on the specific routes that need it, never globally.
 */
export function requireTurnstile(action: TurnstileAction): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    if (!turnstileSiteKey(c.env)) return next();
    const verdict = await verifyTurnstileToken(c.env, c.req.header(TURNSTILE_TOKEN_HEADER), action, turnstileRemoteIp(c.req.raw.headers));
    if (verdict.ok) return next();
    const { status, message } = turnstileRefusal(verdict.reason);
    return c.json({ error: message, code: TURNSTILE_ERROR_CODE }, status, { "Cache-Control": "no-store" });
  };
}
