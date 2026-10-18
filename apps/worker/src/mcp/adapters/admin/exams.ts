import { McpApplicationError } from "../../errors";
import { buildAdminMutationAuditStatement, buildConditionalAdminMutationAuditStatement, recordAdminMutationAudit } from "../../audit";
import {
  examExists, getExam as getExamRecord, createExamStatement, updateExamStatement, archiveExamStatement,
  EXAM_SLUG_PATTERN, type ExamCreateFields, type ExamMutableFields,
} from "../../../lib/examManagement";
import { officialFormatError } from "@prepdeck/shared";
import type { AdminAdapterContext } from "./context";

// Admin MCP exam lifecycle: create, update and archive.
export function examOperations(ctx: AdminAdapterContext) {
  const { db, principal, consumeAdminMutationLimit } = ctx;

  return {
    // --- Exam lifecycle (implementation) -------------------------------------------
    // No proposalToken/expectedRevision — exams have no `revision` column and
    // REST doesn't have one either; not inventing new concurrency control
    // beyond what already exists.
    async createExam(input: ExamCreateFields) {
      await consumeAdminMutationLimit();
      if (!EXAM_SLUG_PATTERN.test(input.slug)) throw new McpApplicationError("invalid_input");
      if (input.officialFormat !== undefined && officialFormatError(input.officialFormat)) throw new McpApplicationError("invalid_input");
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      try {
        await db.batch([
          createExamStatement(db, id, input, now),
          buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_create_exam", action: "exam_create", examId: id, targetIds: [id],
            outcome: "success", detail: { slug: input.slug, name: input.name },
          }),
        ]);
      } catch {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_create_exam", action: "exam_create", examId: null, targetIds: [],
          outcome: "failure", detail: { reason: "slug_taken" },
        });
        throw new McpApplicationError("conflict");
      }
      return { exam: (await getExamRecord(db, id, { includeArchivedProviders: true }))! };
    },

    async updateExam(input: { id: string } & ExamMutableFields) {
      await consumeAdminMutationLimit();
      const { id, ...fields } = input;
      if (fields.slug !== undefined && !EXAM_SLUG_PATTERN.test(fields.slug)) throw new McpApplicationError("invalid_input");
      if (fields.officialFormat !== undefined && officialFormatError(fields.officialFormat)) throw new McpApplicationError("invalid_input");
      const statement = updateExamStatement(db, id, fields);
      if (!statement) throw new McpApplicationError("invalid_input");
      let changed: number;
      try {
        const [result] = await db.batch([
          statement,
          buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_update_exam", action: "exam_update", examId: id, targetIds: [id],
            successDetail: { fields }, failureDetail: { reason: "not_found" },
          }),
        ]);
        changed = result!.meta.changes;
      } catch {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_update_exam", action: "exam_update", examId: id, targetIds: [id],
          outcome: "failure", detail: { reason: "slug_taken" },
        });
        throw new McpApplicationError("conflict");
      }
      if (!changed) throw new McpApplicationError("not_found");
      return { exam: (await getExamRecord(db, id, { includeArchivedProviders: true }))! };
    },

    async archiveExam(input: { id: string }) {
      await consumeAdminMutationLimit();
      const now = new Date().toISOString();
      let changed: number;
      try {
        const [result] = await db.batch([
          archiveExamStatement(db, input.id, now),
          buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_archive_exam", action: "exam_archive", examId: input.id, targetIds: [input.id],
            successDetail: { archivedAt: now }, failureDetail: { reason: "already_archived_or_not_found" },
          }),
        ]);
        changed = result!.meta.changes;
      } catch (error) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_archive_exam", action: "exam_archive", examId: input.id, targetIds: [input.id],
          outcome: "failure", detail: { reason: "error" },
        });
        throw error;
      }
      if (!changed) {
        const exists = await examExists(db, input.id);
        throw new McpApplicationError(exists ? "conflict" : "not_found");
      }
      return { archivedAt: now };
    },
  };
}
