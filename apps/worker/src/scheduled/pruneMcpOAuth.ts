// Issue #102 — daily cleanup of MCP OAuth rows that can no longer be used:
// expired access/refresh tokens, authorization codes and authorization
// requests, and dynamically registered clients nobody ever connected with.
// Grants are never deleted (audit rows refer to them); revoking one is enough.
//
// A spent refresh token is kept until it expires, not until it is spent: that
// is what lets a replay be recognized (and the grant revoked) for its whole
// lifetime. After expiry a replay is refused as unknown, which is just as safe.

import type { Env } from "../bindings";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 1_000;
const MAX_PAGES = 10;
// Clients register freely (rate limited per IP), so an unused registration
// is dropped after a month.
const UNUSED_CLIENT_MS = 30 * DAY_MS;

// D1/SQLite has no DELETE ... LIMIT, so each bound lives in a subquery, paged
// like pruneContentMutationAudit so a backlog cannot exhaust the invocation.
const SWEEPS: ReadonlyArray<{ sql: string; cutoff: (now: number) => number }> = [
  { sql: "DELETE FROM mcp_oauth_tokens WHERE id IN (SELECT id FROM mcp_oauth_tokens WHERE expires_at < ? LIMIT ?)", cutoff: (now) => now },
  { sql: "DELETE FROM mcp_oauth_codes WHERE code_hash IN (SELECT code_hash FROM mcp_oauth_codes WHERE expires_at < ? LIMIT ?)", cutoff: (now) => now - DAY_MS },
  { sql: "DELETE FROM mcp_oauth_requests WHERE id IN (SELECT id FROM mcp_oauth_requests WHERE expires_at < ? LIMIT ?)", cutoff: (now) => now - DAY_MS },
  {
    sql: `DELETE FROM mcp_oauth_clients WHERE id IN (
      SELECT c.id FROM mcp_oauth_clients c WHERE c.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM mcp_oauth_grants g WHERE g.client_id = c.id) LIMIT ?)`,
    cutoff: (now) => now - UNUSED_CLIENT_MS,
  },
];

export async function runMcpOAuthPrune(env: Env, now: () => number = Date.now): Promise<{ deleted: number }> {
  const at = now();
  let deleted = 0;
  for (const sweep of SWEEPS) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await env.DB.prepare(sweep.sql).bind(sweep.cutoff(at), PAGE).run();
      deleted += result.meta.changes;
      if (result.meta.changes < PAGE) break;
    }
  }
  return { deleted };
}
