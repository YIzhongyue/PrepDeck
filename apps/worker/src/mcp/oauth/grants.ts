// Issue #102 — the OAuth grant lifecycle: authorization transactions, the
// consent decision, single-use authorization codes, access/refresh tokens,
// refresh rotation with replay detection, revocation and the listing Settings
// shows. All secrets are opaque random values stored as SHA-256 digests,
// exactly like PATs (credentials.ts), so a database read never yields a
// usable credential. Opaque rather than signed tokens: every MCP request
// already reads D1 for the account's current status and role, so a lookup
// costs nothing extra and revocation takes effect on the next request with no
// signing keys to rotate.

import { MCP_OAUTH_SCOPE_INFO, type McpOAuthGrantSummary, type McpOAuthScope } from "@prepdeck/shared";
import type { Env } from "../../bindings";
import { hashMcpToken } from "../credentials";
import {
  ACCESS_TOKEN_TTL_MS, AUTHORIZATION_CODE_TTL_MS, AUTHORIZATION_REQUEST_TTL_MS, REFRESH_TOKEN_REUSE_GRACE_MS, REFRESH_TOKEN_TTL_MS,
  formatScopes, parseStoredScopes, resourceUrl, type McpAudience,
} from "./config";
import type { OAuthClient } from "./clients";

const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");

// Distinct prefixes from PATs (pd_mcp_<audience>_) so the MCP endpoint routes
// each bearer value to exactly one verifier, and a secret scanner can tell
// them apart. The audience is in the access token for the same early refusal
// a PAT gets; the database row is still what decides.
export const OAUTH_ACCESS_TOKEN = /^pd_oat_(user|admin)_[a-f0-9]{64}$/;
const OAUTH_REFRESH_TOKEN = /^pd_ort_(user|admin)_[a-f0-9]{64}$/;
const OAUTH_CODE = /^pd_oac_[a-f0-9]{64}$/;
// RFC 7636 §4.1.
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function validCodeChallenge(value: string | undefined): boolean {
  return !!value && PKCE_CHALLENGE.test(value);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- Authorization transactions ---------------------------------------------

export interface AuthorizationRequest {
  id: string;
  clientId: string;
  redirectUri: string;
  audience: McpAudience;
  scopes: McpOAuthScope[];
  state: string | null;
  expiresAt: number;
}

interface RequestRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  audience: McpAudience;
  scopes: string;
  state: string | null;
  code_challenge: string;
  expires_at: number;
}

const toRequest = (row: RequestRow): AuthorizationRequest => ({
  id: row.id, clientId: row.client_id, redirectUri: row.redirect_uri, audience: row.audience,
  scopes: parseStoredScopes(row.scopes), state: row.state, expiresAt: row.expires_at,
});

/**
 * Records a validated authorization request. Returns its id and the browser
 * binding secret the caller puts in a cookie; only its digest is stored, so
 * the consent decision can only be made from the browser that started it.
 */
export async function createAuthorizationRequest(db: D1Database, input: {
  client: OAuthClient; redirectUri: string; audience: McpAudience; scopes: McpOAuthScope[]; state: string | null; codeChallenge: string;
}): Promise<{ id: string; binding: string; expiresAt: number }> {
  const id = randomHex(16);
  const binding = randomHex(32);
  const now = Date.now();
  const expiresAt = now + AUTHORIZATION_REQUEST_TTL_MS;
  await db.prepare(`
    INSERT INTO mcp_oauth_requests (id, client_id, redirect_uri, audience, scopes, state, code_challenge, browser_binding_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, input.client.id, input.redirectUri, input.audience, formatScopes(input.scopes), input.state,
    input.codeChallenge, await hashMcpToken(binding), now, expiresAt).run();
  return { id, binding, expiresAt };
}

/** A pending (undecided, unexpired) request this browser started, or null. */
export async function getPendingAuthorizationRequest(db: D1Database, id: string, binding: string | null): Promise<AuthorizationRequest | null> {
  if (!binding || !/^[a-f0-9]{32}$/.test(id)) return null;
  const row = await db.prepare(`
    SELECT id, client_id, redirect_uri, audience, scopes, state, code_challenge, expires_at FROM mcp_oauth_requests
    WHERE id = ? AND browser_binding_hash = ? AND decided_at IS NULL AND expires_at > ?
  `).bind(id, await hashMcpToken(binding), Date.now()).first<RequestRow>();
  return row ? toRequest(row) : null;
}

/** The client's redirect URI with RFC 6749 §4.1.2 parameters and the RFC 9207 issuer. */
export function authorizationRedirect(redirectUri: string, params: Record<string, string | null>, issuer: string): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

export type DecisionResult =
  | { ok: true; request: AuthorizationRequest; code: string | null }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_eligible"; request: AuthorizationRequest };

/**
 * Decides a pending request exactly once. The compare-and-swap on
 * `decided_at IS NULL` makes the decision atomic: of two concurrent approvals
 * (or an approval racing a denial) exactly one wins. An approval then creates
 * the grant — re-checking in the INSERT itself that the account is active and,
 * for Admin MCP, an administrator — and a single-use authorization code bound
 * to the client, redirect URI, PKCE challenge, grant (user, audience, scopes).
 */
export async function decideAuthorizationRequest(db: D1Database, input: {
  id: string; binding: string | null; userId: string; approve: boolean;
}): Promise<DecisionResult> {
  if (!input.binding || !/^[a-f0-9]{32}$/.test(input.id)) return { ok: false, reason: "not_found" };
  const now = Date.now();
  const row = await db.prepare(`
    UPDATE mcp_oauth_requests SET decided_at = ?, decision = ?, user_id = ?
    WHERE id = ? AND browser_binding_hash = ? AND decided_at IS NULL AND expires_at > ?
    RETURNING id, client_id, redirect_uri, audience, scopes, state, code_challenge, expires_at
  `).bind(now, input.approve ? "approved" : "denied", input.userId, input.id, await hashMcpToken(input.binding), now)
    .first<RequestRow>();
  if (!row) return { ok: false, reason: "not_found" };
  const request = toRequest(row);
  if (!input.approve) return { ok: true, request, code: null };

  const grantId = crypto.randomUUID();
  const code = `pd_oac_${randomHex(32)}`;
  const [grant] = await db.batch([
    db.prepare(`
      INSERT INTO mcp_oauth_grants (id, user_id, client_id, audience, scopes, created_at)
      SELECT ?, id, ?, ?, ?, ? FROM users WHERE id = ? AND status = 'active' AND (? = 'user' OR role = 'admin')
    `).bind(grantId, row.client_id, row.audience, row.scopes, now, input.userId, row.audience),
    db.prepare(`
      INSERT INTO mcp_oauth_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, created_at, expires_at)
      SELECT ?, id, ?, ?, ?, ?, ? FROM mcp_oauth_grants WHERE id = ?
    `).bind(await hashMcpToken(code), row.client_id, row.redirect_uri, row.code_challenge, now, now + AUTHORIZATION_CODE_TTL_MS, grantId),
  ]);
  if (grant!.meta.changes !== 1) return { ok: false, reason: "not_eligible", request };
  return { ok: true, request, code };
}

// --- Token endpoint ----------------------------------------------------------

export type TokenError = "invalid_request" | "invalid_client" | "invalid_grant" | "invalid_scope" | "invalid_target" | "unauthorized_client";

export type TokenResult =
  | { ok: true; body: { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string } }
  | { ok: false; error: TokenError; description: string };

interface GrantRow {
  id: string;
  user_id: string;
  client_id: string;
  audience: McpAudience;
  scopes: string;
  revoked_at: number | null;
  role: string;
  status: string;
}

async function loadGrant(db: D1Database, grantId: string): Promise<GrantRow | null> {
  return db.prepare(`
    SELECT g.id, g.user_id, g.client_id, g.audience, g.scopes, g.revoked_at, u.role, u.status
    FROM mcp_oauth_grants g JOIN users u ON u.id = g.user_id WHERE g.id = ?
  `).bind(grantId).first<GrantRow>();
}

const grantUsable = (grant: GrantRow) =>
  grant.revoked_at === null && grant.status === "active" && (grant.audience === "user" || grant.role === "admin");

export type GrantRevocationReason = "user" | "client" | "code_replay" | "refresh_replay";

async function revokeGrantById(db: D1Database, grantId: string, reason: GrantRevocationReason): Promise<boolean> {
  const result = await db.prepare("UPDATE mcp_oauth_grants SET revoked_at = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(Date.now(), reason, grantId).run();
  return result.meta.changes === 1;
}

async function issueTokens(db: D1Database, grant: GrantRow): Promise<TokenResult> {
  const now = Date.now();
  const accessToken = `pd_oat_${grant.audience}_${randomHex(32)}`;
  const refreshToken = `pd_ort_${grant.audience}_${randomHex(32)}`;
  const insert = "INSERT INTO mcp_oauth_tokens (id, grant_id, kind, token_hash, created_at, expires_at) SELECT ?, id, ?, ?, ?, ? FROM mcp_oauth_grants WHERE id = ? AND revoked_at IS NULL";
  const [access, refresh] = await db.batch([
    db.prepare(insert).bind(crypto.randomUUID(), "access", await hashMcpToken(accessToken), now, now + ACCESS_TOKEN_TTL_MS, grant.id),
    db.prepare(insert).bind(crypto.randomUUID(), "refresh", await hashMcpToken(refreshToken), now, now + REFRESH_TOKEN_TTL_MS, grant.id),
  ]);
  if (access!.meta.changes !== 1 || refresh!.meta.changes !== 1) {
    return { ok: false, error: "invalid_grant", description: "This authorization has been revoked. Reconnect the client." };
  }
  return {
    ok: true,
    body: {
      access_token: accessToken, token_type: "Bearer", expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken, scope: grant.scopes,
    },
  };
}

function checkResource(env: Pick<Env, "APP_BASE_URL">, grant: GrantRow, resource: string | undefined): TokenResult | null {
  if (resource === undefined) return null;
  const expected = resourceUrl(env, grant.audience);
  return resource === expected || resource === `${expected}/` ? null
    : { ok: false, error: "invalid_target", description: "The resource does not match the one this authorization was granted for." };
}

const REAUTHORIZE = "Start the authorization again from the client.";

/**
 * RFC 6749 §4.1.3 + RFC 7636 §4.6. The code is claimed atomically before
 * anything else is checked, so it can be redeemed at most once even under
 * concurrent requests; a failed check still spends it. Presenting an already
 * redeemed code revokes the grant it produced (RFC 6749 §4.1.2), since one of
 * the two presenters is not the legitimate client.
 */
export async function exchangeAuthorizationCode(env: Pick<Env, "DB" | "APP_BASE_URL">, input: {
  code: string | undefined; clientId: string | undefined; redirectUri: string | undefined; codeVerifier: string | undefined; resource: string | undefined;
}): Promise<TokenResult> {
  const { code, clientId, redirectUri, codeVerifier } = input;
  if (!code || !clientId || !redirectUri || !codeVerifier) {
    return { ok: false, error: "invalid_request", description: "code, client_id, redirect_uri and code_verifier are required." };
  }
  if (!OAUTH_CODE.test(code)) return { ok: false, error: "invalid_grant", description: `The authorization code is not valid. ${REAUTHORIZE}` };
  const db = env.DB;
  const codeHash = await hashMcpToken(code);
  const now = Date.now();
  const claimed = await db.prepare(`
    UPDATE mcp_oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL
    RETURNING grant_id, client_id, redirect_uri, code_challenge, expires_at
  `).bind(now, codeHash).first<{ grant_id: string; client_id: string; redirect_uri: string; code_challenge: string; expires_at: number }>();
  if (!claimed) {
    const spent = await db.prepare("SELECT grant_id FROM mcp_oauth_codes WHERE code_hash = ?").bind(codeHash).first<{ grant_id: string }>();
    if (spent) await revokeGrantById(db, spent.grant_id, "code_replay");
    return { ok: false, error: "invalid_grant", description: `The authorization code is not valid or was already used. ${REAUTHORIZE}` };
  }
  if (claimed.expires_at <= now) return { ok: false, error: "invalid_grant", description: `The authorization code expired. ${REAUTHORIZE}` };
  if (claimed.client_id !== clientId) return { ok: false, error: "invalid_grant", description: "The authorization code was issued to a different client." };
  if (claimed.redirect_uri !== redirectUri) return { ok: false, error: "invalid_grant", description: "redirect_uri does not match the authorization request." };
  if (!PKCE_VERIFIER.test(codeVerifier) || await pkceChallenge(codeVerifier) !== claimed.code_challenge) {
    return { ok: false, error: "invalid_grant", description: "The PKCE code_verifier does not match the code_challenge." };
  }
  const grant = await loadGrant(db, claimed.grant_id);
  if (!grant || !grantUsable(grant)) {
    return { ok: false, error: "invalid_grant", description: `This authorization is no longer valid for the account. ${REAUTHORIZE}` };
  }
  return checkResource(env, grant, input.resource) ?? issueTokens(db, grant);
}

/**
 * RFC 6749 §6 with OAuth 2.1 refresh-token rotation for public clients.
 *
 * The request is validated first, so a client that gets a parameter wrong
 * keeps its refresh token; then the token is spent with a compare-and-swap
 * and a new access and refresh token are issued. A spent refresh token
 * presented again is handled by how long ago it was spent:
 *
 *  - within REFRESH_TOKEN_REUSE_GRACE_MS, by the client it was issued to, it is
 *    a concurrent refresh (parallel requests that all saw the access token
 *    expire) and gets its own new pair, so a legitimate client is not
 *    disconnected by its own concurrency;
 *  - after that, it is a replay: the whole grant (the token family) is
 *    revoked, so a stolen refresh token stops working for the thief and the
 *    client alike, and the user recovers by reconnecting the client.
 *
 * Requested scope narrowing is not supported: tokens always carry the grant's
 * approved scopes, reported in `scope`.
 */
export async function refreshAccessToken(env: Pick<Env, "DB" | "APP_BASE_URL">, input: {
  refreshToken: string | undefined; clientId: string | undefined; resource: string | undefined; scope: string | undefined;
}): Promise<TokenResult> {
  const { refreshToken, clientId } = input;
  if (!refreshToken || !clientId) return { ok: false, error: "invalid_request", description: "refresh_token and client_id are required." };
  const invalid: TokenResult = { ok: false, error: "invalid_grant", description: `The refresh token is expired, revoked or was already used. ${REAUTHORIZE}` };
  if (!OAUTH_REFRESH_TOKEN.test(refreshToken)) return invalid;
  const db = env.DB;
  const tokenHash = await hashMcpToken(refreshToken);
  const now = Date.now();
  const token = await db.prepare("SELECT grant_id, expires_at, used_at FROM mcp_oauth_tokens WHERE token_hash = ? AND kind = 'refresh'")
    .bind(tokenHash).first<{ grant_id: string; expires_at: number; used_at: number | null }>();
  if (!token) return invalid;
  const replayed = async () => {
    await revokeGrantById(db, token.grant_id, "refresh_replay");
    return invalid;
  };
  if (token.used_at !== null && now - token.used_at > REFRESH_TOKEN_REUSE_GRACE_MS) return replayed();
  if (token.expires_at <= now) return invalid;
  const grant = await loadGrant(db, token.grant_id);
  if (!grant || grant.client_id !== clientId) {
    return { ok: false, error: "invalid_grant", description: "The refresh token was issued to a different client." };
  }
  if (!grantUsable(grant)) return { ok: false, error: "invalid_grant", description: `This authorization is no longer valid for the account. ${REAUTHORIZE}` };
  if (input.scope !== undefined) {
    const granted = parseStoredScopes(grant.scopes);
    if (input.scope.split(" ").some((scope) => scope && !granted.includes(scope as McpOAuthScope))) {
      return { ok: false, error: "invalid_scope", description: "The requested scope exceeds what was approved. Reconnect the client to approve more access." };
    }
  }
  const wrongResource = checkResource(env, grant, input.resource);
  if (wrongResource) return wrongResource;
  if (token.used_at === null) {
    const claimed = await db.prepare("UPDATE mcp_oauth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
      .bind(now, tokenHash).run();
    if (claimed.meta.changes !== 1) {
      // Spent by a concurrent request between the read and this write: that
      // is the concurrent case by definition, but confirm it from the row.
      const spent = await db.prepare("SELECT used_at FROM mcp_oauth_tokens WHERE token_hash = ?").bind(tokenHash).first<{ used_at: number | null }>();
      if (spent?.used_at == null || Date.now() - spent.used_at > REFRESH_TOKEN_REUSE_GRACE_MS) return replayed();
    }
  }
  return issueTokens(db, grant);
}

/**
 * RFC 7009. Revoking either an access or a refresh token revokes the grant it
 * belongs to — a client disconnecting means the whole connection. The client
 * must be the one the grant was issued to; anything else is silently ignored,
 * as the RFC asks.
 */
export async function revokeByToken(db: D1Database, input: { token: string | undefined; clientId: string | undefined }): Promise<void> {
  const { token, clientId } = input;
  if (!token || !clientId || !(OAUTH_ACCESS_TOKEN.test(token) || OAUTH_REFRESH_TOKEN.test(token))) return;
  const row = await db.prepare(`
    SELECT g.id FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id = t.grant_id
    WHERE t.token_hash = ? AND g.client_id = ?
  `).bind(await hashMcpToken(token), clientId).first<{ id: string }>();
  if (row) await revokeGrantById(db, row.id, "client");
}

// --- MCP request authentication -------------------------------------------

export interface OAuthAccessTokenRow {
  grant_id: string;
  user_id: string;
  scopes: string;
  role: string;
  status: string;
}

/** The grant behind an unexpired access token for this audience whose grant is not revoked. */
export async function findAccessToken(db: D1Database, token: string, audience: McpAudience): Promise<OAuthAccessTokenRow | null> {
  return db.prepare(`
    SELECT g.id AS grant_id, g.user_id, g.scopes, u.role, u.status
    FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id = t.grant_id JOIN users u ON u.id = g.user_id
    WHERE t.token_hash = ? AND t.kind = 'access' AND t.expires_at > ? AND g.revoked_at IS NULL AND g.audience = ?
  `).bind(await hashMcpToken(token), Date.now(), audience).first<OAuthAccessTokenRow>();
}

// Best-effort, like touchMcpCredentialLastUsed. Never gates authentication.
export async function touchGrantLastUsed(db: D1Database, grantId: string): Promise<void> {
  await db.prepare("UPDATE mcp_oauth_grants SET last_used_at = ? WHERE id = ?").bind(Date.now(), grantId).run();
}

// --- Settings: connected applications ---------------------------------------

interface GrantListRow {
  id: string;
  client_id: string;
  client_name: string | null;
  client_kind: "dynamic" | "metadata_document";
  audience: McpAudience;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  usable_until: number | null;
}

/** The owner's unrevoked grants for one audience. Never returns a secret or digest. */
export async function listGrants(db: D1Database, userId: string, audience: McpAudience): Promise<McpOAuthGrantSummary[]> {
  const now = Date.now();
  const { results } = await db.prepare(`
    SELECT g.id, g.client_id, c.client_name, c.kind AS client_kind, g.audience, g.scopes, g.created_at, g.last_used_at,
      (SELECT MAX(t.expires_at) FROM mcp_oauth_tokens t WHERE t.grant_id = g.id AND t.used_at IS NULL) AS usable_until
    FROM mcp_oauth_grants g JOIN mcp_oauth_clients c ON c.id = g.client_id
    WHERE g.user_id = ? AND g.audience = ? AND g.revoked_at IS NULL
    ORDER BY g.created_at DESC
  `).bind(userId, audience).all<GrantListRow>();
  return (results ?? []).map((row) => ({
    id: row.id, clientId: row.client_id, clientName: row.client_name, clientKind: row.client_kind, audience: row.audience,
    scopes: parseStoredScopes(row.scopes).filter((scope) => MCP_OAUTH_SCOPE_INFO[scope].audience === row.audience),
    createdAt: row.created_at, lastUsedAt: row.last_used_at ?? null,
    status: row.usable_until !== null && row.usable_until > now ? "active" : "expired",
  }));
}

/** Owner- and audience-scoped revoke, like revokeMcpCredential: false for someone else's grant or one already revoked. */
export async function revokeOwnedGrant(db: D1Database, input: { id: string; userId: string; audience: McpAudience }): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE mcp_oauth_grants SET revoked_at = ?, revoke_reason = 'user' WHERE id = ? AND user_id = ? AND audience = ? AND revoked_at IS NULL
  `).bind(Date.now(), input.id, input.userId, input.audience).run();
  return result.meta.changes === 1;
}

