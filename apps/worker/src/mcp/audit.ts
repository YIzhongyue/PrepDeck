// implementation — audit trail for Admin MCP mutation tools. One row per
// affected item within a tool call (batch tools write one row per item, not
// one per call): enough to reconstruct who did what to which target and
// whether it succeeded, without logging tokens/credentials or full content.
import type { McpPrincipal } from "./credentials";

export type AdminMutationAction =
  | "create" | "update" | "delete" | "batch_create" | "batch_update"
  | "import_execute" | "exam_create" | "exam_update" | "exam_archive"
  | "tag_create" | "tag_update" | "tag_merge";
export type AdminMutationOutcome = "success" | "partial" | "failure" | "skipped";

export interface AdminMutationAuditEntry {
  tool: string;
  action: AdminMutationAction;
  examId: string | null;
  targetIds: string[];
  outcome: AdminMutationOutcome;
  detail?: unknown;
}

// Unexecuted statement, so callers that can determine the outcome up front
// (e.g. a create, where the insert either fully succeeds or throws) can
// batch it atomically with the mutation itself — the audit row is then
// guaranteed to exist whenever the mutation committed, independent of any
// later, unrelated step (cache invalidation) that might fail.
export function buildAdminMutationAuditStatement(
  db: D1Database,
  principal: McpPrincipal,
  entry: AdminMutationAuditEntry,
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO admin_mcp_audit_log
      (id, occurred_at, admin_user_id, credential_id, tool, action, exam_id, target_ids_json, outcome, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), Date.now(), principal.userId, principal.credentialId,
    entry.tool, entry.action, entry.examId, JSON.stringify(entry.targetIds),
    entry.outcome, entry.detail !== undefined ? JSON.stringify(entry.detail) : null,
  );
}

export async function recordAdminMutationAudit(
  db: D1Database,
  principal: McpPrincipal,
  entry: AdminMutationAuditEntry,
): Promise<void> {
  await buildAdminMutationAuditStatement(db, principal, entry).run();
}

export interface ConditionalAdminMutationAuditEntry {
  tool: string;
  action: AdminMutationAction;
  examId: string | null;
  targetIds: string[];
  successDetail?: unknown;
  failureDetail?: unknown;
}

// For update/delete, whether the mutation actually changed anything (vs a
// stale-revision no-op, which commits without throwing) is only known once
// the statement runs — so this can't be decided in JS before building the
// audit row. SQLite's changes() (the row count of the single most recently
// completed INSERT/UPDATE/DELETE on this connection) lets one D1 batch
// commit the mutation and a correctly-outcomed audit row atomically:
// whichever happens, both commit together, or (on a thrown error) neither
// does. The caller MUST place this statement immediately after the one
// mutation statement whose result it should reflect — nothing else may run
// between them, or changes() will reflect the wrong statement.
//
// The no-op branch is always audited as 'failure' here (unchanged from implementation):
// for a direct question update/delete, zero rows changed means a stale
// revision, which the caller surfaces to the user as a conflict, not a
// benign skip. A resumed import row that intentionally re-applies an
// already-committed update and expects zero changes is instead audited via
// the plain (non-conditional) buildAdminMutationAuditStatement with an
// explicit outcome:'skipped' — see adapter.ts's import execute path.
export function buildConditionalAdminMutationAuditStatement(
  db: D1Database,
  principal: McpPrincipal,
  entry: ConditionalAdminMutationAuditEntry,
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO admin_mcp_audit_log
      (id, occurred_at, admin_user_id, credential_id, tool, action, exam_id, target_ids_json, outcome, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?,
      CASE WHEN changes() > 0 THEN 'success' ELSE 'failure' END,
      CASE WHEN changes() > 0 THEN ? ELSE ? END)
  `).bind(
    crypto.randomUUID(), Date.now(), principal.userId, principal.credentialId,
    entry.tool, entry.action, entry.examId, JSON.stringify(entry.targetIds),
    entry.successDetail !== undefined ? JSON.stringify(entry.successDetail) : null,
    entry.failureDetail !== undefined ? JSON.stringify(entry.failureDetail) : null,
  );
}
