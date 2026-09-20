// docs/requirements/question-bank-management.md — Question Import (FR-2.2): validate a Question Import JSON file
// against the schema, preview it (count, duplicates, per-row errors), and on
// confirmation upsert into D1 while archiving the original file in R2 (FR-2.2.3)
// plus an import_logs audit row (FR-2.5). Admin-only.

import { Hono, type Context } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAdmin } from "../middleware/admin";
import { invalidatePracticeQuestions } from "../lib/practiceCache";
import { parseJsonBody, runD1Batches } from "../lib/importSecurity";
import { validateImportFile, type QuestionImportFile } from "@prepdeck/shared";

import { canonical, createStatement, toQuestion, updateStatement, type QuestionRow } from "../lib/questionManagement";
import { importConflict, type ImportConflict } from "../lib/importConflicts";
import { findQuestionRows as findQuestionRowsByExternalId, cleanOldImportArchives } from "../lib/importExecution";
import { buildTagLinkStatements, buildTagNameResolver, fetchTagIdsForQuestions } from "../lib/questionBankTags";
import { aggregateQuestionMutationAuditStatements, questionMutationAuditStatement } from "../lib/questionMutationAudit";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

async function enforceImportRateLimit(c: AppContext, kind: "validate" | "execute"): Promise<Response | null> {
  const limiter = kind === "validate" ? c.env.IMPORT_VALIDATE_RATE_LIMITER : c.env.IMPORT_EXECUTE_RATE_LIMITER;
  const result = await limiter.limit({ key: `${c.get("user").id}:${c.req.param("examId")}` });
  return result.success ? null : c.json({ error: `Too many import ${kind} requests — please try again later.` }, 429);
}

async function findQuestionRows(c: AppContext, examId: string, externalIds: string[]): Promise<QuestionRow[]> {
  return findQuestionRowsByExternalId(c.env.DB, examId, externalIds);
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

  const { issues, duplicateExternalIdsInFile, questionCount } = validateImportFile(parsed.data);

  let duplicateExternalIdsInDb: string[] = [];
  const conflicts: ImportConflict[] = [];
  if (issues.length === 0) {
    const file = parsed.data as QuestionImportFile;
    const externalIds = file.questions.map((q) => q.externalId).filter((x): x is string => !!x);
    if (externalIds.length > 0) {
      const existing = await findQuestionRows(c, examId, externalIds);
      duplicateExternalIdsInDb = existing.map(r => r.external_id!).filter(Boolean);
      for (const q of file.questions) {
        const matches = existing.filter(r => r.external_id === q.externalId);
        for (const row of matches) if (matches.length > 1 || canonical(toQuestion(row)) !== canonical(q)) {
          conflicts.push(await importConflict(c.env.DB, row, q, matches.length > 1));
        }
      }
    }
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

  const { issues, duplicateExternalIdsInFile } = validateImportFile(parsed.data);
  if (issues.length > 0) {
    await audit(undefined, "create", "failure", "validation").run();
    return c.json({ error: "Validation failed", issues, duplicateExternalIdsInFile }, 422);
  }

  const file = parsed.data as QuestionImportFile;

  const externalIds = file.questions.map((q) => q.externalId).filter((x): x is string => !!x);
  const existing = externalIds.length ? await findQuestionRows(c, examId, externalIds) : [];
  const now = new Date().toISOString();
  // Bulk-resolve every distinct tag name in the file, and batch-fetch every
  // matched existing question's CURRENT tag links, before building any
  // write statement — see resolveFileTagIds's own comment and
  // lib/questionBankTags.ts's buildTagLinkStatements.
  const resolveTagIds = await buildTagNameResolver(c.env.DB, file.questions.flatMap((q) => q.tags ?? []), now);
  const currentTagIdsByQuestion = await fetchTagIdsForQuestions(c.env.DB, existing.map((r) => r.id));
  // Resolutions are scoped to the exact previewed ID, revision and incoming content.
  // A broad legacy duplicateStrategy=overwrite never authorizes a conflicting write.
  const rawResolutions = (parsed.data as Record<string, unknown>).conflictResolutions;
  type Resolution = { questionId: string; expectedRevision: number; incomingToken: string; action: "keep" | "apply" };
  if (rawResolutions !== undefined && (!Array.isArray(rawResolutions) || rawResolutions.some(r => !r || typeof r.questionId !== "string" || !Number.isInteger(r.expectedRevision) || typeof r.incomingToken !== "string" || !["keep", "apply"].includes(r.action)))) {
    return c.json({ error: "Invalid conflictResolutions" }, 422);
  }
  const resolutions = (rawResolutions ?? []) as Resolution[];
  const conflicts: ImportConflict[] = [];
  const outcomes: { questionId: string; externalId: string | null; status: "created" | "updated" | "skipped" | "conflict" | "failed"; reason?: string }[] = [];
  const unchangedAudits: D1PreparedStatement[] = [];
  // Collected rather than audited one row at a time: an unchanged row carries
  // no information the next one does not, and a re-imported catalog is almost
  // entirely unchanged rows. See aggregateQuestionMutationAuditStatements.
  const identicalIds: string[] = [];
  // Each item's tag-link statements travel WITH its row statement in
  // `statements` (an update's are guarded on its own post-write revision;
  // a create's are unconditional) so both commit or roll back together as
  // one atomic unit — implementation review: question_tag_links is
  // authoritative content, not a best-effort side effect.
  const pending: {
    statements: D1PreparedStatement[]; id: string; externalId: string | null; status: "created" | "updated";
  }[] = [];
  for (const q of file.questions) {
    const matches = q.externalId ? existing.filter(r => r.external_id === q.externalId) : [];
    const desiredTagIds = resolveTagIds(q.tags);
    if (!matches.length) {
      const id = crypto.randomUUID();
      pending.push({
        statements: [createStatement(c.env.DB, examId, id, q, now, true, desiredTagIds), audit(id, "create", "conditional"), ...buildTagLinkStatements(c.env.DB, id, desiredTagIds, [])],
        id, externalId: q.externalId ?? null, status: "created",
      });
      continue;
    }
    for (const row of matches) {
      if (matches.length === 1 && canonical(toQuestion(row)) === canonical(q)) {
        identicalIds.push(row.id);
        outcomes.push({ questionId: row.id, externalId: row.external_id, status: "skipped", reason: "identical" }); continue;
      }
      const conflict = await importConflict(c.env.DB, row, q, matches.length > 1);
      const resolution = resolutions.find(r => r.questionId === row.id && r.expectedRevision === row.revision && r.incomingToken === conflict.incomingToken);
      if (matches.length > 1 || !resolution) {
        unchangedAudits.push(audit(row.id, "update", "failure", conflict.reason));
        conflicts.push(conflict);
        outcomes.push({ questionId: row.id, externalId: row.external_id, status: "conflict", reason: conflict.reason });
      } else if (resolution.action === "keep") {
        unchangedAudits.push(audit(row.id, "update", "skipped", "kept_current"));
        outcomes.push({ questionId: row.id, externalId: row.external_id, status: "skipped", reason: "kept_current" });
      } else {
        // Guarded on BOTH the row's post-write revision and `now` — revision
        // alone isn't enough (see buildTagLinkStatements: a different
        // concurrent writer could legitimately reach the same revision
        // value).
        const linkStatements = buildTagLinkStatements(
          c.env.DB, row.id, desiredTagIds, currentTagIdsByQuestion.get(row.id) ?? [],
          { questionId: row.id, revision: row.revision + 1, updatedAt: now },
        );
        pending.push({ statements: [updateStatement(c.env.DB, row, q, now, true, desiredTagIds), audit(row.id, "update", "conditional"), ...linkStatements], id: row.id, externalId: row.external_id, status: "updated" });
      }
    }
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
  for (let start = 0; start < pending.length; start += 50) {
    const batch = pending.slice(start, start + 50);
    // Each item's own primary (row) statement's position within the
    // flattened batch — needed to read back its changes() since items now
    // carry a variable number of trailing tag-link statements.
    const primaryIndexOf: number[] = [];
    const flatStatements: D1PreparedStatement[] = [];
    for (const p of batch) {
      primaryIndexOf.push(flatStatements.length);
      flatStatements.push(...p.statements);
    }
    try {
      const results = await c.env.DB.batch(flatStatements);
      batch.forEach((p, i) => {
        const changed = results[primaryIndexOf[i]!]!.meta.changes > 0;
        outcomes.push({ questionId: p.id, externalId: p.externalId,
          status: changed ? p.status : "conflict", reason: changed ? undefined : "stale_question; refresh preview" });
      });
    } catch {
      await c.env.DB.batch(batch.map((p) => audit(p.id, p.status === "created" ? "create" : "update", "failure", "batch_rolled_back")));
      batch.forEach(p => outcomes.push({ questionId: p.id, externalId: p.externalId, status: "failed", reason: "Batch rolled back; refresh preview to check identity conflicts before retrying." }));
    }
  }
  const created = outcomes.filter(o => o.status === "created").length;
  const updated = outcomes.filter(o => o.status === "updated").length;
  const skipped = outcomes.filter(o => o.status === "skipped" || o.status === "conflict").length;
  const failed = outcomes.filter(o => o.status === "failed").length;
  if (created || updated) await invalidatePracticeQuestions(c.env, examId);

  // parseJsonBody already rejected anything over IMPORT_BODY_MAX_BYTES before
  // the D1 writes above ever ran, so parsed.raw is already within that same
  // budget here — no second size check needed (and doing one this late,
  // after questions are already committed to D1, would leave an import
  // partially applied with no matching archive/log row).
  const r2Key = `imports/${examId}/${Date.now()}-${crypto.randomUUID()}.json`;
  await c.env.BUCKET.put(r2Key, parsed.raw, { httpMetadata: { contentType: "application/json" } });

  const importLogId = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO import_logs (id, exam_id, uploaded_by, r2_object_key, question_count, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(importLogId, examId, c.get("user").id, r2Key, file.questions.length, now)
    .run();

  // Keep the audit log indefinitely but bound raw source retention. Old log
  // downloads intentionally return 404 once their archived object expires.
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
