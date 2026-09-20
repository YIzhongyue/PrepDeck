export interface QuestionMutationContext {
  userId: string;
  entryPoint: "admin_api" | "import_api";
  action: "create" | "update" | "delete";
  examId: string;
  questionId?: string;
}

// Browser/API sibling of mcp/audit.ts's buildConditionalAdminMutationAuditStatement,
// writing the same vocabulary to question_mutation_audit_log instead of the
// credential-bearing admin_mcp_audit_log.
//
// The "conditional" outcome reads changes() — the row count of the single most
// recently completed INSERT/UPDATE/DELETE on this connection — so that the
// mutation and a correctly-outcomed audit row commit in ONE D1 batch. That
// carries the same hard requirement as its MCP twin, and buildConditional...'s
// comment is the long-form version: the caller MUST place this statement
// immediately after the one mutation statement whose result it should reflect.
// Nothing may run between them, or changes() reflects the wrong statement.
//
// Store a bounded reason, never payloads, cookies or tokens.
export function questionMutationAuditStatement(
  db: D1Database,
  context: QuestionMutationContext,
  outcome: "conditional" | "success" | "failure" | "skipped",
  reason?: string,
): D1PreparedStatement {
  return questionMutationAuditRow(db, context, outcome, context.questionId ? [context.questionId] : [],
    reason ? { reason } : outcome === "conditional" ? { reason: "stale_or_missing" } : null);
}

// Import re-runs are overwhelmingly no-ops: a 1,000-question file whose rows
// all match what is already stored used to write 1,000 identical "nothing
// happened" rows, every run, forever (and nothing prunes this table). One row
// per distinct outcome, naming every question it covers, says the same thing.
// Chunked because target_ids_json is a single column: ~200 UUIDs keeps each
// row's blob near 7KB instead of unbounded.
export const AUDIT_TARGETS_PER_ROW = 200;

export function aggregateQuestionMutationAuditStatements(
  db: D1Database,
  context: QuestionMutationContext,
  outcome: "success" | "failure" | "skipped",
  reason: string,
  questionIds: string[],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (let start = 0; start < questionIds.length; start += AUDIT_TARGETS_PER_ROW) {
    const targets = questionIds.slice(start, start + AUDIT_TARGETS_PER_ROW);
    statements.push(questionMutationAuditRow(db, context, outcome, targets, { reason, count: targets.length }));
  }
  return statements;
}

function questionMutationAuditRow(
  db: D1Database,
  context: QuestionMutationContext,
  outcome: "conditional" | "success" | "failure" | "skipped",
  targetIds: string[],
  detail: Record<string, unknown> | null,
): D1PreparedStatement {
  const conditional = outcome === "conditional";
  return db.prepare(
    `INSERT INTO question_mutation_audit_log
     (id, occurred_at, admin_user_id, entry_point, action, exam_id, target_ids_json, outcome, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${conditional ? "CASE WHEN changes() > 0 THEN 'success' ELSE 'failure' END" : "?"},
       ${conditional ? "CASE WHEN changes() > 0 THEN NULL ELSE ? END" : "?"})`
  ).bind(
    crypto.randomUUID(), Date.now(), context.userId, context.entryPoint, context.action,
    context.examId, JSON.stringify(targetIds),
    ...(conditional ? [] : [outcome]),
    detail ? JSON.stringify(detail) : null,
  );
}
