import { McpApplicationError } from "../../errors";
import { buildAdminMutationAuditStatement, buildConditionalAdminMutationAuditStatement, recordAdminMutationAudit } from "../../audit";
import { getExam as getExamRecord } from "../../../lib/examManagement";
import { payloadOf, searchQuestions as searchQuestionsQuery } from "../../../lib/questionManagement";
import { invalidatePracticeQuestions } from "../../../lib/practiceCache";
import {
  fileToken as computeFileToken, requestFingerprint as computeRequestFingerprint, getCommittedImportItems,
  buildCommittedImportItemStatement, buildConditionalCommittedImportItemStatement,
} from "../../../lib/importExecution";
import {
  archiveImportFile, classifyImportDecisions, cleanOldImportArchives, commitImportWrites, countImportOutcomes,
  decideImportRows, findImportTargets, importTagNames, isCleanUpdate, limitImportRequest, planImportWrites,
  recordImportLog, validateImport,
  type ChangedImportRow, type ImportConflictResolution, type ImportOutcomeStatus, type ImportRowDecision,
} from "../../../lib/questionImport";
import { exportComponentPackage, MissingExportExternalIdError, validateImportFile as validateImportFileContents } from "@prepdeck/shared";
import { tagResolutionSnapshot } from "../../../lib/questionBankTags";
import { assertImportFileDepth, type AdminAdapterContext } from "./context";

// Admin MCP import workflow: validate, preview, execute (claimed, resumable
// and replay-safe per importId) and status. The pipeline itself is
// lib/questionImport.ts, shared with the REST import routes.
export function importOperations(ctx: AdminAdapterContext) {
  const { db, env, principal, requireExam } = ctx;

  // --- Import execution helpers (implementation) ----------------------------------
  const STALE_IMPORT_MS = 2 * 60 * 1000;
  // Planned writes per atomic D1 batch: a bounded per-attempt commit size for
  // import execute, not a D1 statement-count limit (admin_batch_create_questions
  // and admin_batch_update_questions already run well past 50 statements in a
  // single db.batch()). REST commits 50 per batch.
  const IMPORT_ITEMS_PER_BATCH = 16;

  interface ImportJobRow {
    id: string; exam_id: string; admin_user_id: string; file_token: string; request_fingerprint: string;
    status: "in_progress" | "completed" | "partial" | "failed";
    question_count: number; created_count: number; updated_count: number; skipped_count: number; failed_count: number;
    r2_object_key: string | null; result_json: string | null;
    created_at: number; updated_at: number; completed_at: number | null;
  }

  async function consumeImportRateLimit(kind: "validate" | "execute", examId: string): Promise<void> {
    // implementation — same unavailable/rate_limited distinction as the other
    // operation-level limiters. Cloudflare's native Rate Limiting binding
    // doesn't return a retryAfter, unlike the Durable-Object-backed
    // consumeRateLimit() the other two limiters use, so there is none to
    // propagate here.
    const allowed = await limitImportRequest(env, kind, principal.userId, examId).catch(() => null);
    if (allowed === null) throw new McpApplicationError("unavailable");
    if (!allowed) throw new McpApplicationError("rate_limited");
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
      if (existing.admin_user_id !== principal.userId || existing.exam_id !== claim.examId ||
          existing.file_token !== claim.fileTok || existing.request_fingerprint !== claim.fingerprint) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_execute_import", action: "import_execute", examId: claim.examId, targetIds: [claim.importId],
          outcome: "failure", detail: { reason: "proposal_id_reused_with_different_request" },
        });
        throw new McpApplicationError("conflict");
      }
      if (existing.status !== "in_progress") {
        const hasCommitted = existing.created_count > 0 || existing.updated_count > 0;
        if (hasCommitted || existing.status !== "failed") return { resuming: true, row: existing };
        // Retry a failed empty job without deleting its own-tag evidence.
        // Tag registration may have committed before any question did.
        const reset = await db.prepare(
          `UPDATE admin_mcp_import_jobs SET status = 'in_progress', result_json = NULL,
             skipped_count = 0, failed_count = 0, completed_at = NULL, updated_at = ?
           WHERE id = ? AND status = 'failed' AND created_count = 0 AND updated_count = 0 AND updated_at = ?`,
        ).bind(nowMs, claim.importId, existing.updated_at).run();
        if (reset.meta.changes === 0) throw new McpApplicationError("conflict");
        return { resuming: true, row: { ...existing, status: "in_progress", result_json: null,
          skipped_count: 0, failed_count: 0, completed_at: null, updated_at: nowMs } };
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
      const { issues, duplicateExternalIdsInFile, questionCount, file } = validateImport(input.file);
      if (!file) {
        return {
          importId: null, importToken: null, valid: false, questionCount, issues, duplicateExternalIdsInFile,
          duplicateExternalIdsInDb: [], creates: [], updates: [], skips: [], conflicts: [],
        };
      }
      const existing = await findImportTargets(db, input.examId, file.questions);
      // De-duplicated, unlike REST's /validate, which lists an ambiguous
      // externalId once per matching row.
      const duplicateExternalIdsInDb = [...new Set(existing.map((r) => r.external_id!).filter(Boolean))];
      const classification = classifyImportDecisions(await decideImportRows(db, existing, file.questions));
      // Snapshots what every tag name in the file currently resolves to
      // (read-only) and binds it into importToken alongside the file
      // content, so a taxonomy change before execute (a rename/merge that
      // changes what an unchanged name would now resolve to) is detected as
      // a stale proposal instead of silently committing a different tag
      // identity than the one reviewed here — see fileToken's own comment.
      const tagSnapshot = await tagResolutionSnapshot(db, importTagNames(file.questions));
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

      const resolutions = input.conflictResolutions ?? [];
      const fingerprint = await computeRequestFingerprint(input.importToken, resolutions);
      const existingJob = await db.prepare("SELECT * FROM admin_mcp_import_jobs WHERE id = ?")
        .bind(input.importId).first<ImportJobRow>();
      if (existingJob && (existingJob.admin_user_id !== principal.userId || existingJob.exam_id !== input.examId ||
          existingJob.file_token !== input.importToken || existingJob.request_fingerprint !== fingerprint)) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [input.importId],
          outcome: "failure", detail: { reason: "proposal_id_reused_with_different_request" },
        });
        throw new McpApplicationError("conflict");
      }

      // Reconstruct only this job's proven null -> ID transitions. An external
      // rename/merge/delete of even a job-created tag must fail closed. Legacy
      // jobs without evidence retain the strict current-catalog token check.
      const verifyImportToken = async () => {
        const snapshot = await tagResolutionSnapshot(db, (input.file as { questions?: { tags?: string[] }[] }).questions?.flatMap((q) => q.tags ?? []) ?? []);
        const { results } = await db.prepare(
          "SELECT normalized_name, tag_id FROM admin_mcp_import_created_tags WHERE import_id = ?",
        ).bind(input.importId).all<{ normalized_name: string; tag_id: string }>();
        let matchesEvidence = true;
        for (const tag of results ?? []) {
          if (snapshot[tag.normalized_name] !== tag.tag_id) matchesEvidence = false;
          else snapshot[tag.normalized_name] = null;
        }
        if (!matchesEvidence || await computeFileToken(input.examId, input.file, snapshot) !== input.importToken) {
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [input.importId],
            outcome: "failure", detail: { reason: "stale_proposal" },
          });
          throw new McpApplicationError("conflict");
        }
      };
      await verifyImportToken();

      const { questionCount, file } = validateImport(input.file);
      if (!file) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: [input.importId],
          outcome: "failure", detail: { reason: "invalid_input" },
        });
        throw new McpApplicationError("invalid_input");
      }
      const { resuming, row: jobRow } = await claimImportJob({
        importId: input.importId, examId: input.examId, fileTok: input.importToken, fingerprint, questionCount,
      });
      if (jobRow.status !== "in_progress") {
        return { importId: input.importId, idempotentReplay: true, ...(jobRow.result_json ? JSON.parse(jobRow.result_json) : {}) };
      }

      // Unlike REST, which archives after its writes, the file is archived
      // before anything is written, so a failed archive leaves no partial import.
      const now = new Date().toISOString();
      let r2Key = jobRow.r2_object_key;
      if (!r2Key) {
        try {
          r2Key = await archiveImportFile(env.BUCKET, input.examId, JSON.stringify(input.file));
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

      const existingRows = await findImportTargets(db, input.examId, file.questions);
      const decisions = await decideImportRows(db, existingRows, file.questions);

      const outcomes: {
        index: number; questionId: string; externalId: string | null; status: ImportOutcomeStatus; reason?: string;
      }[] = [];

      // implementation (review round 2) — recover what a PRIOR attempt of this
      // exact importId already committed before reclassifying anything.
      // Without this, re-running the classification against current DB state
      // makes an already-applied create/update look "identical" to its
      // incoming payload and reclassifies it as a plain skip — silently
      // losing track of it in this attempt's created/updated counts (and
      // therefore in the final result and cache-invalidation decision).
      // Indices recorded here are left out of the plan below and never
      // reprocessed. (This replaces implementation's admin_mcp_create_operations
      // for imports; that ledger stays reserved for admin_create_question/
      // admin_batch_create_questions' own idempotency.)
      const alreadyCommitted = await getCommittedImportItems(db, input.importId);
      for (const item of alreadyCommitted.values()) {
        outcomes.push({ index: item.itemIndex, questionId: item.questionId, externalId: item.externalId, status: item.kind });
      }

      // Matches REST's rule: ANY non-identical row — whether preview called it
      // an "update" or a "conflict" — needs an explicit, exactly-matching
      // resolution to be applied. Ordered as this tool has always reported
      // outcomes: preview's updates, then its conflicts, then identical skips;
      // then the creates and updates this attempt commits.
      const pending = decisions.filter((d) => !alreadyCommitted.has(d.index));
      const changed = pending.filter((d): d is ChangedImportRow => d.kind === "changed");
      const ordered: ImportRowDecision[] = [
        ...changed.filter(isCleanUpdate), ...changed.filter((d) => !isCleanUpdate(d)),
        ...pending.filter((d) => d.kind === "identical"), ...pending.filter((d) => d.kind === "create"),
      ];
      const resolutionByQuestion = new Map(resolutions.map((r) => [r.questionId, r]));
      const plan = await planImportWrites(db, {
        examId: input.examId, questions: file.questions, decisions: ordered, now,
        // The last resolution naming the question, if several do.
        resolutionFor: (d) => resolutionByQuestion.get(d.row.id),
        tagCreatedStatement: (tagId, normalizedName) => db.prepare(
          `INSERT INTO admin_mcp_import_created_tags (import_id, normalized_name, tag_id)
           SELECT ?, ?, ? WHERE changes() > 0`,
        ).bind(input.importId, normalizedName, tagId),
        // A create either inserts its row or throws, so its ledger entry and
        // audit row are unconditional. An update's are chained on changes():
        // the ledger entry reads the UPDATE's, and the audit row reads the
        // ledger entry's in turn (a 0-row conditional INSERT still sets
        // changes()=0, propagating a stale-revision "no" through the chain).
        chainedStatements: (w) => w.kind === "create" ? [
          buildCommittedImportItemStatement(db, {
            importId: input.importId, itemIndex: w.index, questionId: w.questionId, examId: w.examId, externalId: w.externalId, kind: "created",
          }),
          buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: w.examId, targetIds: [w.questionId],
            outcome: "success", detail: { importId: input.importId, externalId: w.externalId },
          }),
        ] : [
          buildConditionalCommittedImportItemStatement(db, {
            importId: input.importId, itemIndex: w.index, questionId: w.questionId, examId: w.examId, externalId: w.externalId, kind: "updated",
          }),
          buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_execute_import", action: "import_execute", examId: w.examId, targetIds: [w.questionId],
            successDetail: { importId: input.importId }, failureDetail: { reason: "stale_question" },
          }),
        ],
      });
      // Resolution can race another catalog writer. Do not accept another
      // job's INSERT OR IGNORE winner (or a concurrent rename) as our mutation.
      // This also verifies the atomic evidence before any question is written.
      await verifyImportToken();
      for (const { decision, status, reason } of plan.unchanged) {
        outcomes.push({ index: decision.index, questionId: decision.row.id, externalId: decision.row.external_id, status, reason });
      }

      // All creates commit before any update.
      const commit = (writes: typeof plan.writes) => commitImportWrites(db, writes, {
        itemsPerBatch: IMPORT_ITEMS_PER_BATCH,
        onRollback: (rolledBack) => recordAdminMutationAudit(db, principal, {
          tool: "admin_execute_import", action: "import_execute", examId: input.examId, targetIds: rolledBack.map((w) => w.questionId),
          outcome: "failure", detail: { reason: "batch_rolled_back" },
        }),
      });
      const results = [
        ...await commit(plan.writes.filter((p) => p.write.kind === "create")),
        ...await commit(plan.writes.filter((p) => p.write.kind === "update")),
      ];
      for (const { write, status } of results) {
        const base = { index: write.index, questionId: write.questionId, externalId: write.externalId };
        if (status === "committed") outcomes.push({ ...base, status: write.kind === "create" ? "created" : "updated" });
        else if (status === "stale") outcomes.push({ ...base, status: "conflict", reason: "stale_question; refresh preview" });
        else outcomes.push({ ...base, status: "failed", reason: "batch_rolled_back" });
      }

      const { created, updated, skipped, failed } = countImportOutcomes(outcomes);
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

      await recordImportLog(db, {
        examId: input.examId, uploadedBy: principal.userId, r2ObjectKey: r2Key, questionCount: file.questions.length, createdAt: now,
      });

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
