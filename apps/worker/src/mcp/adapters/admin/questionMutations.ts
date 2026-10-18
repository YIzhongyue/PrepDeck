import { McpApplicationError } from "../../errors";
import { buildAdminMutationAuditStatement, buildConditionalAdminMutationAuditStatement, recordAdminMutationAudit } from "../../audit";
import {
  MAX_BATCH_MUTATION_ITEMS, answerKey, archiveQuestionStatement, createStatement, getQuestion as getQuestionRow,
  payloadOf, toQuestion, updateStatement, validatePayload,
} from "../../../lib/questionManagement";
import {
  buildCreateOperationStatement, diffPayload, getCreateOperation, getCreateOperations, proposalToken,
  type PayloadDifference,
} from "../../../lib/questionProposals";
import { invalidatePracticeQuestions } from "../../../lib/practiceCache";
import { normalizeImportFile, validateImportFile as validateImportFileContents } from "@prepdeck/shared";
import { resolveOrCreateTags, fetchTagIdsForQuestions, buildTagLinkStatements, buildTagNameResolver } from "../../../lib/questionBankTags";
import { summarize } from "../shared";
import { assertImportFileDepth, type AdminAdapterContext } from "./context";

// Admin MCP question authoring: previewed, revision-checked and audited
// creates, updates, deletes and archival.
export function questionMutationOperations(ctx: AdminAdapterContext) {
  const { db, env, principal, requireExam, requireQuestion, consumeAdminMutationLimit } = ctx;

  async function validateQuestionPayload(input: { examId: string; id?: string; payload: Record<string, unknown> }) {
    await requireExam(input.examId);
    const row = input.id ? await requireQuestion(input.examId, input.id) : undefined;
    const current = row ? toQuestion(row) : undefined;
    const { payload, issues } = validatePayload(input.payload, current);
    if (issues.length > 0) return { valid: false, issues };
    const result: Record<string, unknown> = { valid: true, issues: [], payload };
    if (current && row) {
      result.currentRevision = row.revision;
      result.answerRevised = answerKey(payloadOf(current)) !== answerKey(payload);
      result.diff = diffPayload(current, payload);
    }
    result.proposalToken = await proposalToken({
      examId: input.examId, questionId: input.id, expectedRevision: row?.revision, payload,
    });
    // A fresh id per preview call keeps retries distinct from separately
    // reviewed creates with identical content. Updates use expectedRevision.
    result.proposalId = crypto.randomUUID();
    return result;
  }

  // Issues #92/#93 — admin_archive_question/admin_unarchive_question. The same
  // archiveQuestionStatement as the Admin UI's POST /:id/archive|unarchive, so
  // there is one archival path. No expectedRevision: the transition never
  // touches content or revision, and repeating it is a successful no-op
  // (`changed: false`) rather than a conflict, so an agent can safely retry.
  // The success audit row commits in the same batch as the write.
  async function setQuestionArchived(input: { examId: string; id: string }, archived: boolean) {
    await consumeAdminMutationLimit();
    const tool = archived ? "admin_archive_question" : "admin_unarchive_question";
    const action = archived ? "archive" : "unarchive";
    const before = await requireQuestion(input.examId, input.id);
    const changed = (before.archived_at !== null) !== archived;
    let written: number;
    try {
      const [result] = await db.batch([
        archiveQuestionStatement(db, input.examId, input.id, archived, new Date().toISOString()),
        buildConditionalAdminMutationAuditStatement(db, principal, {
          tool, action, examId: input.examId, targetIds: [input.id],
          successDetail: { changed }, failureDetail: { reason: "not_found" },
        }),
      ]);
      written = result!.meta.changes;
    } catch (error) {
      await recordAdminMutationAudit(db, principal, {
        tool, action, examId: input.examId, targetIds: [input.id], outcome: "failure", detail: { reason: "error" },
      });
      throw error;
    }
    // Deleted between the read above and the write.
    if (!written) throw new McpApplicationError("not_found");
    await invalidatePracticeQuestions(env, input.examId).catch(() => {});
    const question = toQuestion(await requireQuestion(input.examId, input.id));
    return {
      archived: question.archivedAt !== null,
      archivedAt: question.archivedAt,
      changed,
      question: { ...summarize(question), revision: question.revision, archivedAt: question.archivedAt },
    };
  }

  return {
    // --- Question-bank mutations (implementation) --------------------------------
    // Preview (validate) never writes. Every commit method below recomputes
    // proposalToken from the exact target + payload it was given and rejects
    // a mismatch as "conflict" (stale/modified proposal) — see
    // lib/questionProposals.ts. Answer-revision and historical-score
    // preservation come for free from reusing createStatement/updateStatement
    // (lib/questionManagement.ts), unchanged from the Admin REST routes.
    //
    // Every mutation's success audit row is committed in the SAME D1 batch as
    // the mutation itself (create: alongside the insert and idempotency
    // ledger record; update/delete: via buildConditionalAdminMutationAuditStatement,
    // whose outcome/detail are derived from the mutation's own row count via
    // SQLite's changes() rather than decided in JS beforehand) — the two can
    // never diverge, and a genuine SQL error (e.g. duplicate externalId)
    // rolls both back together, falling to a catch block that records the
    // failure separately. Best-effort cache invalidation always runs last,
    // after the audit is already durable, and its failures are swallowed
    // (`.catch(() => {})`, matching touchMcpCredentialLastUsed's use of the
    // same pattern in mcp/routes.ts) — a KV outage must never suppress an
    // already-committed mutation's audit record (both found in review of
    // this PR).
    validateQuestionPayload,

    async previewComponentQuestion(input: { examId: string; id?: string; question: Record<string, unknown>; stimuli?: unknown[]; assets?: unknown[] }) {
      const file = { schemaVersion: "2.0", exam: { id: input.examId, name: "Component question" },
        questions: [input.question], stimuli: input.stimuli ?? [], assets: input.assets ?? [] };
      assertImportFileDepth(file);
      const { issues } = validateImportFileContents(file);
      if (issues.length) return { valid: false, issues };
      const payload = normalizeImportFile(file).questions[0]!;
      return validateQuestionPayload({ examId: input.examId, id: input.id, payload: { ...payload } });
    },

    async createQuestion(input: {
      examId: string; payload: Record<string, unknown>; proposalToken: string; proposalId: string;
    }) {
      await consumeAdminMutationLimit();
      await requireExam(input.examId);
      const { payload, issues } = validatePayload(input.payload);
      if (issues.length > 0) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_create_question", action: "create", examId: input.examId, targetIds: [],
          outcome: "failure", detail: { reason: "invalid_input" },
        });
        throw new McpApplicationError("invalid_input");
      }
      const expected = await proposalToken({ examId: input.examId, payload });
      if (expected !== input.proposalToken) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_create_question", action: "create", examId: input.examId, targetIds: [],
          outcome: "failure", detail: { reason: "stale_proposal" },
        });
        throw new McpApplicationError("conflict");
      }

      // Idempotent replay via a standalone ledger (lib/questionProposals.ts),
      // independent of the questions table so it still recognizes a replay
      // after the created question is later deleted, instead of silently
      // recreating it. proposalToken is the immutable fingerprint of the
      // originally accepted request: reusing proposalId with a *different*
      // one must be rejected, never resolved either as a replay or a new create.
      const existingOperation = await getCreateOperation(db, input.proposalId);
      if (existingOperation) {
        if (existingOperation.proposalToken !== input.proposalToken) {
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_create_question", action: "create", examId: input.examId,
            targetIds: [existingOperation.questionId], outcome: "failure",
            detail: { reason: "proposal_id_reused_with_different_request" },
          });
          throw new McpApplicationError("conflict");
        }
        const existingQuestion = await getQuestionRow(db, existingOperation.examId, existingOperation.questionId);
        return existingQuestion
          ? { question: toQuestion(existingQuestion), idempotentReplay: true }
          : { question: null, idempotentReplay: true, deletedSinceCreation: true };
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      // Resolved before the batch so its link statements commit atomically
      // with the row (implementation review — question_tag_links is
      // authoritative content, not a best-effort side effect). No guard
      // needed: a fresh id has no revision race, and either the whole batch
      // (create, ledger, audit, links) commits together or a thrown error
      // rolls all of it back.
      const desiredTagIds = (await resolveOrCreateTags(db, payload.tags ?? [], now)).map((t) => t.id);
      try {
        // Batched atomically with the ledger record and its own success
        // audit row: either all three commit, or (on a thrown error) none
        // do, so a committed create can never end up missing its ledger
        // entry or audit record.
        await db.batch([
          createStatement(db, input.examId, id, payload, now),
          buildCreateOperationStatement(db, {
            proposalId: input.proposalId, proposalToken: input.proposalToken, examId: input.examId, questionId: id,
          }),
          buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_create_question", action: "create", examId: input.examId, targetIds: [id],
            // implementation — field names only, never question stem/options/
            // explanation/answer content: the audit log is a persisted
            // logging surface too, not just console/error output.
            outcome: "success", detail: { fields: Object.keys(payload) },
          }),
          ...buildTagLinkStatements(db, id, desiredTagIds, []),
        ]);
      } catch (error) {
        if (String(error).includes("admin_mcp_create_operations")) {
          // Lost a race with a concurrent commit of the same proposalId
          // between the lookup above and this insert; resolve it the same way.
          const raced = await getCreateOperation(db, input.proposalId);
          if (raced && raced.proposalToken === input.proposalToken) {
            const racedQuestion = await getQuestionRow(db, raced.examId, raced.questionId);
            return racedQuestion
              ? { question: toQuestion(racedQuestion), idempotentReplay: true }
              : { question: null, idempotentReplay: true, deletedSinceCreation: true };
          }
        }
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_create_question", action: "create", examId: input.examId, targetIds: [id],
          outcome: "failure", detail: { reason: String(error).includes("duplicate external ID") ? "duplicate_external_id" : "error" },
        });
        if (String(error).includes("duplicate external ID")) throw new McpApplicationError("conflict");
        throw error;
      }
      await invalidatePracticeQuestions(env, input.examId).catch(() => {});
      return { question: toQuestion((await getQuestionRow(db, input.examId, id))!) };
    },

    async updateQuestion(input: {
      examId: string; id: string; expectedRevision: number; payload: Record<string, unknown>; proposalToken: string;
    }) {
      await consumeAdminMutationLimit();
      const row = await requireQuestion(input.examId, input.id);
      const current = toQuestion(row);
      const { payload, issues } = validatePayload(input.payload, current);
      if (issues.length > 0) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_update_question", action: "update", examId: input.examId, targetIds: [input.id],
          outcome: "failure", detail: { reason: "invalid_input" },
        });
        throw new McpApplicationError("invalid_input");
      }
      const expected = await proposalToken({
        examId: input.examId, questionId: input.id, expectedRevision: input.expectedRevision, payload,
      });
      if (expected !== input.proposalToken || input.expectedRevision !== row.revision) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_update_question", action: "update", examId: input.examId, targetIds: [input.id],
          outcome: "failure", detail: { reason: "stale_proposal" },
        });
        throw new McpApplicationError("conflict");
      }
      const now = new Date().toISOString();
      const diff = diffPayload(current, payload);
      // Resolved before the batch, same reasoning as createQuestion above.
      // The link statements are guarded on the row landing at exactly
      // row.revision + 1 AND this exact `now` (updateStatement's own
      // unconditional `revision = revision + 1, updated_at = ?`) — revision
      // alone isn't enough (see buildTagLinkStatements' own comment: a
      // different concurrent writer could legitimately reach the same
      // revision value) — so a stale-revision write, zero rows changed, not
      // an exception, never still applies a tag-link change alongside it,
      // while a genuine commit applies both together in the same batch.
      const desiredTagIds = (await resolveOrCreateTags(db, payload.tags ?? [], now)).map((t) => t.id);
      const currentTagIds = await fetchTagIdsForQuestions(db, [row.id]).then((m) => m.get(row.id) ?? []);
      const linkStatements = buildTagLinkStatements(db, row.id, desiredTagIds, currentTagIds, { questionId: row.id, revision: row.revision + 1, updatedAt: now });
      let changed: number;
      try {
        const [updateResult] = await db.batch([
          updateStatement(db, row, payload, now),
          buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_update_question", action: "update", examId: input.examId, targetIds: [input.id],
            // implementation — changed field names only; diffPayload()'s
            // current/incoming values are full question content and must
            // not be persisted into a routine audit row.
            successDetail: { fields: diff.map((d) => d.field) }, failureDetail: { reason: "stale_revision" },
          }),
          ...linkStatements,
        ]);
        changed = updateResult!.meta.changes;
      } catch (error) {
        // The whole batch (the update, its paired conditional audit row,
        // and the tag-link diff) rolled back together — nothing committed,
        // so record the failure separately.
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_update_question", action: "update", examId: input.examId, targetIds: [input.id],
          outcome: "failure", detail: { reason: String(error).includes("duplicate external ID") ? "duplicate_external_id" : "error" },
        });
        if (String(error).includes("duplicate external ID")) throw new McpApplicationError("conflict");
        throw error;
      }
      if (!changed) throw new McpApplicationError("conflict");
      await invalidatePracticeQuestions(env, input.examId).catch(() => {});
      return { question: toQuestion((await getQuestionRow(db, input.examId, input.id))!) };
    },

    async deleteQuestion(input: { examId: string; id: string; expectedRevision: number }) {
      await consumeAdminMutationLimit();
      let changed: number;
      try {
        const [deleteResult] = await db.batch([
          db.prepare("DELETE FROM questions WHERE id = ? AND exam_id = ? AND revision = ?")
            .bind(input.id, input.examId, input.expectedRevision),
          buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_delete_question", action: "delete", examId: input.examId, targetIds: [input.id],
            successDetail: {}, failureDetail: { reason: "stale_revision_or_not_found" },
          }),
        ]);
        changed = deleteResult!.meta.changes;
      } catch (error) {
        // The whole batch (the delete and its paired conditional audit row)
        // rolled back together — nothing committed, so record the failure
        // separately.
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_delete_question", action: "delete", examId: input.examId, targetIds: [input.id],
          outcome: "failure", detail: { reason: "dependency_conflict" },
        });
        if (/FOREIGN KEY|question referenced by an attempt/i.test(String(error))) throw new McpApplicationError("conflict");
        throw error;
      }
      if (!changed) throw new McpApplicationError("conflict");
      await invalidatePracticeQuestions(env, input.examId).catch(() => {});
      return { deleted: true };
    },

    async archiveQuestion(input: { examId: string; id: string }) {
      return setQuestionArchived(input, true);
    },

    async unarchiveQuestion(input: { examId: string; id: string }) {
      return setQuestionArchived(input, false);
    },

    async batchCreateQuestions(input: {
      examId: string; items: { payload: Record<string, unknown>; proposalToken: string; proposalId: string }[];
    }) {
      await consumeAdminMutationLimit();
      await requireExam(input.examId);
      if (input.items.length > MAX_BATCH_MUTATION_ITEMS) throw new McpApplicationError("invalid_input");
      const now = new Date().toISOString();

      type Outcome = {
        inputIndex: number; questionId: string; externalId: string | null;
        status: "created" | "skipped" | "failed"; reason?: string; payload?: unknown;
      };
      const outcomes: Outcome[] = new Array(input.items.length);
      // Items resolved without touching the database (idempotent replay, a
      // reused proposalId with different content, invalid payload, stale
      // proposal) are audited unconditionally, in their own batch — an
      // unrelated rollback of the mutation batch below (e.g. a duplicate
      // externalId) must not also erase their audit trail.
      const resolvedAuditStatements: D1PreparedStatement[] = [];
      // Database-bound items become [create, ledger, audit] triples, all
      // committed together — see createQuestion for why the ledger record
      // must be atomic with the insert. `createStatementIndex` records each
      // triple's position for reading back its result after the batch runs.
      const mutationStatements: D1PreparedStatement[] = [];
      const pending: { createStatementIndex: number; inputIndex: number; id: string; externalId: string | null; payload: unknown }[] = [];

      // Bulk-resolve every item's raw (unvalidated) tag names up front —
      // implementation: avoid one resolve per item — then each item's own
      // (unconditional; a fresh id has no revision to race) link
      // statements are pushed into `mutationStatements` alongside its
      // create/ledger/audit triple below, so the whole thing commits or
      // rolls back as one atomic unit instead of a separate best-effort step.
      const rawTagNames = input.items.flatMap((item) => {
        const tags = (item.payload as { tags?: unknown }).tags;
        return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
      });
      const resolveTagIds = await buildTagNameResolver(db, rawTagNames, now);

      const existingOperations = await getCreateOperations(db, input.items.map((item) => item.proposalId));

      for (const [inputIndex, item] of input.items.entries()) {
        const existingOperation = existingOperations.get(item.proposalId);
        if (existingOperation) {
          if (existingOperation.proposalToken !== item.proposalToken) {
            outcomes[inputIndex] = {
              inputIndex, questionId: existingOperation.questionId, externalId: null,
              status: "skipped", reason: "proposal_id_reused_with_different_request",
            };
            resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
              tool: "admin_batch_create_questions", action: "batch_create", examId: input.examId,
              targetIds: [existingOperation.questionId], outcome: "failure",
              detail: { reason: "proposal_id_reused_with_different_request" },
            }));
            continue;
          }
          const existingQuestion = await getQuestionRow(db, existingOperation.examId, existingOperation.questionId);
          outcomes[inputIndex] = existingQuestion
            ? {
                inputIndex, questionId: existingOperation.questionId, externalId: existingQuestion.external_id,
                status: "created", reason: "idempotent_replay", payload: item.payload,
              }
            : {
                inputIndex, questionId: existingOperation.questionId, externalId: null,
                status: "skipped", reason: "idempotent_replay_deleted_since",
              };
          continue;
        }
        const { payload, issues } = validatePayload(item.payload);
        const id = crypto.randomUUID();
        if (issues.length > 0) {
          outcomes[inputIndex] = { inputIndex, questionId: id, externalId: null, status: "skipped", reason: "invalid" };
          resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_batch_create_questions", action: "batch_create", examId: input.examId,
            targetIds: [id], outcome: "failure", detail: { reason: "invalid" },
          }));
          continue;
        }
        const expected = await proposalToken({ examId: input.examId, payload });
        if (expected !== item.proposalToken) {
          outcomes[inputIndex] = { inputIndex, questionId: id, externalId: payload.externalId ?? null, status: "skipped", reason: "stale_proposal" };
          resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_batch_create_questions", action: "batch_create", examId: input.examId,
            targetIds: [id], outcome: "failure", detail: { reason: "stale_proposal" },
          }));
          continue;
        }
        const createStatementIndex = mutationStatements.length;
        mutationStatements.push(createStatement(db, input.examId, id, payload, now));
        mutationStatements.push(buildCreateOperationStatement(db, {
          proposalId: item.proposalId, proposalToken: item.proposalToken, examId: input.examId, questionId: id,
        }));
        mutationStatements.push(buildAdminMutationAuditStatement(db, principal, {
          tool: "admin_batch_create_questions", action: "batch_create", examId: input.examId, targetIds: [id],
          // implementation — field names only; see admin_create_question's audit row.
          outcome: "success", detail: { fields: Object.keys(payload) },
        }));
        mutationStatements.push(...buildTagLinkStatements(db, id, resolveTagIds(payload.tags), []));
        pending.push({ createStatementIndex, inputIndex, id, externalId: payload.externalId ?? null, payload });
      }

      if (resolvedAuditStatements.length > 0) await db.batch(resolvedAuditStatements);

      if (mutationStatements.length > 0) {
        try {
          await db.batch(mutationStatements);
          // createStatement never silently no-ops (see its own doc comment):
          // it either inserts exactly one row or throws, so a batch that
          // didn't throw means every pending item — including its tag
          // links, part of the same batch above — committed.
          for (const p of pending) {
            outcomes[p.inputIndex] = { inputIndex: p.inputIndex, questionId: p.id, externalId: p.externalId, status: "created", payload: p.payload };
          }
        } catch {
          // The whole batch (every pending item's create + ledger + audit
          // triple) rolled back together — report each as failed and record
          // one summary failure row for the call.
          for (const p of pending) {
            outcomes[p.inputIndex] = {
              inputIndex: p.inputIndex, questionId: p.id, externalId: p.externalId, status: "failed",
              reason: "Batch rolled back; refresh preview and retry.",
            };
          }
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_batch_create_questions", action: "batch_create", examId: input.examId,
            targetIds: pending.map((p) => p.id), outcome: "failure", detail: { reason: "batch_rolled_back" },
          });
        }
      }

      const created = outcomes.filter((o) => o.status === "created").length;
      const skipped = outcomes.filter((o) => o.status === "skipped").length;
      const failed = outcomes.filter((o) => o.status === "failed").length;
      if (created > 0) await invalidatePracticeQuestions(env, input.examId).catch(() => {});
      return { outcomes, created, skipped, failed };
    },

    async batchUpdateQuestions(input: {
      examId: string;
      items: { id: string; expectedRevision: number; proposalToken: string; payload: Record<string, unknown> }[];
    }) {
      await consumeAdminMutationLimit();
      await requireExam(input.examId);
      if (input.items.length > MAX_BATCH_MUTATION_ITEMS) throw new McpApplicationError("invalid_input");
      const now = new Date().toISOString();

      type Outcome = {
        inputIndex: number; questionId: string; externalId: string | null;
        status: "updated" | "skipped" | "failed"; reason?: string; diff?: PayloadDifference[];
      };
      const outcomes: Outcome[] = new Array(input.items.length);
      // Same split as batchCreateQuestions: items resolved without touching
      // the database are audited unconditionally, in their own batch, so an
      // unrelated rollback of the mutation batch below can't erase them.
      const resolvedAuditStatements: D1PreparedStatement[] = [];
      // Database-bound items become [update, conditionalAudit] pairs — see
      // updateQuestion for why the audit outcome/detail must be derived from
      // the update's own row count (via changes()) rather than assumed.
      const mutationStatements: D1PreparedStatement[] = [];
      const pending: {
        updateStatementIndex: number; inputIndex: number; id: string; externalId: string | null; diff: PayloadDifference[];
      }[] = [];

      // Bulk-resolve every item's tag names up front (implementation — avoid one
      // resolve per item) using the raw, unvalidated payloads; resolving a
      // name that later turns out to belong to an invalid/skipped item is
      // harmless (same as import's bulk resolve — see routes/imports.ts).
      const rawTagNames = input.items.flatMap((item) => {
        const tags = (item.payload as { tags?: unknown }).tags;
        return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
      });
      const resolveTagIds = await buildTagNameResolver(db, rawTagNames, now);
      const currentTagIdsByQuestion = await fetchTagIdsForQuestions(db, input.items.map((item) => item.id));

      for (const [inputIndex, item] of input.items.entries()) {
        const row = await getQuestionRow(db, input.examId, item.id);
        if (!row) {
          outcomes[inputIndex] = { inputIndex, questionId: item.id, externalId: null, status: "skipped", reason: "not_found" };
          resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_batch_update_questions", action: "batch_update", examId: input.examId,
            targetIds: [item.id], outcome: "failure", detail: { reason: "not_found" },
          }));
          continue;
        }
        const current = toQuestion(row);
        const { payload, issues } = validatePayload(item.payload, current);
        if (issues.length > 0) {
          outcomes[inputIndex] = { inputIndex, questionId: row.id, externalId: row.external_id, status: "skipped", reason: "invalid" };
          resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_batch_update_questions", action: "batch_update", examId: input.examId,
            targetIds: [row.id], outcome: "failure", detail: { reason: "invalid" },
          }));
          continue;
        }
        const expected = await proposalToken({
          examId: input.examId, questionId: item.id, expectedRevision: item.expectedRevision, payload,
        });
        if (expected !== item.proposalToken || item.expectedRevision !== row.revision) {
          outcomes[inputIndex] = { inputIndex, questionId: row.id, externalId: row.external_id, status: "skipped", reason: "stale_proposal" };
          resolvedAuditStatements.push(buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_batch_update_questions", action: "batch_update", examId: input.examId,
            targetIds: [row.id], outcome: "failure", detail: { reason: "stale_proposal" },
          }));
          continue;
        }
        const diff = diffPayload(current, payload);
        const updateStatementIndex = mutationStatements.length;
        mutationStatements.push(updateStatement(db, row, payload, now));
        mutationStatements.push(buildConditionalAdminMutationAuditStatement(db, principal, {
          tool: "admin_batch_update_questions", action: "batch_update", examId: input.examId, targetIds: [row.id],
          // implementation — field names only; see admin_update_question's audit row.
          successDetail: { fields: diff.map((d) => d.field) }, failureDetail: { reason: "stale_revision" },
        }));
        // Guarded on the row landing at exactly row.revision + 1 AND this
        // exact `now` — revision alone isn't enough (see
        // buildTagLinkStatements: a different concurrent writer could
        // legitimately reach the same revision value) — so this item's own
        // stale-revision no-op (0 rows changed, not an exception — the
        // whole batch below still "succeeds") never still applies a
        // tag-link change: it commits atomically with the update above, in
        // the SAME batch, not as a separate best-effort step.
        mutationStatements.push(...buildTagLinkStatements(
          db, row.id, resolveTagIds(payload.tags), currentTagIdsByQuestion.get(row.id) ?? [],
          { questionId: row.id, revision: row.revision + 1, updatedAt: now },
        ));
        pending.push({ updateStatementIndex, inputIndex, id: row.id, externalId: row.external_id, diff });
      }

      if (resolvedAuditStatements.length > 0) await db.batch(resolvedAuditStatements);

      if (mutationStatements.length > 0) {
        try {
          const results = await db.batch(mutationStatements);
          for (const p of pending) {
            const changed = results[p.updateStatementIndex]!.meta.changes > 0;
            outcomes[p.inputIndex] = {
              inputIndex: p.inputIndex, questionId: p.id, externalId: p.externalId,
              status: changed ? "updated" : "skipped",
              reason: changed ? undefined : "stale_question; refresh preview",
              diff: changed ? p.diff : undefined,
            };
          }
        } catch {
          for (const p of pending) {
            outcomes[p.inputIndex] = {
              inputIndex: p.inputIndex, questionId: p.id, externalId: p.externalId, status: "failed",
              reason: "Batch rolled back; refresh preview and retry.",
            };
          }
          await recordAdminMutationAudit(db, principal, {
            tool: "admin_batch_update_questions", action: "batch_update", examId: input.examId,
            targetIds: pending.map((p) => p.id), outcome: "failure", detail: { reason: "batch_rolled_back" },
          });
        }
      }

      const updated = outcomes.filter((o) => o.status === "updated").length;
      const skipped = outcomes.filter((o) => o.status === "skipped").length;
      const failed = outcomes.filter((o) => o.status === "failed").length;
      if (updated > 0) await invalidatePracticeQuestions(env, input.examId).catch(() => {});
      return { outcomes, updated, skipped, failed };
    },
  };
}
