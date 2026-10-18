import { McpApplicationError } from "../../errors";
import { buildAdminMutationAuditStatement, buildConditionalAdminMutationAuditStatement, recordAdminMutationAudit } from "../../audit";
import { invalidatePracticeQuestions } from "../../../lib/practiceCache";
import {
  normalizeTagName, findTagCatalogRowByName, renameTagCatalogStatement, touchTagCatalogStatement,
  reassignTagLinksStatement, deleteTagCatalogByIdStatement, registerTagCatalogStatement, countQuestionsForTag,
  countQuestionsForAnyTag, distinctExamIdsForTags, sourceDriftCondition, MAX_MERGE_SOURCE_TAGS,
} from "../../../lib/questionBankTags";
import type { AdminAdapterContext } from "./context";

// Admin MCP question-bank tag catalog: create, rename and merge.
export function taxonomyOperations(ctx: AdminAdapterContext) {
  const { db, env, principal, consumeAdminMutationLimit } = ctx;

  return {
    // --- Taxonomy (implementation) --------------------------------------------------
    // Tool inputs are plain tag-name strings throughout — no client-visible
    // catalog ids (implementation's original contract, unchanged) — but rename/merge
    // are now PURE catalog + question_tag_links operations: a tag's id (and
    // therefore every link pointing at it) never changes on a rename, and a
    // merge only ever reassigns/removes links and deletes source catalog
    // rows. Neither ever touches a `questions` row, so unlike implementation's original
    // per-row tags_json rewrite there is no affected-question-count this can
    // fail against, no chunking, and no per-row conflict/retry bookkeeping —
    // `conflicts` stays in the response shape (always empty) only so
    // existing callers don't have to branch on its absence.
    async createTag(input: { name: string }) {
      await consumeAdminMutationLimit();
      const name = normalizeTagName(input.name);
      if (!name) throw new McpApplicationError("invalid_input");
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      try {
        await db.batch([
          registerTagCatalogStatement(db, id, name, now),
          buildAdminMutationAuditStatement(db, principal, {
            tool: "admin_create_tag", action: "tag_create", examId: null, targetIds: [id], outcome: "success", detail: { name },
          }),
        ]);
      } catch {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_create_tag", action: "tag_create", examId: null, targetIds: [], outcome: "failure", detail: { reason: "already_exists", name },
        });
        throw new McpApplicationError("conflict");
      }
      return { id, name };
    },

    // `affectedQuestionCount` is now purely informational (how many
    // questions currently carry the tag) — renaming never rewrites or
    // revision-bumps any of them. The rename itself is guarded by a
    // read-then-write revision compare-and-swap on the catalog row, so a
    // concurrent rename/merge of the SAME tag between this call's read and
    // write is reported as a conflict rather than silently lost.
    async updateTag(input: { name: string; newName: string }) {
      await consumeAdminMutationLimit();
      const name = normalizeTagName(input.name);
      const newName = normalizeTagName(input.newName);
      if (!name || !newName) throw new McpApplicationError("invalid_input");
      const existingSource = await findTagCatalogRowByName(db, name);
      if (!existingSource) throw new McpApplicationError("not_found");
      if (name.toLowerCase() !== newName.toLowerCase()) {
        const collision = await findTagCatalogRowByName(db, newName);
        if (collision && collision.id !== existingSource.id) throw new McpApplicationError("conflict");
      }
      const now = new Date().toISOString();
      const affectedQuestionCount = await countQuestionsForTag(db, existingSource.id);
      let changed: number;
      try {
        const [result] = await db.batch([
          renameTagCatalogStatement(db, existingSource.id, existingSource.revision, newName, now),
          buildConditionalAdminMutationAuditStatement(db, principal, {
            tool: "admin_update_tag", action: "tag_update", examId: null, targetIds: [existingSource.id],
            successDetail: { name, newName, affectedQuestionCount }, failureDetail: { reason: "stale_revision" },
          }),
        ]);
        changed = result!.meta.changes;
      } catch (error) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_update_tag", action: "tag_update", examId: null, targetIds: [existingSource.id],
          outcome: "failure", detail: { reason: "error" },
        });
        throw error;
      }
      if (!changed) throw new McpApplicationError("conflict");
      // No question row changed, so there's nothing for updateStatement's
      // own cache invalidation to have caught — but the renamed display
      // name is embedded in every affected exam's cached practice catalog
      // (routes/practice.ts), so that cache still needs invalidating.
      const examIds = await distinctExamIdsForTags(db, [existingSource.id]);
      await Promise.all(examIds.map((examId) => invalidatePracticeQuestions(env, examId).catch(() => {})));
      return { name: newName, affectedQuestionCount, conflicts: [] };
    },

    // `affectedQuestionCount` counts DISTINCT questions across every source
    // tag (a question carrying two merged-away tags counts once). The whole
    // operation — touching/registering the target, reassigning every
    // source's links, and deleting every source catalog row — is one atomic
    // batch: reassign/delete are each guarded on the target row still being
    // at its just-touched revision, so a lost concurrent race on the target
    // (touchTagCatalogStatement's own compare-and-swap) leaves every
    // guarded statement a no-op instead of partially merging.
    async mergeTags(input: { names: string[]; targetName: string }) {
      await consumeAdminMutationLimit();
      const targetName = normalizeTagName(input.targetName);
      if (!targetName || input.names.length === 0) throw new McpApplicationError("invalid_input");
      const sourceNames = [...new Set(input.names.map((n) => normalizeTagName(n)).filter((n): n is string => !!n))]
        .filter((n) => n.toLowerCase() !== targetName.toLowerCase());
      if (sourceNames.length === 0 || sourceNames.length > MAX_MERGE_SOURCE_TAGS) throw new McpApplicationError("invalid_input");

      const now = new Date().toISOString();
      const existingTarget = await findTagCatalogRowByName(db, targetName);
      const sourceRows = (await Promise.all(sourceNames.map((n) => findTagCatalogRowByName(db, n))))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      const affectedQuestionCount = await countQuestionsForAnyTag(db, sourceRows.map((r) => r.id));
      // Computed BEFORE the batch below reassigns/deletes source links —
      // afterward, the source ids no longer resolve to any link at all.
      const examIdsToInvalidate = await distinctExamIdsForTags(
        db, [...(existingTarget ? [existingTarget.id] : []), ...sourceRows.map((r) => r.id)],
      );

      const targetId = existingTarget?.id ?? crypto.randomUUID();
      // Folds "no source has drifted since it was read above" into the
      // SAME compare-and-swap that already guards the target — see
      // sourceDriftCondition's own comment for why a per-source guard
      // (rather than each reassign/delete statement independently) is what
      // makes the whole merge abort atomically instead of partially
      // completing around a concurrently-edited source.
      const driftGuard = sourceDriftCondition(sourceRows.map((r) => ({ id: r.id, revision: r.revision })));
      const touchOrRegister = existingTarget
        ? touchTagCatalogStatement(db, existingTarget.id, existingTarget.revision, now, driftGuard)
        : registerTagCatalogStatement(db, targetId, targetName, now, driftGuard);
      const targetRevisionAfter = (existingTarget?.revision ?? 0) + 1;
      const guard = { tagId: targetId, revision: targetRevisionAfter, updatedAt: now };
      const statements = [
        touchOrRegister,
        buildConditionalAdminMutationAuditStatement(db, principal, {
          tool: "admin_merge_tags", action: "tag_merge", examId: null, targetIds: [targetId, ...sourceRows.map((r) => r.id)],
          successDetail: { names: sourceNames, targetName, affectedQuestionCount }, failureDetail: { reason: "stale_revision" },
        }),
        // Baselines track tag identity too. Remap the saved import snapshot
        // with the live links so a catalog merge cannot invent a local edit.
        //
        // This is the one part of a merge that reads question rows at all, and
        // it has no index-usable predicate — so `import_baseline_tag_ids_json
        // IS NOT NULL` leads the WHERE deliberately: it is a cheap column test
        // that lets every never-imported question fall out before the much more
        // expensive json_each() is evaluated over its baseline. Without it this
        // statement expands a JSON array per row of `questions`, inside the
        // merge's own atomic batch. (implementation removed the implementation-era 500-question
        // rewrite cap on merges; that is about rewriting rows, which this still
        // does not do for anything outside the merged tags.)
        db.prepare(
          `UPDATE questions SET import_baseline_tag_ids_json = (
             SELECT json_group_array(tag_id) FROM (
               SELECT DISTINCT CASE WHEN value IN (SELECT value FROM json_each(?)) THEN ? ELSE value END AS tag_id
               FROM json_each(questions.import_baseline_tag_ids_json) ORDER BY tag_id
             )
           ) WHERE import_baseline_tag_ids_json IS NOT NULL AND EXISTS (
             SELECT 1 FROM json_each(questions.import_baseline_tag_ids_json)
             WHERE value IN (SELECT value FROM json_each(?))
           ) AND EXISTS (SELECT 1 FROM question_bank_tags WHERE id = ? AND revision = ? AND updated_at = ?)`
        ).bind(JSON.stringify(sourceRows.map((r) => r.id)), targetId,
          JSON.stringify(sourceRows.map((r) => r.id)), targetId, targetRevisionAfter, now),
        // Guarded unconditionally (not just when the target pre-existed):
        // for a brand-new target this checks it landed at revision 1 (the
        // INSERT's own hardcoded value), which is equally false if the
        // conditional INSERT above didn't fire due to source drift.
        ...sourceRows.flatMap((source) => [
          reassignTagLinksStatement(db, source.id, targetId, guard),
          deleteTagCatalogByIdStatement(db, source.id, guard),
        ]),
      ];
      let changed: number;
      try {
        const [result] = await db.batch(statements);
        changed = result!.meta.changes;
      } catch (error) {
        await recordAdminMutationAudit(db, principal, {
          tool: "admin_merge_tags", action: "tag_merge", examId: null, targetIds: [targetId],
          outcome: "failure", detail: { reason: "error" },
        });
        throw error;
      }
      if (!changed) throw new McpApplicationError("conflict");
      await Promise.all(examIdsToInvalidate.map((examId) => invalidatePracticeQuestions(env, examId).catch(() => {})));
      return { name: targetName, mergedNames: sourceNames, affectedQuestionCount, conflicts: [] };
    },
  };
}
