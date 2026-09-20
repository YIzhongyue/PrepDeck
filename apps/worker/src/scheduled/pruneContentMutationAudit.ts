// Retention for the two tables behind the `content_mutation_audit` view
// (docs/operations/content-mutation-audit.md). Audit rows are written on every
// content mutation and never read back by the application, so without a sweep
// they are the one table in this schema that grows without bound — the import
// path alone can add a record per question per run.
//
// Both tables share ONE window on purpose. The view is the operational read
// surface, and retaining MCP history longer than browser/import history would
// make the same query silently under-report one entry point against another
// for the same period. A shorter, symmetric horizon is more honest than a
// longer, lopsided one.

import type { Env } from "../bindings";

export const AUDIT_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;

// Deliberately un-indexed on occurred_at: these tables take a write on every
// mutation and are scanned once a day, so paying index maintenance on every
// insert to speed up one cron job is the wrong trade. Retention is what keeps
// the scan bounded. Note there is no ORDER BY either — the sweep needs *some*
// expired rows, not the oldest ones, so the scan can stop at the first full
// page instead of sorting the whole table.
const PRUNE_PAGE = 1_000;
const MAX_PAGES_PER_TABLE = 10;

// D1/SQLite has no DELETE ... LIMIT, so the bound lives in a subquery.
const PRUNABLE_TABLES = ["question_mutation_audit_log", "admin_mcp_audit_log"] as const;

export async function runContentMutationAuditPrune(
  env: Env,
  now: () => number = Date.now,
): Promise<{ deleted: number }> {
  const cutoff = now() - AUDIT_RETENTION_MS;
  let deleted = 0;
  for (const table of PRUNABLE_TABLES) {
    // Paged rather than one unbounded DELETE so a long-neglected table cannot
    // put the whole sweep over the invocation's time budget. Whatever is left
    // is picked up by the next day's run.
    for (let page = 0; page < MAX_PAGES_PER_TABLE; page++) {
      const result = await env.DB.prepare(
        `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE occurred_at < ? LIMIT ?)`
      )
        .bind(cutoff, PRUNE_PAGE)
        .run();
      deleted += result.meta.changes;
      if (result.meta.changes < PRUNE_PAGE) break;
    }
  }
  return { deleted };
}
