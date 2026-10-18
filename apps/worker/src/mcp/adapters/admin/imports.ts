import { McpApplicationError } from "../../errors";
import { buildAdminMutationAuditStatement, buildConditionalAdminMutationAuditStatement, recordAdminMutationAudit } from "../../audit";
import { getExam as getExamRecord } from "../../../lib/examManagement";
import {
  createStatement, payloadOf, searchQuestions as searchQuestionsQuery, updateStatement, type QuestionRow,
} from "../../../lib/questionManagement";
import { invalidatePracticeQuestions } from "../../../lib/practiceCache";
import {
  findQuestionRows as findQuestionRowsByExternalId, classifyImportRows, cleanOldImportArchives,
  fileToken as computeFileToken, requestFingerprint as computeRequestFingerprint, getCommittedImportItems,
  buildCommittedImportItemStatement, buildConditionalCommittedImportItemStatement, type ImportConflictResolution,
} from "../../../lib/importExecution";
import {
  normalizeImportFile, exportComponentPackage, MissingExportExternalIdError,
  validateImportFile as validateImportFileContents,
} from "@prepdeck/shared";
import {
  fetchTagIdsForQuestions, buildTagLinkStatements, buildTagNameResolver, tagResolutionSnapshot,
} from "../../../lib/questionBankTags";
import { assertImportFileDepth, type AdminAdapterContext } from "./context";

// Admin MCP import workflow: validate, preview, execute (claimed, resumable
// and replay-safe per importId) and status.
export function importOperations(ctx: AdminAdapterContext) {
  const { db, env, principal, requireExam } = ctx;

  // --- Import execution helpers (implementation) ----------------------------------
  const STALE_IMPORT_MS = 2 * 60 * 1000;

  interface ImportJobRow {
    id: string; exam_id: string; admin_user_id: string; file_token: string; request_fingerprint: string;
    status: "in_progress" | "completed" | "partial" | "failed";
    question_count: number; created_count: number; updated_count: number; skipped_count: number; failed_count: number;
    r2_object_key: string | null; result_json: string | null;
    created_at: number; updated_at: number; completed_at: number | null;
  }

  async function consumeImportRateLimit(kind: "validate" | "execute", examId: string): Promise<void> {
    const limiter = kind === "validate" ? env.IMPORT_VALIDATE_RATE_LIMITER : env.IMPORT_EXECUTE_RATE_LIMITER;
    // implementation — same unavailable/rate_limited distinction as the other
    // operation-level limiters. Cloudflare's native Rate Limiting binding
    // doesn't return a retryAfter, unlike the Durable-Object-backed
    // consumeRateLimit() the other two limiters use, so there is none to
    // propagate here.
    const result = await limiter.limit({ key: `${principal.userId}:${examId}` }).catch(() => null);
    if (!result) throw new McpApplicationError("unavailable");
    if (!result.success) throw new McpApplicationError("rate_limited");
  }

  // Atomically claims `importId` for this execute attempt via the PRIMARY KEY
  // insert itself: two concurrent executes of the same importId race the
  // same INSERT and exactly one wins, so there is no separate check-then-
  // insert window for the loser to slip through. See the plan's "Import
  // execute: concurrency, durability, and replay" section for the full state
  // machine below (fingerprint mismatch, terminal replay, stale-failure
  // clearing, and stale in_progress takeover).
  async function claimImportJob(claim: {
    importId: string; examId: string; fileTok: string; fingerprint: string; questionCount: number;
  }): Promise<{ resuming: boolean; row: ImportJobRow }> {
    const nowMs = Date.now();
    try {
      await db.prepare(
        `INSERT INTO admin_mcp_import_jobs
           (id, exam_id, admin_user_id, file_token, request_fingerprint, status, question_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, ?)`,
      ).bind(claim.importId, claim.examId, principal.userId, claim.fileTok, claim.fingerprint, claim.questionCount, nowMs, nowMs).run();
      const row = await db.prepare("SELECT * FROM admin_mcp_import_jobs WHERE id = ?").bind(claim.importId).first<ImportJobRow>();
      return { resuming: false, row: row! };
    } catch {
      const existing = await db.prepare("SELECT * FROM admin_mcp_import_jobs WHERE id = ?").bind(claim.importId).first<ImportJobRow>();
      if (!existing) throw new McpApplicationError("internal");
      if (existing.request_fingerprint !== claim.fingerprint) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_execute_import", action: "import_execute", examId: claim.examId, targetIds: [claim.importId],
          outcome: "failure", detail: { reason: "proposal_id_reused_with_different_request" },
        });
        throw new McpApplicationError("conflict");
      }
      if (existing.status !== "in_progress") {
        const hasCommitted = existing.created_count > 0 || existing.updated_count > 0;
        if (hasCommitted || existing.status !== "failed") return { resuming: true, row: existing };
        // Terminal failure with nothing ever committed — nothing to preserve,
        // so clear the stale claim and let the caller retry as if this
        // importId were unused. The WHERE clause re-checks the same
        // predicate so a second concurrent retrier can't also "win" this
        // delete and then both proceed to insert fresh claims.
        const cleared = await db.prepare(
          "DELETE FROM admin_mcp_import_jobs WHERE id = ? AND status = 'failed' AND created_count = 0 AND updated_count = 0",
        ).bind(claim.importId).run();
        if (cleared.meta.changes === 0) return { resuming: true, row: existing };
        return claimImportJob(claim);
      }
      const isStale = nowMs - existing.updated_at > STALE_IMPORT_MS;
      if (!isStale) throw new McpApplicationError("conflict");
      const cas = await db.prepare("UPDATE admin_mcp_import_jobs SET updated_at = ? WHERE id = ? AND updated_at = ?")
        .bind(nowMs, claim.importId, existing.updated_at).run();
      if (cas.meta.changes === 0) throw new McpApplicationError("conflict");
      return { resuming: true, row: { ...existing, updated_at: nowMs } };
    }
  }

  return {
    // --- Import workflow (implementation) ------------------------------------------
    // Reuses lib/importConflicts.ts's re-import preservation rules and
    // lib/importExecution.ts's classification, unchanged from REST (see
    // routes/imports.ts). Preview never writes to D1. Execute binds to the
    // exact reviewed file via fileToken and to the exact reviewed
    // conflictResolutions via requestFingerprint, and claims `importId`
    // atomically in admin_mcp_import_jobs (claimImportJob, above) so a
    // concurrent or replayed execute can't double-apply or silently diverge
    // from what was reviewed.
    async exportQuestions(input: { examId: string; limit?: number; offset?: number }) {
      await requireExam(input.examId);
      const result = await searchQuestionsQuery(db, input.examId, { limit: input.limit ?? 50, offset: input.offset ?? 0 });
      if (!result.questions.length) throw new McpApplicationError("not_found");
      const exam = (await getExamRecord(db, input.examId))!;
      let file;
      try { file = exportComponentPackage({ id: exam.id, name: exam.name }, result.questions.map(payloadOf)); }
      catch (error) { throw new McpApplicationError(error instanceof MissingExportExternalIdError ? "export_requires_external_id" : "conflict"); }
      return { file,
        total: result.total, offset: result.offset, nextOffset: result.offset + result.questions.length < result.total ? result.offset + result.questions.length : null };
    },

    async validateImport(input: { examId: string; file: unknown }) {
      await consumeImportRateLimit("validate", input.examId);
      await requireExam(input.examId);
      assertImportFileDepth(input.file);
      const { issues, duplicateExternalIdsInFile, questionCount } = validateImportFileContents(input.file);
      return { valid: issues.length === 0, questionCount, issues, duplicateExternalIdsInFile };
    },

    async previewImport(input: { examId: string; file: unknown }) {
      await consumeImportRateLimit("validate", input.examId);
      await requireExam(input.examId);
      assertImportFileDepth(input.file);
      const { issues, duplicateExternalIdsInFile, questionCount } = validateImportFileContents(input.file);
      if (issues.length > 0) {
        return {
          importId: null, importToken: null, valid: false, questionCount, issues, duplicateExternalIdsInFile,
          duplicateExternalIdsInDb: [], creates: [], updates: [], skips: [], conflicts: [],
        };
      }
      const file = normalizeImportFile(input.file);
      const externalIds = file.questions.map((q) => q.externalId).filter((x): x is string => !!x);
      const existing = externalIds.length ? await findQuestionRowsByExternalId(db, input.examId, externalIds) : [];
      const duplicateExternalIdsInDb = [...new Set(existing.map((r) => r.external_id!).filter(Boolean))];
      const classification = await classifyImportRows(db, existing, file.questions);
      // Snapshots what every tag name in the file currently resolves to
      // (read-only) and binds it into importToken alongside the file
      // content, so a taxonomy change before execute (a rename/merge that
      // changes what an unchanged name would now resolve to) is detected as
      // a stale proposal instead of silently committing a different tag
      // identity than the one reviewed here — see fileToken's own comment.
      const tagSnapshot = await tagResolutionSnapshot(db, file.questions.flatMap((q) => q.tags ?? []));
      return {
        importId: crypto.randomUUID(),
        importToken: await computeFileToken(input.examId, input.file, tagSnapshot),
        valid: true, questionCount, duplicateExternalIdsInFile, duplicateExternalIdsInDb,
        creates: classification.creates, updates: classification.updates,
        skips: classification.skips, conflicts: classification.conflicts,
      };
    },

    async executeImport(input: {
      examId: string; file: unknown; importId: string; importToken: string;
      conflictResolutions?: ImportConflictResolution[];
    }) {
      await consumeImportRateLimit("execute", input.examId);
      await requireExam(input.examId);
      assertImportFileDepth(input.file);

      // Re-resolved against CURRENT catalog state (not the preview-time
      // state) — a mismatch against input.importToken below means either
      // the file changed OR the taxonomy did (see fileToken's comment).
      const executeTimeTagSnapshot = await tagResolutionSnapshot(db, (input.file as { questions?: { tags?: string[] }[] }).questions?.flatMap((q) => q.tags ?? []) ?? []);
      const computedFileToken = await computeFileToken(input.examId, input.file, executeTimeTagSnapshot);
      if (computedFileToken !== input.importToken) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [input.importId],
          outcome: "failure", detail: { reason: "stale_proposal" },
        });
        throw new McpApplicationError("conflict");
      }

      const { issues, questionCount } = validateImportFileContents(input.file);
      if (issues.length > 0) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [input.importId],
          outcome: "failure", detail: { reason: "invalid_input" },
        });
        throw new McpApplicationError("invalid_input");
      }
      const file = normalizeImportFile(input.file);
      const resolutions = input.conflictResolutions ?? [];
      const fingerprint = await computeRequestFingerprint(computedFileToken, resolutions);

      const { resuming, row: jobRow } = await claimImportJob({
        importId: input.importId, examId: input.examId, fileTok: computedFileToken, fingerprint, questionCount,
      });
      if (jobRow.status !== "in_progress") {
        return { importId: input.importId, idempotentReplay: true, ...(jobRow.result_json ? JSON.parse(jobRow.result_json) : {}) };
      }

      const now = new Date().toISOString();
      let r2Key = jobRow.r2_object_key;
      if (!r2Key) {
        r2Key = `imports/${input.examId}/${Date.now()}-${crypto.randomUUID()}.json`;
        try {
          await env.BUCKET.put(r2Key, JSON.stringify(input.file), { httpMetadata: { contentType: "application/json" } });
        } catch {
          if (!resuming) await db.prepare("DELETE FROM admin_mcp_import_jobs WHERE id = ?").bind(input.importId).run();
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [input.importId],
            outcome: "failure", detail: { reason: "archive_failed" },
          });
          throw new McpApplicationError("internal");
        }
        // No executionCtx.waitUntil is available at this layer (unlike the
        // Hono routes), so this runs inline rather than backgrounded like
        // REST's equivalent — same retention behavior, slightly more latency
        // on the call that happens to write a fresh archive.
        await cleanOldImportArchives(env.BUCKET, input.examId, r2Key).catch(() => {});
        await db.prepare("UPDATE admin_mcp_import_jobs SET r2_object_key = ?, updated_at = ? WHERE id = ?")
          .bind(r2Key, Date.now(), input.importId).run();
      }

      const externalIds = file.questions.map((q) => q.externalId).filter((x): x is string => !!x);
      const existingRows = externalIds.length ? await findQuestionRowsByExternalId(db, input.examId, externalIds) : [];
      const classification = await classifyImportRows(db, existingRows, file.questions);
      const resolutionByQuestion = new Map(resolutions.map((r) => [r.questionId, r]));
      // Bulk-resolve every distinct tag name in the file once (implementation),
      // rather than once per created/updated row below.
      const resolveTagIds = await buildTagNameResolver(db, file.questions.flatMap((q) => q.tags ?? []), now);

      type ExecuteOutcome = {
        index: number; questionId: string; externalId: string | null;
        status: "created" | "updated" | "skipped" | "conflict" | "failed"; reason?: string;
      };
      const outcomes: ExecuteOutcome[] = [];
      const pendingApplies: { index: number; row: QuestionRow }[] = [];

      // implementation (review round 2) — recover what a PRIOR attempt of this
      // exact importId already committed before reclassifying anything.
      // Without this, re-running classifyImportRows against current DB state
      // makes an already-applied create/update look "identical" to its
      // incoming payload and reclassifies it as a plain skip — silently
      // losing track of it in this attempt's created/updated counts (and
      // therefore in the final result and cache-invalidation decision).
      // Indices recorded here are excluded from every classification bucket
      // below and never reprocessed.
      const alreadyCommitted = await getCommittedImportItems(db, input.importId);
      for (const item of alreadyCommitted.values()) {
        outcomes.push({ index: item.itemIndex, questionId: item.questionId, externalId: item.externalId, status: item.kind });
      }

      // Matches REST's exact rule (routes/imports.ts): ANY non-identical row
      // — whether classifyImportRows called it a candidate "update" or a
      // "conflict" — needs an explicit, exactly-matching resolution to be
      // applied. Ambiguous external ids are never resolvable at all.
      const needsResolution = [
        ...classification.updates.map((u) => ({ ...u, ambiguous: false as const, reason: undefined as string | undefined })),
        ...classification.conflicts.map((c) => ({
          index: c.index, questionId: c.questionId, externalId: c.externalId,
          expectedRevision: c.expectedRevision, incomingToken: c.incomingToken,
          reason: c.reason as string | undefined, ambiguous: c.reason === "ambiguous_external_id",
        })),
      ];
      for (const item of needsResolution) {
        if (alreadyCommitted.has(item.index)) continue;
        if (item.ambiguous) {
          outcomes.push({ index: item.index, questionId: item.questionId, externalId: item.externalId, status: "conflict", reason: "ambiguous_external_id" });
          continue;
        }
        const resolution = resolutionByQuestion.get(item.questionId);
        const valid = resolution && resolution.expectedRevision === item.expectedRevision && resolution.incomingToken === item.incomingToken;
        if (!valid) {
          outcomes.push({ index: item.index, questionId: item.questionId, externalId: item.externalId, status: "conflict", reason: item.reason ?? "incoming_changes" });
          continue;
        }
        if (resolution!.action === "keep") {
          outcomes.push({ index: item.index, questionId: item.questionId, externalId: item.externalId, status: "skipped", reason: "kept_current" });
          continue;
        }
        const row = existingRows.find((r) => r.id === item.questionId)!;
        pendingApplies.push({ index: item.index, row });
      }
      for (const skip of classification.skips) {
        if (alreadyCommitted.has(skip.index)) continue;
        outcomes.push({ index: skip.index, questionId: skip.questionId, externalId: skip.externalId, status: "skipped", reason: skip.reason });
      }

      // Resume-safety for creates now lives entirely in the pre-filter above
      // (alreadyCommitted), backed by admin_mcp_import_committed_items
      // (migration 0024) rather than implementation's admin_mcp_create_operations —
      // that ledger stays reserved for admin_create_question/
      // admin_batch_create_questions' own idempotency, unrelated to imports.
      const creates = classification.creates.filter((c) => !alreadyCommitted.has(c.index));

      // Chunked by item count for import-execute-specific reasons (bounded
      // per-attempt commit size, not a hard D1 statement-count limit —
      // admin_batch_create_questions/admin_batch_update_questions already
      // run well past 50 statements in a single db.batch() without issue).
      // Each item's tag-link statements are pushed into the SAME chunk
      // `statements` array as its row write, so both commit or roll back
      // together (implementation review — question_tag_links is authoritative
      // content, not a best-effort side effect).
      for (let start = 0; start < creates.length; start += 16) {
        const chunk = creates.slice(start, start + 16);
        const statements: D1PreparedStatement[] = [];
        const meta: { index: number; id: string; externalId: string | null }[] = [];
        for (const c of chunk) {
          const q = file.questions[c.index]!;
          const id = crypto.randomUUID();
          const tagIds = resolveTagIds(q.tags);
          // imported=true records import_baseline_json (and, alongside it,
          // the resolved tagIds as import_baseline_tag_ids_json — see
          // lib/importConflicts.ts), matching REST's execute route —
          // without it, a *future* re-import of this same externalId could
          // never distinguish "locally edited since" from "safe incoming
          // change".
          statements.push(createStatement(db, input.examId, id, q, now, true, tagIds));
          statements.push(buildCommittedImportItemStatement(db, {
            importId: input.importId, itemIndex: c.index, questionId: id, examId: input.examId, externalId: c.externalId, kind: "created",
          }));
          statements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [id],
            outcome: "success", detail: { importId: input.importId, externalId: c.externalId },
          }));
          // A fresh id has no revision to race — unconditional, same as
          // createQuestion/admin_batch_create_questions.
          statements.push(...buildTagLinkStatements(db, id, tagIds, []));
          meta.push({ index: c.index, id, externalId: c.externalId });
        }
        if (statements.length === 0) continue;
        try {
          await db.batch(statements);
          for (const m of meta) outcomes.push({ index: m.index, questionId: m.id, externalId: m.externalId, status: "created" });
        } catch {
          for (const m of meta) outcomes.push({ index: m.index, questionId: m.id, externalId: m.externalId, status: "failed", reason: "batch_rolled_back" });
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: meta.map((m) => m.id),
            outcome: "failure", detail: { reason: "batch_rolled_back" },
          });
        }
      }

      const currentTagIdsByQuestion = await fetchTagIdsForQuestions(db, pendingApplies.map((a) => a.row.id));
      for (let start = 0; start < pendingApplies.length; start += 16) {
        const chunk = pendingApplies.slice(start, start + 16);
        const statements: D1PreparedStatement[] = [];
        // `updateStatementIndex` replaces the old fixed `i * 3` arithmetic:
        // each item now carries a variable number of trailing tag-link
        // statements (see below), so its primary update statement's
        // position must be tracked explicitly rather than assumed.
        const meta: { index: number; questionId: string; externalId: string | null; updateStatementIndex: number }[] = [];
        for (const a of chunk) {
          const q = file.questions[a.index]!;
          const tagIds = resolveTagIds(q.tags);
          const updateStatementIndex = statements.length;
          // Order matters: buildConditionalCommittedImportItemStatement reads
          // changes() from THIS updateStatement, and the audit statement
          // after it reads changes() from the committed-item insert in turn
          // (verified: a 0-row conditional INSERT still sets changes()=0,
          // propagating a stale-revision "no" through the whole chain). The
          // tag-link statements below go AFTER both — nothing may run
          // between updateStatement and its two dependent changes()-chained
          // statements.
          statements.push(updateStatement(db, a.row, q, now, true, tagIds));
          statements.push(buildConditionalCommittedImportItemStatement(db, {
            importId: input.importId, itemIndex: a.index, questionId: a.row.id, examId: input.examId,
            externalId: a.row.external_id, kind: "updated",
          }));
          statements.push(buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [a.row.id],
            successDetail: { importId: input.importId }, failureDetail: { reason: "stale_question" },
          }));
          // Guarded on the row's own post-update revision AND `now` (rather
          // than relying on changes()-chaining, which only reflects the
          // single immediately-preceding statement, or on revision alone —
          // see buildTagLinkStatements: a different concurrent writer could
          // legitimately reach the same revision value) — a stale-revision
          // update that changed zero rows leaves the row's revision and
          // updated_at unchanged, so this guard fails closed, in the SAME
          // batch as the update itself rather than a separate best-effort
          // step (implementation review).
          statements.push(...buildTagLinkStatements(
            db, a.row.id, tagIds, currentTagIdsByQuestion.get(a.row.id) ?? [],
            { questionId: a.row.id, revision: a.row.revision + 1, updatedAt: now },
          ));
          meta.push({ index: a.index, questionId: a.row.id, externalId: a.row.external_id, updateStatementIndex });
        }
        try {
          const results = await db.batch(statements);
          meta.forEach((m) => {
            const changed = results[m.updateStatementIndex]!.meta.changes > 0;
            outcomes.push({
              index: m.index, questionId: m.questionId, externalId: m.externalId,
              status: changed ? "updated" : "conflict", reason: changed ? undefined : "stale_question; refresh preview",
            });
          });
        } catch {
          meta.forEach((m) => outcomes.push({ index: m.index, questionId: m.questionId, externalId: m.externalId, status: "failed", reason: "batch_rolled_back" }));
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: meta.map((m) => m.questionId),
            outcome: "failure", detail: { reason: "batch_rolled_back" },
          });
        }
      }

      const created = outcomes.filter((o) => o.status === "created").length;
      const updated = outcomes.filter((o) => o.status === "updated").length;
      const skipped = outcomes.filter((o) => o.status === "skipped" || o.status === "conflict").length;
      const failed = outcomes.filter((o) => o.status === "failed").length;
      const status: "completed" | "partial" | "failed" = failed === 0 ? "completed" : (created + updated > 0 ? "partial" : "failed");

      // Lean summary only — no payload content/differences, so this table
      // doesn't duplicate content outside R2's archive/retention policy.
      const leanOutcomes = outcomes.map((o) => ({ questionId: o.questionId, externalId: o.externalId, status: o.status, reason: o.reason }));
      const resultSummary = { total: file.questions.length, created, updated, skipped, failed, outcomes: leanOutcomes };
      const completedAtMs = Date.now();
      await db.prepare(
        `UPDATE admin_mcp_import_jobs SET status = ?, created_count = ?, updated_count = ?, skipped_count = ?, failed_count = ?,
           result_json = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(status, created, updated, skipped, failed, JSON.stringify(resultSummary), completedAtMs, completedAtMs, input.importId).run();

      // Same table REST writes, so MCP-originated imports appear in the
      // existing GET /logs history.
      const importLogId = crypto.randomUUID();
      await db.prepare(
        "INSERT INTO import_logs (id, exam_id, uploaded_by, r2_object_key, question_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(importLogId, input.examId, principal.userId, r2Key, file.questions.length, now).run();

      if (created > 0 || updated > 0) await invalidatePracticeQuestions(env, input.examId).catch(() => {});

      return { importId: input.importId, total: file.questions.length, created, updated, skipped, failed, outcomes: leanOutcomes };
    },

    async getImportStatus(input: { importId: string }) {
      const row = await db.prepare("SELECT * FROM admin_mcp_import_jobs WHERE id = ?").bind(input.importId).first<ImportJobRow>();
      if (!row) throw new McpApplicationError("not_found");
      return {
        importId: row.id, examId: row.exam_id, status: row.status, questionCount: row.question_count,
        createdCount: row.created_count, updatedCount: row.updated_count,
        skippedCount: row.skipped_count, failedCount: row.failed_count,
        result: row.result_json ? JSON.parse(row.result_json) : null,
        createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
      };
    },
  };
}
