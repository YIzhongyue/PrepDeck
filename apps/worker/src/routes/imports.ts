// docs/requirements/question-bank-management.md — Question Import (FR-2.2): validate a Question Import JSON file
// against the schema, preview it (count, duplicates, per-row errors), and on
// confirmation upsert into D1 while archiving the original file in R2 (FR-2.2.3)
// plus an import_logs audit row (FR-2.5). Admin-only. The pipeline itself is
// lib/questionImport.ts, shared with Admin MCP's import tools.

import { Hono, type Context } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAdmin } from "../middleware/admin";
import { invalidatePracticeQuestions } from "../lib/practiceCache";
import { parseJsonBody, runD1Batches } from "../lib/importSecurity";
import type { ImportConflict } from "../lib/importConflicts";
import {
  archiveImportFile, changedRowConflicts, cleanOldImportArchives, commitImportWrites, countImportOutcomes, decideImportRows,
  findImportTargets, limitImportRequest, planImportWrites, recordImportLog, resolutionMatches, validateImport,
  type ImportConflictResolution, type ImportOutcomeStatus,
} from "../lib/questionImport";
import { aggregateQuestionMutationAuditStatements, questionMutationAuditStatement } from "../lib/questionMutationAudit";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

// Planned writes per atomic D1 batch. Admin MCP uses smaller batches; see
// mcp/adapters/admin/imports.ts.
const IMPORT_ITEMS_PER_BATCH = 50;

async function enforceImportRateLimit(c: AppContext, kind: "validate" | "execute"): Promise<Response | null> {
  const allowed = await limitImportRequest(c.env, kind, c.get("user").id, c.req.param("examId")!);
  return allowed ? null : c.json({ error: `Too many import ${kind} requests — please try again later.` }, 429);
}

function isConflictResolutionList(value: unknown): value is ImportConflictResolution[] {
  return Array.isArray(value) && value.every((r) => r && typeof r.questionId === "string" && Number.isInteger(r.expectedRevision)
    && typeof r.incomingToken === "string" && ["keep", "apply"].includes(r.action));
}

export const importsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

importsRouter.use("*", requireAdmin);

importsRouter.post("/validate", async (c) => {
  const limited = await enforceImportRateLimit(c, "validate");
  if (limited) return limited;
  const examId = c.req.param("examId")!;
  const exam = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(examId).first();
  if (!exam) return c.json({ error: "Exam not found" }, 404);

  const parsed = await parseJsonBody(c.req.raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);

  const { issues, duplicateExternalIdsInFile, questionCount, file } = validateImport(parsed.data);

  let duplicateExternalIdsInDb: string[] = [];
  let conflicts: ImportConflict[] = [];
  if (file) {
    const existing = await findImportTargets(c.env.DB, examId, file.questions);
    // One entry per matching stored row (Admin MCP's preview de-duplicates),
    // so an ambiguous externalId is listed once per match.
    duplicateExternalIdsInDb = existing.map(r => r.external_id!).filter(Boolean);
    // Every differing row, clean updates included: each needs a resolution.
    conflicts = changedRowConflicts(await decideImportRows(c.env.DB, existing, file.questions));
  }

  return c.json({
    valid: issues.length === 0,
    questionCount,
    issues,
    duplicateExternalIdsInFile,
    duplicateExternalIdsInDb,
    conflicts,
  });
});

importsRouter.post("/", async (c) => {
  const limited = await enforceImportRateLimit(c, "execute");
  if (limited) return limited;
  const examId = c.req.param("examId")!;
  const auditContext = (action: "create" | "update", questionId?: string) =>
    ({ userId: c.get("user").id, entryPoint: "import_api" as const, action, examId, questionId });
  const audit = (questionId: string | undefined, action: "create" | "update", outcome: "conditional" | "failure" | "skipped", reason?: string) =>
    questionMutationAuditStatement(c.env.DB, auditContext(action, questionId), outcome, reason);
  const exam = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(examId).first();
  if (!exam) return c.json({ error: "Exam not found" }, 404);

  const parsed = await parseJsonBody(c.req.raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);

  const { issues, duplicateExternalIdsInFile, file } = validateImport(parsed.data);
  if (!file) {
    await audit(undefined, "create", "failure", "validation").run();
    return c.json({ error: "Validation failed", issues, duplicateExternalIdsInFile }, 422);
  }

  // Resolutions are scoped to the exact previewed ID, revision and incoming content.
  // A broad legacy duplicateStrategy=overwrite never authorizes a conflicting write.
  // Checked before anything is written: planning creates the file's new tags.
  const rawResolutions = (parsed.data as Record<string, unknown>).conflictResolutions;
  if (rawResolutions !== undefined && !isConflictResolutionList(rawResolutions)) {
    return c.json({ error: "Invalid conflictResolutions" }, 422);
  }
  const resolutions = rawResolutions ?? [];

  const now = new Date().toISOString();
  const existing = await findImportTargets(c.env.DB, examId, file.questions);
  const decisions = await decideImportRows(c.env.DB, existing, file.questions);
  const plan = await planImportWrites(c.env.DB, {
    examId, questions: file.questions, decisions, now,
    // Any resolution that matches the row exactly, if several name it.
    resolutionFor: (d) => resolutions.find((r) => resolutionMatches(r, d)),
    chainedStatements: (w) => [audit(w.questionId, w.kind, "conditional")],
  });

  const conflicts: ImportConflict[] = [];
  const outcomes: { questionId: string; externalId: string | null; status: ImportOutcomeStatus; reason?: string }[] = [];
  const unchangedAudits: D1PreparedStatement[] = [];
  // Collected rather than audited one row at a time: an unchanged row carries
  // no information the next one does not, and a re-imported catalog is almost
  // entirely unchanged rows. See aggregateQuestionMutationAuditStatements.
  const identicalIds: string[] = [];
  for (const { decision, status, reason } of plan.unchanged) {
    const { row } = decision;
    outcomes.push({ questionId: row.id, externalId: row.external_id, status, reason });
    if (decision.kind === "identical") identicalIds.push(row.id);
    else if (status === "conflict") {
      conflicts.push(decision.conflict);
      unchangedAudits.push(audit(row.id, "update", "failure", reason));
    } else unchangedAudits.push(audit(row.id, "update", "skipped", reason));
  }
  // Unchanged rows need no content transaction. These land BEFORE the content
  // batches below, so a run that later rolls a batch back still records the
  // decisions it reached about the rows it did not touch — see
  // docs/operations/content-mutation-audit.md.
  await runD1Batches(c.env.DB, [
    ...aggregateQuestionMutationAuditStatements(c.env.DB, auditContext("update"), "skipped", "identical", identicalIds),
    ...unchangedAudits,
  ]);
  // Each bounded D1 batch is atomic. Report rolled-back items instead of hiding
  // partial completion across batches. Retry only failed/conflicting items.
  const results = await commitImportWrites(c.env.DB, plan.writes, {
    itemsPerBatch: IMPORT_ITEMS_PER_BATCH,
    onRollback: async (writes) => {
      await c.env.DB.batch(writes.map((w) => audit(w.questionId, w.kind, "failure", "batch_rolled_back")));
    },
  });
  for (const { write, status } of results) {
    const base = { questionId: write.questionId, externalId: write.externalId };
    if (status === "committed") outcomes.push({ ...base, status: write.kind === "create" ? "created" : "updated" });
    else if (status === "stale") outcomes.push({ ...base, status: "conflict", reason: "stale_question; refresh preview" });
    else outcomes.push({ ...base, status: "failed", reason: "Batch rolled back; refresh preview to check identity conflicts before retrying." });
  }
  const { created, updated, skipped, failed } = countImportOutcomes(outcomes);
  if (created || updated) await invalidatePracticeQuestions(c.env, examId);

  // parseJsonBody already rejected anything over IMPORT_BODY_MAX_BYTES before
  // the D1 writes above ever ran, so parsed.raw is already within that same
  // budget here — no second size check needed (and doing one this late,
  // after questions are already committed to D1, would leave an import
  // partially applied with no matching archive/log row).
  const r2Key = await archiveImportFile(c.env.BUCKET, examId, parsed.raw);
  const importLogId = await recordImportLog(c.env.DB, {
    examId, uploadedBy: c.get("user").id, r2ObjectKey: r2Key, questionCount: file.questions.length, createdAt: now,
  });

  // Retention is maintenance, not part of the committed import. Running it
  // in the background prevents a transient list/delete failure from making a
  // successful import look failed (and encouraging an unsafe retry).
  c.executionCtx.waitUntil(cleanOldImportArchives(c.env.BUCKET, examId, r2Key));

  return c.json(
    {
      importLogId,
      r2ObjectKey: r2Key,
      total: file.questions.length,
      created,
      updated,
      skipped,
      failed,
      conflicts,
      outcomes,
    },
    201
  );
});

// FR-2.5 — import history, sourced from the import_logs table.
importsRouter.get("/logs", async (c) => {
  const examId = c.req.param("examId");
  const { results } = await c.env.DB.prepare(
    `SELECT il.id, il.exam_id, il.uploaded_by, u.display_name AS uploaded_by_name, u.email AS uploaded_by_email,
            il.r2_object_key, il.question_count, il.created_at
     FROM import_logs il JOIN users u ON u.id = il.uploaded_by
     WHERE il.exam_id = ? ORDER BY il.created_at DESC`
  )
    .bind(examId)
    .all<{
      id: string;
      exam_id: string;
      uploaded_by: string;
      uploaded_by_name: string | null;
      uploaded_by_email: string;
      r2_object_key: string;
      question_count: number;
      created_at: string;
    }>();

  return c.json({
    logs: (results ?? []).map((r) => ({
      id: r.id,
      examId: r.exam_id,
      uploadedBy: { id: r.uploaded_by, name: r.uploaded_by_name, email: r.uploaded_by_email },
      r2ObjectKey: r.r2_object_key,
      questionCount: r.question_count,
      createdAt: r.created_at,
    })),
  });
});

// Streams the archived original file back for audit purposes (FR-2.5).
importsRouter.get("/logs/:logId/file", async (c) => {
  const examId = c.req.param("examId");
  const logId = c.req.param("logId");
  const log = await c.env.DB.prepare("SELECT r2_object_key FROM import_logs WHERE id = ? AND exam_id = ?")
    .bind(logId, examId)
    .first<{ r2_object_key: string }>();
  if (!log) return c.json({ error: "Import log not found" }, 404);

  const object = await c.env.BUCKET.get(log.r2_object_key);
  if (!object) return c.json({ error: "Archived file is no longer available" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${logId}.json"`,
    },
  });
});
