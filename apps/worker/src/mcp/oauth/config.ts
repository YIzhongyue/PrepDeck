// Issue #102 — MCP OAuth authorization: deployment switch, the URLs PrepDeck
// publishes as an OAuth authorization server and as two protected resources,
// token lifetimes, and the scope → tool mapping.
//
// PrepDeck is its own (embedded) authorization server. Google is only the
// upstream identity provider behind the existing website sign-in; Google
// tokens are never MCP credentials. Every URL here derives from the trusted
// APP_BASE_URL binding, never from request headers, matching mcp/routes.ts's
// origin check.

import { MCP_OAUTH_SCOPES, MCP_OAUTH_SCOPE_INFO, type McpOAuthScope } from "@prepdeck/shared";
import type { Tool } from "@modelcontextprotocol/server";
import type { Env } from "../../bindings";
import type { McpToolPolicy } from "../catalog";
import type { McpErrorCode } from "../errors";

export type McpAudience = "user" | "admin";

// Short-lived bearer access tokens; refresh tokens keep a connection alive
// without another interactive login. Each refresh issues a new refresh token
// with a fresh lifetime, so a client in regular use never has to reconnect,
// while an idle one does after REFRESH_TOKEN_TTL_MS.
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// A spent refresh token presented again within this window, by the client it
// was issued to, gets back the same successor pair its rotation issued — never
// a new one. When an access token expires, a client's parallel requests (the
// official MCP SDK's background GET stream and a tool call, for one) each get a
// 401 and each refresh with the token they hold; this keeps that idempotent.
// After the window, presenting a spent token revokes the grant.
export const REFRESH_TOKEN_REUSE_GRACE_MS = 10 * 1000;
export const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
export const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;

/** OAuth is opt-in per deployment. Off, PATs keep working and OAuth tokens are refused. */
export function isMcpOAuthEnabled(env: Pick<Env, "MCP_OAUTH_ENABLED">): boolean {
  return env.MCP_OAUTH_ENABLED === "true";
}

export const RESOURCE_PATHS: Record<McpAudience, string> = { user: "/mcp", admin: "/admin-mcp" };
export const RESOURCE_NAMES: Record<McpAudience, string> = { user: "PrepDeck User MCP", admin: "PrepDeck Admin MCP" };

export function oauthIssuer(env: Pick<Env, "APP_BASE_URL">): string {
  return new URL(env.APP_BASE_URL).origin;
}

export function resourceUrl(env: Pick<Env, "APP_BASE_URL">, audience: McpAudience): string {
  return `${oauthIssuer(env)}${RESOURCE_PATHS[audience]}`;
}

// RFC 9728 §3.1: the well-known segment goes between the host and the resource's path.
export function resourceMetadataUrl(env: Pick<Env, "APP_BASE_URL">, audience: McpAudience): string {
  return `${oauthIssuer(env)}/.well-known/oauth-protected-resource${RESOURCE_PATHS[audience]}`;
}

/** The audience an RFC 8707 `resource` value names, or null. One trailing slash is tolerated. */
export function audienceForResource(env: Pick<Env, "APP_BASE_URL">, resource: string): McpAudience | null {
  const normalized = resource.endsWith("/") ? resource.slice(0, -1) : resource;
  for (const audience of ["user", "admin"] as const) {
    if (normalized === resourceUrl(env, audience)) return audience;
  }
  return null;
}

export function audienceScopes(audience: McpAudience): McpOAuthScope[] {
  return MCP_OAUTH_SCOPES.filter((scope) => MCP_OAUTH_SCOPE_INFO[scope].audience === audience);
}

export function isMcpOAuthScope(value: string): value is McpOAuthScope {
  return (MCP_OAUTH_SCOPES as readonly string[]).includes(value);
}

/** Space-separated storage/wire form, in canonical order. */
export function formatScopes(scopes: readonly McpOAuthScope[]): string {
  return MCP_OAUTH_SCOPES.filter((scope) => scopes.includes(scope)).join(" ");
}

export function parseStoredScopes(value: string): McpOAuthScope[] {
  return value.split(" ").filter(isMcpOAuthScope);
}

/**
 * The scopes an authorization request asks for, for the audience its
 * resource names. Unknown scope names (a client's generic "openid", say) are
 * ignored rather than granted; none left means the audience's full set, which
 * the account's role still bounds. Clients may request the authorization
 * server's entire advertised scope list; retain only requested scopes for
 * the selected resource (RFC 6749 section 3.3). A request containing known
 * scopes but none for this audience is refused, never upgraded to defaults.
 * The route rejects mixed audiences without an explicit resource first.
 */
export function requestedScopes(raw: string | undefined, audience: McpAudience): McpOAuthScope[] | null {
  const known = (raw ?? "").split(" ").filter(isMcpOAuthScope);
  const allowed = audienceScopes(audience);
  if (!known.length) return allowed;
  const selected = allowed.filter((scope) => known.includes(scope));
  return selected.length ? selected : null;
}

/** The audience a scope string implies when a client sends no `resource`; null if it mixes both. */
export function audienceFromScopes(raw: string | undefined): McpAudience | null {
  const audiences = new Set((raw ?? "").split(" ").filter(isMcpOAuthScope).map((scope) => MCP_OAUTH_SCOPE_INFO[scope].audience));
  if (audiences.size > 1) return null;
  return audiences.has("admin") ? "admin" : "user";
}

/**
 * Scope → operation mapping, enforced on every call: a read scope allows the
 * tools annotated readOnlyHint: true, a write scope allows every tool of its
 * audience (write includes read). The annotations are required on every tool
 * (catalog.ts's McpToolAnnotations), so no tool can fall outside this mapping.
 */
export function toolRequiresWrite(definition: Tool): boolean {
  return definition.annotations?.readOnlyHint !== true;
}

export function scopePolicy(audience: McpAudience, scopes: readonly McpOAuthScope[]): McpToolPolicy {
  const [read, write] = audienceScopes(audience);
  const canWrite = scopes.includes(write!);
  const canRead = canWrite || scopes.includes(read!);
  return Object.freeze({ allows: (definition: Tool) => (toolRequiresWrite(definition) ? canWrite : canRead) });
}

/**
 * WWW-Authenticate for a refused MCP request. With OAuth on, a 401 names the
 * resource metadata (RFC 9728 §5.1) so an OAuth-capable client can begin
 * discovery, and an insufficient-scope 403 says which scopes to ask for
 * (RFC 6750 §3.1). With OAuth off the PAT-era challenge is unchanged.
 */
export function bearerChallenge(env: Pick<Env, "APP_BASE_URL" | "MCP_OAUTH_ENABLED">, audience: McpAudience, code: McpErrorCode, tokenPresented: boolean): string | null {
  if (code !== "unauthenticated" && code !== "insufficient_scope") return null;
  const parts = ['realm="PrepDeck MCP"'];
  if (code === "insufficient_scope") parts.push('error="insufficient_scope"');
  else if (tokenPresented) parts.push('error="invalid_token"');
  if (isMcpOAuthEnabled(env)) {
    parts.push(`resource_metadata="${resourceMetadataUrl(env, audience)}"`, `scope="${formatScopes(audienceScopes(audience))}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}
