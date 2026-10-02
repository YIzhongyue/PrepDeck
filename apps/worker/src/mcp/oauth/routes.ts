// Issue #102 — PrepDeck's OAuth 2.1 authorization server for MCP clients.
//
//   GET  /.well-known/oauth-protected-resource/mcp        RFC 9728, User MCP
//   GET  /.well-known/oauth-protected-resource/admin-mcp  RFC 9728, Admin MCP
//   GET  /.well-known/oauth-authorization-server          RFC 8414
//   GET  /api/oauth/authorize    authorization code + PKCE (S256) request
//   POST /api/oauth/token        code exchange and refresh-token rotation
//   POST /api/oauth/register     RFC 7591 dynamic client registration
//   POST /api/oauth/revoke       RFC 7009 token revocation
//   GET  /api/oauth/requests/:id            consent screen data   (browser session)
//   POST /api/oauth/requests/:id/approve    consent decision      (browser session)
//   POST /api/oauth/requests/:id/deny       consent decision      (browser session)
//
// The protocol endpoints never read a browser session; the three consent
// endpoints never accept anything but one (cookie or Access, via
// requireAccessUser). Signing in is the website's own Google sign-in,
// Turnstile included: /api/oauth/authorize hands the browser to the SPA's
// /connect screen, whose login gate returns to it with the ordinary safe
// `returnTo`. The authorization transaction itself travels only as an opaque
// request id plus a path-scoped binding cookie, never inside `returnTo`.

import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MCP_OAUTH_SCOPES, type McpAuthorizationDecisionResponse, type McpAuthorizationRequestView } from "@prepdeck/shared";
import type { Env } from "../../bindings";
import type { Variables } from "../../context";
import { requireAccessUser } from "../../middleware/access";
import { authenticatedRateLimit, consumeRateLimit } from "../../middleware/rateLimit";
import {
  RESOURCE_NAMES, audienceForResource, audienceFromScopes, audienceScopes, isMcpOAuthEnabled, oauthIssuer,
  requestedScopes, resourceUrl, type McpAudience,
} from "./config";
import { getStoredClient, redirectTarget, redirectUriAllowed, registerDynamicClient, resolveClient, validRedirectUri } from "./clients";
import {
  authorizationRedirect, createAuthorizationRequest, decideAuthorizationRequest, exchangeAuthorizationCode,
  getPendingAuthorizationRequest, refreshAccessToken, revokeByToken, validCodeChallenge, type TokenResult,
} from "./grants";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

// Public, credential-free protocol endpoints may be called from a browser-based
// MCP client. They set no cookies and read none, so any origin may call them.
// The authorize and consent endpoints are top-level navigations and same-origin
// SPA calls, and get no CORS headers.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "600",
};

const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });
const notEnabled = (c: AppContext) => c.json({ error: "not_found", error_description: "OAuth is not enabled on this server." }, 404, { ...CORS_HEADERS, "Cache-Control": "no-store" });

// --- Discovery ----------------------------------------------------------------

export const oauthWellKnownRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

oauthWellKnownRouter.options("*", preflight);

function protectedResourceMetadata(c: AppContext, audience: McpAudience) {
  if (!isMcpOAuthEnabled(c.env)) return notEnabled(c);
  return c.json({
    resource: resourceUrl(c.env, audience),
    authorization_servers: [oauthIssuer(c.env)],
    scopes_supported: audienceScopes(audience),
    bearer_methods_supported: ["header"],
    resource_name: RESOURCE_NAMES[audience],
  }, 200, { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" });
}

oauthWellKnownRouter.get("/oauth-protected-resource/mcp", (c) => protectedResourceMetadata(c, "user"));
oauthWellKnownRouter.get("/oauth-protected-resource/admin-mcp", (c) => protectedResourceMetadata(c, "admin"));

oauthWellKnownRouter.get("/oauth-authorization-server", (c) => {
  if (!isMcpOAuthEnabled(c.env)) return notEnabled(c);
  const issuer = oauthIssuer(c.env);
  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: [...MCP_OAUTH_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }, 200, { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" });
});

oauthWellKnownRouter.all("*", (c) => c.json({ error: "not_found" }, 404, CORS_HEADERS));

// --- Protocol endpoints -------------------------------------------------------

export const oauthRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const BINDING_COOKIE = "pd_mcp_authz";

function bindingCookie(c: AppContext, requestId: string, value: string, maxAgeSeconds: number): string {
  const secure = new URL(c.req.url).protocol === "https:";
  // Scoped to this request's consent endpoints, so concurrent authorizations
  // in one browser keep separate bindings and no other path ever sees it.
  return `${BINDING_COOKIE}=${value}; Path=/api/oauth/requests/${requestId}; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function readBindingCookie(c: AppContext): string | null {
  for (const part of (c.req.header("Cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === BINDING_COOKIE) {
      const value = part.slice(eq + 1).trim();
      return /^[a-f0-9]{64}$/.test(value) ? value : null;
    }
  }
  return null;
}

/** An authorization request we cannot safely redirect back to: the SPA explains it. */
function connectError(c: AppContext, reason: "invalid_client" | "invalid_redirect_uri" | "invalid_request" | "unavailable") {
  console.warn("mcp.oauth.authorize.refused", { reason });
  return c.redirect(`/connect?error=${reason}`, 302);
}

oauthRouter.get("/authorize", async (c) => {
  if (!isMcpOAuthEnabled(c.env)) return connectError(c, "unavailable");
  // RFC 6749 §3.1: parameters must not repeat. Checked before anything else
  // so an ambiguous client_id or redirect_uri is never acted on.
  const url = new URL(c.req.url);
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return connectError(c, "invalid_request");
  const param = (name: string) => url.searchParams.get(name) ?? undefined;

  const clientId = param("client_id");
  const client = clientId ? await resolveClient(c.env, clientId) : null;
  if (!client) return connectError(c, "invalid_client");
  // OAuth 2.1 lets a client with exactly one registered redirect URI omit it.
  const redirectUri = param("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !validRedirectUri(redirectUri) || !redirectUriAllowed(client.redirectUris, redirectUri)) {
    return connectError(c, "invalid_redirect_uri");
  }

  // From here on the redirect URI is trusted, so errors go back to the client.
  const issuer = oauthIssuer(c.env);
  const rawState = param("state");
  const state = rawState !== undefined && rawState.length <= 2048 ? rawState : null;
  const fail = (error: string, description: string) =>
    c.redirect(authorizationRedirect(redirectUri, { error, error_description: description, state }, issuer), 302);
  if (rawState !== undefined && state === null) return fail("invalid_request", "state is too long.");
  if (param("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  if (param("code_challenge_method") !== "S256" || !validCodeChallenge(param("code_challenge"))) {
    return fail("invalid_request", "PKCE is required: send a code_challenge with code_challenge_method=S256.");
  }
  const resource = param("resource");
  const audience = resource !== undefined ? audienceForResource(c.env, resource) : audienceFromScopes(param("scope"));
  if (!audience) {
    return resource !== undefined ? fail("invalid_target", "resource must be this server's /mcp or /admin-mcp URL.")
      : fail("invalid_scope", "A request may not mix User MCP and Admin MCP scopes.");
  }
  const scopes = requestedScopes(param("scope"), audience);
  if (!scopes) return fail("invalid_scope", "The requested scopes belong to a different MCP server than the resource.");

  const request = await createAuthorizationRequest(c.env.DB, {
    client, redirectUri, audience, scopes, state, codeChallenge: param("code_challenge")!,
  });
  c.header("Set-Cookie", bindingCookie(c, request.id, request.binding, Math.ceil((request.expiresAt - Date.now()) / 1000)));
  c.header("Cache-Control", "no-store");
  return c.redirect(`/connect?request=${request.id}`, 302);
});

function tokenResponse(c: AppContext, result: TokenResult) {
  const headers = { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache" };
  if (result.ok) return c.json(result.body, 200, headers);
  return c.json({ error: result.error, error_description: result.description }, result.error === "invalid_client" ? 401 : 400, headers);
}

/** Form fields, refusing a repeated parameter (RFC 6749 §3.2). */
async function readForm(c: AppContext): Promise<URLSearchParams | null> {
  if (c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") return null;
  const form = new URLSearchParams(await c.req.text());
  const keys = [...form.keys()];
  return new Set(keys).size === keys.length ? form : null;
}

// Public clients send client_id in the body; some send it as HTTP Basic with
// an empty secret instead. Either identifies the client; neither authenticates it.
function clientIdOf(c: AppContext, form: URLSearchParams): string | undefined {
  const fromBody = form.get("client_id") ?? undefined;
  const basic = /^Basic ([A-Za-z0-9+/=]+)$/.exec(c.req.header("Authorization") ?? "");
  if (!basic) return fromBody;
  let decoded: string;
  try { decoded = atob(basic[1]!); } catch { return fromBody; }
  const colon = decoded.indexOf(":");
  const fromHeader = decodeURIComponent(colon < 0 ? decoded : decoded.slice(0, colon));
  return fromBody === undefined || fromBody === fromHeader ? fromHeader : undefined;
}

const smallBody = (maxSize: number) => bodyLimit({
  maxSize, onError: (c) => c.json({ error: "invalid_request", error_description: "Request body too large." }, 413, CORS_HEADERS),
});

oauthRouter.options("/token", preflight);
oauthRouter.post("/token", smallBody(16 * 1024), async (c) => {
  if (!isMcpOAuthEnabled(c.env)) return notEnabled(c);
  const form = await readForm(c);
  if (!form) return tokenResponse(c, { ok: false, error: "invalid_request", description: "Send each parameter once, form-encoded." });
  const field = (name: string) => form.get(name) ?? undefined;
  const clientId = clientIdOf(c, form);
  switch (field("grant_type")) {
    case "authorization_code":
      return tokenResponse(c, await exchangeAuthorizationCode(c.env, {
        code: field("code"), clientId, redirectUri: field("redirect_uri"), codeVerifier: field("code_verifier"), resource: field("resource"),
      }));
    case "refresh_token":
      return tokenResponse(c, await refreshAccessToken(c.env, {
        refreshToken: field("refresh_token"), clientId, resource: field("resource"), scope: field("scope"),
      }));
    default:
      return c.json({ error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token." }, 400,
        { ...CORS_HEADERS, "Cache-Control": "no-store" });
  }
});

oauthRouter.options("/register", preflight);
// Registration is unauthenticated and writes a row, so besides the per-IP
// `auth` budget (middleware/rateLimit.ts) it has a deployment-wide one; unused
// registrations are deleted after 30 days (scheduled/pruneMcpOAuth.ts).
const REGISTRATIONS_PER_MINUTE = 60;

oauthRouter.post("/register", smallBody(8 * 1024), async (c) => {
  if (!isMcpOAuthEnabled(c.env)) return notEnabled(c);
  const budget = await consumeRateLimit(c.env, "oauth:register:global", { windowSeconds: 60, max: REGISTRATIONS_PER_MINUTE }).catch(() => null);
  if (!budget?.allowed) {
    return c.json({ error: "temporarily_unavailable", error_description: "Too many client registrations. Try again shortly." }, budget ? 429 : 503,
      { ...CORS_HEADERS, "Cache-Control": "no-store", "Retry-After": String(budget ? Math.max(1, Math.ceil(budget.retryAfter)) : 30) });
  }
  const metadata = await c.req.json().catch(() => null);
  const result = await registerDynamicClient(c.env.DB, metadata);
  const headers = { ...CORS_HEADERS, "Cache-Control": "no-store" };
  if (!result.ok) return c.json({ error: result.error, error_description: result.description }, 400, headers);
  return c.json(result.body, 201, headers);
});

oauthRouter.options("/revoke", preflight);
oauthRouter.post("/revoke", smallBody(8 * 1024), async (c) => {
  if (!isMcpOAuthEnabled(c.env)) return notEnabled(c);
  const form = await readForm(c);
  if (!form) return c.json({ error: "invalid_request" }, 400, CORS_HEADERS);
  // RFC 7009 §2.2: an unknown or foreign token is not an error.
  await revokeByToken(c.env.DB, { token: form.get("token") ?? undefined, clientId: clientIdOf(c, form) });
  return new Response(null, { status: 200, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });
});

// --- Consent (browser session) -----------------------------------------------

const consent = new Hono<{ Bindings: Env; Variables: Variables }>();
consent.use("*", async (c, next) => {
  if (!isMcpOAuthEnabled(c.env)) return c.json({ error: "OAuth is not enabled on this server." }, 404);
  await next();
});
consent.use("*", requireAccessUser);
consent.use("*", authenticatedRateLimit);

const EXPIRED = "This connection request has expired or was already answered. Return to your app and connect again.";

consent.get("/:id", async (c) => {
  const request = await getPendingAuthorizationRequest(c.env.DB, c.req.param("id"), readBindingCookie(c));
  const client = request ? await getStoredClient(c.env.DB, request.clientId) : null;
  if (!request || !client) return c.json({ error: EXPIRED }, 404, { "Cache-Control": "no-store" });
  const user = c.get("user");
  const view: McpAuthorizationRequestView = {
    id: request.id,
    client: { id: client.id, name: client.name, kind: client.kind, redirectTarget: redirectTarget(request.redirectUri) },
    audience: request.audience,
    resource: resourceUrl(c.env, request.audience),
    scopes: request.scopes,
    expiresAt: request.expiresAt,
    account: { email: user.email, role: user.role },
    eligible: request.audience === "user" || user.role === "admin",
  };
  return c.json(view, 200, { "Cache-Control": "no-store" });
});

async function decide(c: AppContext, approve: boolean) {
  // Same-origin SPA calls only. SameSite=Lax cookies already keep a cross-site
  // form from carrying the session or the binding; this refuses one outright.
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin && origin !== new URL(c.env.APP_BASE_URL).origin) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const id = c.req.param("id") ?? "";
  const result = await decideAuthorizationRequest(c.env.DB, { id, binding: readBindingCookie(c), userId: c.get("user").id, approve });
  c.header("Cache-Control", "no-store");
  // The binding has done its job either way.
  c.header("Set-Cookie", bindingCookie(c, id.replace(/[^a-f0-9]/g, ""), "", 0));
  if (!result.ok && result.reason === "not_found") return c.json({ error: EXPIRED }, 404);
  const { request } = result;
  const issuer = oauthIssuer(c.env);
  const denied = (description: string) =>
    authorizationRedirect(request.redirectUri, { error: "access_denied", error_description: description, state: request.state }, issuer);
  let body: McpAuthorizationDecisionResponse;
  if (result.ok && result.code) {
    console.info("mcp.oauth.consent.approved", { audience: request.audience });
    body = { redirectTo: authorizationRedirect(request.redirectUri, { code: result.code, state: request.state }, issuer) };
  } else if (result.ok) {
    body = { redirectTo: denied("The user denied the request.") };
  } else {
    // Approved by an account that may not grant this audience (an Admin MCP
    // request approved by a non-admin, or an account revoked meanwhile).
    body = { redirectTo: denied("This account is not allowed to grant the requested access.") };
  }
  return c.json(body);
}

consent.post("/:id/approve", (c) => decide(c, true));
consent.post("/:id/deny", (c) => decide(c, false));

oauthRouter.route("/requests", consent);
oauthRouter.all("*", (c) => c.json({ error: "not_found" }, 404));
