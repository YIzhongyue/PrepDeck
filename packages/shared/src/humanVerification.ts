// Cloudflare Turnstile human verification on abuse-prone requests
// (issue #82). The Worker verifies every token with Cloudflare's Siteverify
// (apps/worker/src/lib/turnstile.ts); the browser only obtains one
// (apps/web/src/components/TurnstileWidget.tsx) and sends it along.

/** The header a fetch() request carries its Turnstile token in. */
export const TURNSTILE_TOKEN_HEADER = "X-Turnstile-Token";

/** The field a native form POST carries it in: the widget's own default name. */
export const TURNSTILE_FORM_FIELD = "cf-turnstile-response";

/**
 * One action per protected surface. The widget stamps it into the token and
 * the Worker refuses a token solved for a different surface.
 */
export const TURNSTILE_ACTIONS = {
  signIn: "sign_in",
  mcpToken: "mcp_token",
} as const;

export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];

/** GET /api/auth/turnstile. `siteKey` is null when the deployment does not use Turnstile. */
export interface TurnstileConfigResponse {
  siteKey: string | null;
}

/** The `code` of every response refused for want of a valid token. */
export const TURNSTILE_ERROR_CODE = "human_verification_failed";
