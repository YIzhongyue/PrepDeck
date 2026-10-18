import { McpApplicationError } from "../../errors";
import { buildKnowledgePointsListQuery } from "../../../lib/knowledgePointsQuery";
import {
  loadDetail as loadKnowledgePointDetail, toSummary as toKnowledgePointSummary, LIST_SELECT as KP_LIST_SELECT,
  type KnowledgePointRow,
} from "../../../lib/knowledgePointDetail";
import {
  createNote, applyNoteEdit, deleteNote, linkQuestion, unlinkQuestion, attachTag, detachTag, reorderNote,
} from "../../../lib/knowledgePointMutations";
import {
  listGroups as listKnowledgePointGroupRows, createGroup as createKnowledgePointGroupRow,
  renameGroup as renameKnowledgePointGroupRow, deleteGroup as deleteKnowledgePointGroupRow,
} from "../../../lib/knowledgePointGroupMutations";
import {
  listTags as listKnowledgePointTagRows, renameTag as renameKnowledgePointTagRow,
  deleteTag as deleteKnowledgePointTagRow,
} from "../../../lib/knowledgePointTagMutations";
import { SELECT_ORDER_REVISION_SQL } from "../../../lib/knowledgePointOrderScopes";
import { scopeKeyFor } from "../../../lib/knowledgePointOrdering";
import { page } from "../shared";
import type { UserAdapterContext } from "./context";

// implementation — Knowledge Points bounds. REST has no equivalent caps today
// (these are MCP-only abuse-prevention limits, not retrofitted onto REST) —
// enforced by passing them into the shared lib/knowledgePointMutations.ts
// functions, which REST's own callers simply never do. MAX_TAG_FILTER_IDS
// bounds the `tagIds` *query filter* array on list/search, a different
// concern from MAX_TAGS_PER_NOTE (how many tags one note may carry).
const MAX_TAGS_PER_NOTE = 50;
const MAX_LINKED_QUESTIONS_PER_NOTE = 200;
const MAX_TAG_FILTER_IDS = 20;

export function knowledgePointOperations(ctx: UserAdapterContext) {
  const { db, env, userId, consumeKnowledgePointWriteLimit } = ctx;

  interface KnowledgePointsListInput {
    groupId?: string;
    ungrouped?: boolean;
    tagIds?: string[];
    q?: string;
    sort?: string;
    linkedQuestionId?: string;
    examId?: string;
    limit: number;
    offset: number;
  }

  // Shared by list/search/get_knowledge_points_for_question — there is
  // exactly one underlying query (buildKnowledgePointsListQuery); the three
  // tools differ only in which fields their own schema requires/prefills.
  async function listNotes(input: KnowledgePointsListInput) {
    if (input.tagIds && input.tagIds.length > MAX_TAG_FILTER_IDS) throw new McpApplicationError("invalid_input");
    const query = buildKnowledgePointsListQuery(userId, input);
    if (!query) throw new McpApplicationError("invalid_input");
    const rowsStatement = db
      .prepare(`${KP_LIST_SELECT} WHERE ${query.where} ORDER BY ${query.orderBy} LIMIT ? OFFSET ?`)
      .bind(...query.binds, input.limit + 1, input.offset);

    // orderRevision is only meaningful for a single, unfiltered scope view
    // (an explicit groupId or ungrouped, with no other narrowing filter) —
    // it must reflect the *whole* scope a caller would reorder within, not
    // a filtered subset of it. See user_reorder_knowledge_points, which
    // requires this value back as expectedOrderRevision.
    const extra: Record<string, unknown> = {};
    const isSingleUnfilteredScope = (input.ungrouped || !!input.groupId) && !input.tagIds?.length && !input.q && !input.linkedQuestionId && !input.examId;
    if (isSingleUnfilteredScope) {
      const scopeKey = input.ungrouped ? scopeKeyFor(null) : scopeKeyFor(input.groupId!);
      // Read the rows and the scope's order revision as one atomic batch —
      // two separate round trips here would leave a window where a
      // concurrent reorder lands in between, producing a response whose
      // orderRevision doesn't actually describe the rows just returned. A
      // caller could then submit a reorder using that orderRevision (which
      // legitimately matches the CURRENT state) against a beforeId chosen
      // from the STALE list they were shown, defeating the purpose of the
      // CAS check for this particular read.
      const [rowsResult, revisionResult] = await db.batch<KnowledgePointRow | { revision: number }>([
        rowsStatement,
        db.prepare(SELECT_ORDER_REVISION_SQL).bind(userId, scopeKey),
      ]);
      extra.orderRevision = (revisionResult!.results?.[0] as { revision: number } | undefined)?.revision ?? 1;
      return page(((rowsResult!.results as KnowledgePointRow[] | undefined) ?? []).map(toKnowledgePointSummary), input, extra);
    }

    const { results } = await rowsStatement.all<KnowledgePointRow>();
    return page((results ?? []).map(toKnowledgePointSummary), input, extra);
  }

  return {
    // --- Knowledge Points (implementation) -----------------------------------------
    // Reuses implementation's canonical rules via lib/knowledgePointMutations.ts,
    // lib/knowledgePointDetail.ts, lib/knowledgePointGroupMutations.ts, and
    // lib/knowledgePointTagMutations.ts — the exact same functions REST's
    // routes/knowledgePoints*.ts call — rather than a parallel
    // implementation. Cross-user access to a knowledge point, group, tag, or
    // attachment reads identically to nonexistent (not_found), matching
    // every other read method in this adapter.
    async listKnowledgePoints(input: KnowledgePointsListInput) {
      return listNotes(input);
    },

    async searchKnowledgePoints(input: KnowledgePointsListInput & { q: string }) {
      return listNotes(input);
    },

    async getKnowledgePointsForQuestion(input: { questionId: string; limit: number; offset: number }) {
      return listNotes({ linkedQuestionId: input.questionId, limit: input.limit, offset: input.offset });
    },

    async getKnowledgePoint(input: { id: string }) {
      const detail = await loadKnowledgePointDetail(db, input.id, userId);
      if (!detail) throw new McpApplicationError("not_found");
      return { knowledgePoint: detail };
    },

    async listKnowledgePointGroups(input: { limit: number; offset: number }) {
      const { groups, total, ungroupedCount } = await listKnowledgePointGroupRows(db, userId, { limit: input.limit + 1, offset: input.offset });
      return page(groups, input, { total, ungroupedCount });
    },

    async listKnowledgePointTags(input: { limit: number; offset: number }) {
      const { tags, total } = await listKnowledgePointTagRows(db, userId, { limit: input.limit + 1, offset: input.offset });
      return page(tags, input, { total });
    },

    // Per implementation, create may seed initial content and relationships
    // atomically (default: today's blank-note behavior) rather than forcing
    // N follow-up mutation calls that could leave a caller with a
    // half-tagged note if it gives up partway through.
    async createKnowledgePoint(input: { groupId?: string | null; title?: string; bodyMarkdown?: string; tagNames?: string[]; linkedQuestionIds?: string[] }) {
      await consumeKnowledgePointWriteLimit();
      const result = await createNote(db, {
        userId, groupId: input.groupId, title: input.title, bodyMarkdown: input.bodyMarkdown,
        tagNames: input.tagNames, linkedQuestionIds: input.linkedQuestionIds,
        maxTags: MAX_TAGS_PER_NOTE, maxLinkedQuestions: MAX_LINKED_QUESTIONS_PER_NOTE,
      });
      if (!result.ok) {
        if (result.reason === "group_not_found" || result.reason === "question_not_found") throw new McpApplicationError("not_found");
        throw new McpApplicationError("invalid_input");
      }
      return { knowledgePoint: await loadKnowledgePointDetail(db, result.id, userId) };
    },

    // Content (title/bodyMarkdown) and an optional group move are applied
    // atomically under one revision check — see lib/knowledgePointMutations.ts's
    // applyNoteEdit for why this can't just be two separate calls the way
    // REST's own PUT/PATCH endpoints are.
    async updateKnowledgePoint(input: { id: string; baseRevision: number; title?: string; bodyMarkdown?: string; groupId?: string | null }) {
      await consumeKnowledgePointWriteLimit();
      const result = await applyNoteEdit(db, { id: input.id, userId, baseRevision: input.baseRevision, title: input.title, bodyMarkdown: input.bodyMarkdown, groupId: input.groupId });
      if (!result.ok) {
        if (result.reason === "not_found" || result.reason === "group_not_found") throw new McpApplicationError("not_found");
        throw new McpApplicationError("conflict");
      }
      return { knowledgePoint: result.detail };
    },

    // No revision check on delete — REST's own DELETE /:id has none either;
    // deletion is already explicit via requiring the exact id. Never
    // cascades to the note's group, tags, or linked questions themselves.
    async deleteKnowledgePoint(input: { id: string }) {
      await consumeKnowledgePointWriteLimit();
      const deleted = await deleteNote(db, env.BUCKET, { id: input.id, userId });
      if (!deleted) throw new McpApplicationError("not_found");
      return { deleted: true };
    },

    async linkKnowledgePointQuestion(input: { id: string; questionId: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await linkQuestion(db, { id: input.id, userId, questionId: input.questionId, maxLinkedQuestions: MAX_LINKED_QUESTIONS_PER_NOTE });
      if (!result.ok) {
        if (result.reason === "cap_exceeded") throw new McpApplicationError("invalid_input");
        throw new McpApplicationError("not_found");
      }
      return { knowledgePoint: await loadKnowledgePointDetail(db, input.id, userId) };
    },

    async unlinkKnowledgePointQuestion(input: { id: string; questionId: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await unlinkQuestion(db, { id: input.id, userId, questionId: input.questionId });
      if (!result.ok) throw new McpApplicationError("not_found");
      return { knowledgePoint: await loadKnowledgePointDetail(db, input.id, userId) };
    },

    async createKnowledgePointGroup(input: { name: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await createKnowledgePointGroupRow(db, { userId, name: input.name });
      if (!result.ok) {
        if (result.reason === "duplicate") throw new McpApplicationError("conflict");
        throw new McpApplicationError("invalid_input");
      }
      return { group: result.group };
    },

    async renameKnowledgePointGroup(input: { id: string; name: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await renameKnowledgePointGroupRow(db, { id: input.id, userId, name: input.name });
      if (!result.ok) {
        if (result.reason === "not_found") throw new McpApplicationError("not_found");
        if (result.reason === "duplicate") throw new McpApplicationError("conflict");
        throw new McpApplicationError("invalid_input");
      }
      return { group: result.group };
    },

    async deleteKnowledgePointGroup(input: { id: string }) {
      await consumeKnowledgePointWriteLimit();
      const deleted = await deleteKnowledgePointGroupRow(db, { id: input.id, userId });
      if (!deleted) throw new McpApplicationError("not_found");
      return { deleted: true };
    },

    // Attach-by-name to one note (find-or-create) — matches REST's only
    // "create a tag" entry point (there is no bare tag-catalog-create).
    async createKnowledgePointTag(input: { id: string; name: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await attachTag(db, { id: input.id, userId, name: input.name, maxTags: MAX_TAGS_PER_NOTE });
      if (!result.ok) {
        if (result.reason === "kp_not_found") throw new McpApplicationError("not_found");
        throw new McpApplicationError("invalid_input");
      }
      return { knowledgePoint: await loadKnowledgePointDetail(db, input.id, userId) };
    },

    // Global rename of the tag catalog entry — affects every note carrying it.
    async renameKnowledgePointTag(input: { id: string; name: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await renameKnowledgePointTagRow(db, { id: input.id, userId, name: input.name });
      if (!result.ok) {
        if (result.reason === "not_found") throw new McpApplicationError("not_found");
        if (result.reason === "duplicate") throw new McpApplicationError("conflict");
        throw new McpApplicationError("invalid_input");
      }
      return { tag: result.tag };
    },

    // Global delete of the tag catalog entry — removes it from every note
    // that carries it, but never deletes those notes.
    async deleteKnowledgePointTag(input: { id: string }) {
      await consumeKnowledgePointWriteLimit();
      const deleted = await deleteKnowledgePointTagRow(db, { id: input.id, userId });
      if (!deleted) throw new McpApplicationError("not_found");
      return { deleted: true };
    },

    // Detaches one tag from one note without deleting the tag itself or its
    // links to any other note — the operation REST's tag-catalog naming
    // otherwise leaves no room for (its only "delete a tag" endpoint is the
    // global one above), symmetric with link/unlink_knowledge_point_question.
    async unlinkKnowledgePointTag(input: { id: string; tagId: string }) {
      await consumeKnowledgePointWriteLimit();
      const result = await detachTag(db, { id: input.id, userId, tagId: input.tagId });
      if (!result.ok) throw new McpApplicationError("not_found");
      return { knowledgePoint: await loadKnowledgePointDetail(db, input.id, userId) };
    },

    // Requires expectedOrderRevision (from listKnowledgePoints'/
    // getKnowledgePointsForQuestion's `orderRevision`, when scoped to a
    // single group/ungrouped view) so a stale/concurrent reorder is
    // rejected rather than silently applied — see
    // lib/knowledgePointMutations.ts's reorderNote.
    async reorderKnowledgePoints(input: { id: string; beforeId: string | null; expectedOrderRevision: number }) {
      await consumeKnowledgePointWriteLimit();
      const result = await reorderNote(db, { id: input.id, userId, beforeId: input.beforeId, expectedOrderRevision: input.expectedOrderRevision });
      if (!result.ok) {
        if (result.reason === "not_found" || result.reason === "before_not_found") throw new McpApplicationError("not_found");
        if (result.reason === "cross_group") throw new McpApplicationError("invalid_input");
        if (result.reason === "conflict") throw new McpApplicationError("conflict");
        throw new McpApplicationError("internal");
      }
      return { position: result.position };
    },
  };
}
