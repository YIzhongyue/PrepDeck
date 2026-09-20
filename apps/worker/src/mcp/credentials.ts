import type { McpObservation } from "./observability";
import type { McpCredentialSummary } from "@prepdeck/shared";
import { McpApplicationError } from "./errors";

export type McpAudience = "user" | "admin";
export interface McpPrincipal {
  readonly userId: string;
  readonly credentialId: string;
  readonly audience: McpAudience;
}

interface McpCredentialRow {
  id: string;
  name: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

export async function hashMcpToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function credentialStatus(input: { expiresAt: number | null; revokedAt: number | null }, now: number): McpCredentialSummary["status"] {
  if (input.revokedAt !== null) return "revoked";
  if (input.expiresAt !== null && input.expiresAt <= now) return "expired";
  return "active";
}

function toSummary(row: McpCredentialRow, now: number): McpCredentialSummary {
  const expiresAt = row.expires_at ?? null;
  const revokedAt = row.revoked_at ?? null;
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    expiresAt,
    lastUsedAt: row.last_used_at ?? null,
    revokedAt,
    status: credentialStatus({ expiresAt, revokedAt }, now),
  };
}

/**
 * Issues a new bearer credential for `input.userId` on the given MCP
 * audience/server. The caller (routes/mcpTokens.ts) must already have
 * authenticated and authorized itself to act as `input.userId` — this
 * function independently re-checks account status/role but performs no
 * authentication of its own. `expiresAt` (epoch ms) is optional; omit it
 * (or pass null) for a token that never expires.
 * The returned token is a one-time secret; persist only id and token_hash.
 */
export async function issueMcpCredential(
  db: D1Database,
  input: { userId: string; audience: McpAudience; name: string; expiresAt?: number | null },
): Promise<{ id: string; token: string; name: string; createdAt: number; expiresAt: number | null }> {
  const now = Date.now();
  const name = input.name.trim();
  const expiresAt = input.expiresAt ?? null;
  if (
    !["user", "admin"].includes(input.audience) || !input.userId || !name || name.length > 100
    || (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= now))
  ) {
    throw new McpApplicationError("invalid_input");
  }
  const id = crypto.randomUUID();
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const token = `pd_mcp_${input.audience}_${secret}`;
  // Check account status/role in the same statement as the insert.
  const result = await db.prepare(`
    INSERT INTO mcp_credentials (id, user_id, server, name, token_hash, created_at, expires_at)
    SELECT ?, id, ?, ?, ?, ?, ? FROM users
    WHERE id = ? AND status = 'active' AND (? = 'user' OR role = 'admin')
  `).bind(id, input.audience, name, await hashMcpToken(token), now, expiresAt, input.userId, input.audience).run();
  if (result.meta.changes !== 1) throw new McpApplicationError("unauthorized");
  return { id, token, name, createdAt: now, expiresAt };
}

// Owner-scoped list for the self-service token surfaces (Settings' User MCP
// card and the Admin MCP token page) — never returns token_hash.
export async function listMcpCredentials(db: D1Database, userId: string, audience: McpAudience): Promise<McpCredentialSummary[]> {
  const { results } = await db.prepare(`
    SELECT id, name, created_at, expires_at, last_used_at, revoked_at
    FROM mcp_credentials WHERE user_id = ? AND server = ? ORDER BY created_at DESC
  `).bind(userId, audience).all<McpCredentialRow>();
  const now = Date.now();
  return (results ?? []).map((row) => toSummary(row, now));
}

// Fetches one credential the caller owns, for rotation's "same name/relative
// lifetime" logic. Returns null for a missing id or one owned by someone else
// — the route layer must treat both identically (404), never leaking
// existence of another user's credential.
export async function getMcpCredentialOwned(
  db: D1Database,
  input: { id: string; userId: string; audience: McpAudience },
): Promise<{ id: string; name: string; createdAt: number; expiresAt: number | null; revokedAt: number | null } | null> {
  const row = await db.prepare(`
    SELECT id, name, created_at, expires_at, revoked_at FROM mcp_credentials
    WHERE id = ? AND user_id = ? AND server = ?
  `).bind(input.id, input.userId, input.audience)
    .first<{ id: string; name: string; created_at: number; expires_at: number | null; revoked_at: number | null }>();
  if (!row) return null;
  return { id: row.id, name: row.name, createdAt: row.created_at, expiresAt: row.expires_at ?? null, revokedAt: row.revoked_at ?? null };
}

// Compare-and-swap revoke, scoped to the owner + audience so a User MCP
// token id can never be revoked through the Admin MCP token routes or vice
// versa, and one user can never revoke another's token. The
// `revoked_at IS NULL` guard makes this UPDATE double as a mutex: of any
// number of concurrent callers targeting the same id, exactly one gets
// `changes === 1`. The route layer relies on this both for plain revoke
// (mapping false to 404) and for rotation, which must revoke the
// predecessor here *before* issuing a replacement so at most one caller can
// ever claim a given credential for rotation.
export async function revokeMcpCredential(db: D1Database, input: { id: string; userId: string; audience: McpAudience }): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE mcp_credentials SET revoked_at = ? WHERE id = ? AND user_id = ? AND server = ? AND revoked_at IS NULL
  `).bind(Date.now(), input.id, input.userId, input.audience).run();
  return result.meta.changes === 1;
}

// Best-effort activity tracking for the "last used" column shown in
// Settings/admin token lists. Never gates authentication.
export async function touchMcpCredentialLastUsed(db: D1Database, credentialId: string): Promise<void> {
  await db.prepare("UPDATE mcp_credentials SET last_used_at = ? WHERE id = ?").bind(Date.now(), credentialId).run();
}

export async function authenticateMcp(
  request: Request, db: D1Database, audience: McpAudience,
  observation?: McpObservation,
): Promise<McpPrincipal> {
  // No cookie, Access JWT, URL parameter, body, or client identity fallback.
  const header = request.headers.get("Authorization");
  const match = /^Bearer (pd_mcp_(user|admin)_[a-f0-9]{64})$/i.exec(header ?? "");
  if (!match || match[2] !== audience) {
    if (observation) observation.auth = !header ? "missing" : !match ? "malformed" : "wrong_audience";
    throw new McpApplicationError("unauthenticated");
  }
  if (observation) observation.auth = "internal";
  const row = await db.prepare(`
    SELECT c.id AS credential_id, c.user_id, u.role, u.status
    FROM mcp_credentials c JOIN users u ON u.id = c.user_id
    WHERE c.token_hash = ? AND c.server = ? AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > ?)
  `).bind(await hashMcpToken(match[1]!), audience, Date.now())
    .first<{ credential_id: string; user_id: string; role: string; status: string }>();
  if (!row) {
    // Keep the existing filtered lookup: no extra query to distinguish secrets
    // that are unknown, expired or revoked solely for telemetry.
    if (observation) observation.auth = "invalid_or_expired_or_revoked";
    throw new McpApplicationError("unauthenticated");
  }
  if (row.status !== "active" || (audience === "admin" && row.role !== "admin")) {
    if (observation) observation.auth = "account_not_authorized";
    throw new McpApplicationError("unauthorized");
  }
  if (observation) observation.auth = "success";
  return Object.freeze({ userId: row.user_id, credentialId: row.credential_id, audience });
}

export const authenticateUserMcp = (request: Request, db: D1Database, observation?: McpObservation) => authenticateMcp(request, db, "user", observation);
export const authenticateAdminMcp = (request: Request, db: D1Database, observation?: McpObservation) => authenticateMcp(request, db, "admin", observation);
