// Admin MCP import execution: the proposal tokens that bind admin_execute_import
// to the file (and tag resolution) admin_preview_import reviewed, and the
// committed-item ledger that makes a resumed execute replay-safe. The import
// pipeline itself, shared with the REST routes, lives in lib/questionImport.ts.
import type { ImportConflictResolution } from "./questionImport";

async function sha256Hex(material: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

// "Same file (and tag taxonomy) as preview" fingerprint — same
// canonical-hash idiom as lib/questionProposals.ts's proposalToken.
// admin_execute_import recomputes this from the resubmitted file AND the
// file's tag names re-resolved against CURRENT catalog state, and rejects a
// mismatch as stale. implementation called this "binding execution to a
// validated/reviewed payload"; implementation extends it to also bind the reviewed
// TAG RESOLUTION — `tagSnapshot` (lib/questionBankTags.ts's
// tagResolutionSnapshot, computed by the caller at both preview and execute
// time from the SAME file's tag names) records what each tag name currently
// resolves to. If a rename/merge between preview and execute changes what
// an unchanged name would now resolve to (e.g. a name that matched an
// existing tag now matches nothing, or matches a different tag), the
// snapshot differs, the token differs, and execute is correctly rejected as
// stale rather than silently committing a different tag identity than what
// was reviewed.
export async function fileToken(examId: string, file: unknown, tagSnapshot: Record<string, string | null>): Promise<string> {
  return sha256Hex(JSON.stringify({ examId, file, tagSnapshot }));
}

// Binds fileToken *and* the caller's conflict-resolution decisions, so an
// importId replayed with different resolutions is rejected as a distinct
// request rather than silently returning the first run's result. Resolutions
// are sorted by questionId so array/key order doesn't affect the hash for an
// otherwise-identical logical request.
export async function requestFingerprint(token: string, resolutions: ImportConflictResolution[]): Promise<string> {
  const normalized = [...resolutions]
    .map((r) => ({ questionId: r.questionId, expectedRevision: r.expectedRevision, incomingToken: r.incomingToken, action: r.action }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
  return sha256Hex(JSON.stringify([token, normalized]));
}

// implementation (review round 2) — durable per-item outcome ledger
// (admin_mcp_import_committed_items, migration 0024) so a resumed execute
// attempt can recover exactly which file indices already committed a create
// or update in a PRIOR attempt, instead of re-classifying every row against
// current DB state (where an already-applied change now looks "identical"
// and silently reclassifies as a plain skip, losing track of it in the
// final created/updated counts and in cache-invalidation decisions).
export interface CommittedImportItem {
  itemIndex: number;
  questionId: string;
  examId: string;
  externalId: string | null;
  kind: "created" | "updated";
}

interface CommittedImportItemRow {
  item_index: number;
  question_id: string;
  exam_id: string;
  external_id: string | null;
  kind: "created" | "updated";
}

function toCommittedImportItem(row: CommittedImportItemRow): CommittedImportItem {
  return { itemIndex: row.item_index, questionId: row.question_id, examId: row.exam_id, externalId: row.external_id, kind: row.kind };
}

export async function getCommittedImportItems(db: D1Database, importId: string): Promise<Map<number, CommittedImportItem>> {
  const { results } = await db.prepare(
    "SELECT item_index, question_id, exam_id, external_id, kind FROM admin_mcp_import_committed_items WHERE import_id = ?",
  ).bind(importId).all<CommittedImportItemRow>();
  return new Map((results ?? []).map((row) => [row.item_index, toCommittedImportItem(row)]));
}

// Unconditional: only used right after a create statement, which (per
// createStatement's own contract) either inserts exactly one row or throws —
// there's no "0 rows changed" case to guard against the way there is for updates.
export function buildCommittedImportItemStatement(db: D1Database, item: CommittedImportItem & { importId: string }): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO admin_mcp_import_committed_items (import_id, item_index, question_id, exam_id, external_id, kind, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(item.importId, item.itemIndex, item.questionId, item.examId, item.externalId, item.kind, Date.now());
}

// Conditional on changes() from the UPDATE statement immediately preceding
// this one in the same batch (same changes()-propagation idiom as
// mcp/audit.ts's buildConditionalAdminMutationAuditStatement): a stale-
// revision update that changed zero rows must not be recorded as committed.
// This statement's own changes() (1 if it inserted, 0 if its WHERE was
// false) is what the *next* statement in the batch — the conditional audit
// row — must then read, so it correctly stays in this exact position:
// immediately after the update, immediately before the audit statement.
export function buildConditionalCommittedImportItemStatement(
  db: D1Database, item: CommittedImportItem & { importId: string },
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO admin_mcp_import_committed_items (import_id, item_index, question_id, exam_id, external_id, kind, committed_at)
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`,
  ).bind(item.importId, item.itemIndex, item.questionId, item.examId, item.externalId, item.kind, Date.now());
}
