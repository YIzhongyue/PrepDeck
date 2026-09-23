import { z } from "zod";
import { getImportSchemas } from "@prepdeck/shared";
import type { Env } from "../../bindings";
import type { McpPrincipal } from "../credentials";
import type { McpObservation } from "../observability";
import { createUserMcpAdapter } from "../adapter";
import { createCatalogServer, defineMcpTool } from "../catalog";
import { paginationSchema } from "../conventions";

const examIdSchema = z.string().min(1).max(200);
const questionIdSchema = z.string().min(1).max(200);
const attemptIdSchema = z.string().min(1).max(200);
const questionTypeSchema = z.enum(["single_choice", "multiple_choice", "true_false", "fill_blank"]);
const difficultySchema = z.enum(["easy", "medium", "hard"]);
const attemptModeSchema = z.enum(["practice", "mock"]);
const reviewSourceSchema = z.enum(["wrong", "bookmarked", "both"]);
const sortSchema = z.enum(["asc", "desc"]);

// A hard cap on random-sample study-selection tools (get_practice_candidates
// etc.) — these aren't a browsable page (no offset), just a bounded draw.
const candidateLimitSchema = z.number().int().min(1).max(100).default(10);

// --- Knowledge Points (implementation) --------------------------------------------
const knowledgePointIdSchema = z.string().min(1).max(200);
const knowledgePointGroupIdSchema = z.string().min(1).max(200);
const knowledgePointTagIdSchema = z.string().min(1).max(200);
const knowledgePointTitleSchema = z.string().max(200);
const knowledgePointBodySchema = z.string().max(200_000);
const knowledgePointNameSchema = z.string().min(1).max(40);
// Distinct from the annotations `sortSchema` above (asc/desc) — a different
// axis entirely (which field to sort by, not which direction).
const knowledgePointSortSchema = z.enum(["updated", "title", "created", "custom"]);
const knowledgePointListFilters = {
  groupId: knowledgePointGroupIdSchema.optional(),
  ungrouped: z.boolean().optional(),
  // Bounds the *query filter* — a different, smaller concern from how many
  // tags one note may carry (see MAX_TAGS_PER_NOTE in mcp/adapter.ts).
  tagIds: z.array(knowledgePointTagIdSchema).max(20).optional(),
  sort: knowledgePointSortSchema.optional(),
  linkedQuestionId: questionIdSchema.optional(),
  examId: examIdSchema.optional(),
};

export function createUserMcpServer(principal: McpPrincipal, env: Env, observation?: McpObservation) {
  const services = createUserMcpAdapter(principal, env);
  return createCatalogServer("prepdeck-user-mcp", [
    defineMcpTool("user_get_identity", "Inspect the authenticated User MCP identity.", z.strictObject({}),
      () => services.getIdentity()),
    defineMcpTool("user_get_import_schemas",
      "Get supported question components, interactions and JSON import schemas to prepare a reviewed import locally with pdf-to-quiz. Saving questions to the shared bank requires an administrator.",
      z.strictObject({}), () => getImportSchemas()),

    // --- Learning overview and statistics -----------------------------------
    defineMcpTool(
      "user_get_learning_overview",
      "Cross-exam summary of your own study activity: per-exam attempt/accuracy totals, bookmark and active wrong-question counts, and a recent activity summary. `days` bounds only the activity summary, not the per-exam (all-time) figures.",
      z.strictObject({ days: z.number().int().min(7).max(365).default(84) }),
      (input) => services.getLearningOverview(input),
    ),
    defineMcpTool(
      "user_get_exam_progress",
      "Your progress in one exam: Learning Mode resume position, question count, bookmark/active-wrong-question counts, and overall accuracy.",
      z.strictObject({ examId: examIdSchema }),
      (input) => services.getExamProgress(input),
    ),
    defineMcpTool(
      "user_get_learning_stats",
      "Detailed per-exam statistics: accuracy trend, breakdown by tag/difficulty, and mock exam score history (paginated via limit/offset).",
      z.strictObject({ examId: examIdSchema, ...paginationSchema.shape }),
      (input) => services.getLearningStats(input),
    ),

    // --- Attempts and review sets --------------------------------------------
    defineMcpTool(
      "user_list_attempts",
      "List your own practice/mock attempts, optionally filtered by exam, mode, or completed-only.",
      z.strictObject({
        examId: examIdSchema.optional(), mode: attemptModeSchema.optional(),
        completedOnly: z.boolean().optional(), ...paginationSchema.shape,
      }),
      (input) => services.listAttempts(input),
    ),
    defineMcpTool(
      "user_get_attempt",
      "Fetch one of your own attempts by id, including its per-question breakdown (paginated via breakdownLimit/breakdownOffset). `passed` is recomputed live against the exam's current pass mark, not a stored historical snapshot.",
      z.strictObject({
        id: attemptIdSchema,
        breakdownLimit: z.number().int().min(1).max(200).default(50),
        breakdownOffset: z.number().int().min(0).max(100_000).default(0),
      }),
      (input) => services.getAttempt(input),
    ),
    defineMcpTool(
      "user_get_recent_attempts",
      "Your most recent attempts (a fixed recency window, not a browsable page — use user_list_attempts for that).",
      z.strictObject({ examId: examIdSchema.optional(), limit: z.number().int().min(1).max(50).default(10) }),
      (input) => services.getRecentAttempts(input),
    ),
    defineMcpTool(
      "user_get_wrong_questions",
      "Your Wrong Question Book: questions you've answered incorrectly and haven't marked mastered (set includeMastered to also see mastered ones).",
      z.strictObject({
        examId: examIdSchema.optional(), includeMastered: z.boolean().default(false), ...paginationSchema.shape,
      }),
      (input) => services.getWrongQuestions(input),
    ),
    defineMcpTool(
      "user_get_bookmarked_questions",
      "Your bookmarked questions.",
      z.strictObject({ examId: examIdSchema.optional(), ...paginationSchema.shape }),
      (input) => services.getBookmarkedQuestions(input),
    ),
    defineMcpTool(
      "user_get_unattempted_questions",
      "Questions in one exam you have never answered, in exam order.",
      z.strictObject({ examId: examIdSchema, ...paginationSchema.shape }),
      (input) => services.getUnattemptedQuestions(input),
    ),

    // --- Question/exam discovery ---------------------------------------------
    defineMcpTool(
      "user_search_questions",
      "Search questions within one exam by text, id, type, difficulty, or tag. Returns the full question record, including the correct answer(s) and explanation.",
      z.strictObject({
        examId: examIdSchema, q: z.string().min(1).max(200).optional(),
        type: questionTypeSchema.optional(), difficulty: difficultySchema.optional(),
        tag: z.string().min(1).max(200).optional(), ...paginationSchema.shape,
      }),
      (input) => services.searchQuestions(input),
    ),
    defineMcpTool(
      "user_get_question",
      "Fetch one question by exam and question id, including the correct answer(s) and explanation.",
      z.strictObject({ examId: examIdSchema, id: questionIdSchema }),
      (input) => services.getQuestion(input),
    ),
    defineMcpTool(
      "user_list_exams",
      "List exams available to study (archived exams are excluded).",
      z.strictObject({ ...paginationSchema.shape }),
      (input) => services.listExams(input),
    ),
    defineMcpTool(
      "user_get_exam",
      "Fetch one exam by id, including its providers and question count.",
      z.strictObject({ id: examIdSchema }),
      (input) => services.getExam(input),
    ),
    defineMcpTool(
      "user_list_question_tags",
      "List question-bank tags and how many questions carry each, optionally scoped to one exam.",
      z.strictObject({ examId: examIdSchema.optional(), ...paginationSchema.shape }),
      (input) => services.listQuestionTags(input),
    ),

    // --- Study selection ------------------------------------------------------
    defineMcpTool(
      "user_get_recommended_questions",
      "A blended pick of what to study next — drawn from your wrong-question book, then bookmarks, then unattempted questions, in that order, with no duplicates. Never includes the correct answer.",
      z.strictObject({ examId: examIdSchema.optional(), limit: candidateLimitSchema }),
      (input) => services.getRecommendedQuestions(input),
    ),
    defineMcpTool(
      "user_get_questions_for_review",
      "A random sample of questions due for review — from your wrong-question book, your bookmarks, or both (`source`, default \"both\"). Never includes the correct answer.",
      z.strictObject({
        examId: examIdSchema.optional(), source: reviewSourceSchema.default("both"),
        type: questionTypeSchema.optional(), difficulty: difficultySchema.optional(),
        tag: z.string().min(1).max(200).optional(), limit: candidateLimitSchema,
      }),
      (input) => services.getQuestionsForReview(input),
    ),
    defineMcpTool(
      "user_get_practice_candidates",
      "A random, filterable pool of questions to practice. unattemptedOnly/wrongOnly/bookmarkedOnly may be combined; when more than one is set, a question must satisfy all of them. Never includes the correct answer.",
      z.strictObject({
        examId: examIdSchema.optional(), type: questionTypeSchema.optional(), difficulty: difficultySchema.optional(),
        tag: z.string().min(1).max(200).optional(), unattemptedOnly: z.boolean().optional(),
        wrongOnly: z.boolean().optional(), bookmarkedOnly: z.boolean().optional(), limit: candidateLimitSchema,
      }),
      (input) => services.getPracticeCandidates(input),
    ),

    // --- Annotations ------------------------------------------------------------
    defineMcpTool(
      "user_list_annotations",
      "List your own annotations (highlights/notes), optionally filtered by exam or mark type and sorted by creation time.",
      z.strictObject({
        examId: examIdSchema.optional(), markType: z.string().min(1).max(200).optional(),
        sort: sortSchema.optional(), ...paginationSchema.shape,
      }),
      (input) => services.listAnnotations(input),
    ),
    defineMcpTool(
      "user_get_annotations_for_question",
      "List your own annotations on one specific question.",
      z.strictObject({ questionId: questionIdSchema, ...paginationSchema.shape }),
      (input) => services.getAnnotationsForQuestion(input),
    ),

    // --- Knowledge Points (implementation) ------------------------------------------
    defineMcpTool(
      "user_list_knowledge_points",
      "List your own Knowledge Points (personal Markdown notes), optionally filtered by group, ungrouped, tags (AND semantics), linked question, exam, or sort mode. When scoped to exactly one group (or ungrouped) with no other filter, the response includes `orderRevision` — pass it to user_reorder_knowledge_points to reorder within that scope.",
      z.strictObject({ ...knowledgePointListFilters, q: z.string().min(1).max(200).optional(), ...paginationSchema.shape }),
      (input) => services.listKnowledgePoints(input),
    ),
    defineMcpTool(
      "user_search_knowledge_points",
      "Search your own Knowledge Points by title/body text, with the same optional filters as user_list_knowledge_points.",
      z.strictObject({ ...knowledgePointListFilters, q: z.string().min(1).max(200), ...paginationSchema.shape }),
      (input) => services.searchKnowledgePoints(input),
    ),
    defineMcpTool(
      "user_get_knowledge_point",
      "Fetch one of your own Knowledge Points by id, including its Markdown body, group, tags, linked questions, and stable image references.",
      z.strictObject({ id: knowledgePointIdSchema }),
      (input) => services.getKnowledgePoint(input),
    ),
    defineMcpTool(
      "user_get_knowledge_points_for_question",
      "List your own Knowledge Points linked to one specific question.",
      z.strictObject({ questionId: questionIdSchema, ...paginationSchema.shape }),
      (input) => services.getKnowledgePointsForQuestion(input),
    ),
    defineMcpTool(
      "user_list_knowledge_point_groups",
      "List your own Knowledge Point groups (flat, no nesting) and how many notes each contains.",
      z.strictObject({ ...paginationSchema.shape }),
      (input) => services.listKnowledgePointGroups(input),
    ),
    defineMcpTool(
      "user_list_knowledge_point_tags",
      "List your own Knowledge Point tags and how many notes carry each.",
      z.strictObject({ ...paginationSchema.shape }),
      (input) => services.listKnowledgePointTags(input),
    ),
    defineMcpTool(
      "user_create_knowledge_point",
      "Create a new Knowledge Point. All fields are optional — omit everything for a blank note (matching the web editor's default), or seed initial title/bodyMarkdown, an existing group, tag names (created if they don't already exist), and/or linked question ids, all applied atomically.",
      z.strictObject({
        groupId: knowledgePointGroupIdSchema.nullable().optional(),
        title: knowledgePointTitleSchema.optional(),
        bodyMarkdown: knowledgePointBodySchema.optional(),
        tagNames: z.array(knowledgePointNameSchema).max(50).optional(),
        linkedQuestionIds: z.array(questionIdSchema).max(200).optional(),
      }),
      (input) => services.createKnowledgePoint(input),
    ),
    defineMcpTool(
      "user_update_knowledge_point",
      "Edit one of your own Knowledge Points. `baseRevision` must match the note's current revision (from a prior get/list/create) or the edit is rejected as a conflict, without overwriting newer content — refetch and retry. `title`/`bodyMarkdown` are independently optional (omit either to leave it unchanged). `groupId` is tri-state: omit to leave the group unchanged, pass null to move to Ungrouped, or an id to move to that group — applied atomically with the content change.",
      z.strictObject({
        id: knowledgePointIdSchema,
        baseRevision: z.number().int().min(0),
        title: knowledgePointTitleSchema.optional(),
        bodyMarkdown: knowledgePointBodySchema.optional(),
        groupId: knowledgePointGroupIdSchema.nullable().optional(),
      }),
      (input) => services.updateKnowledgePoint(input),
    ),
    defineMcpTool(
      "user_delete_knowledge_point",
      "Permanently delete one of your own Knowledge Points, including its image attachments. Never deletes its group, tags, or any linked question.",
      z.strictObject({ id: knowledgePointIdSchema }),
      (input) => services.deleteKnowledgePoint(input),
    ),
    defineMcpTool(
      "user_link_knowledge_point_question",
      "Link one of your own Knowledge Points to a question. Idempotent — linking an already-linked question succeeds without creating a duplicate. Never creates an attempt or changes study statistics.",
      z.strictObject({ id: knowledgePointIdSchema, questionId: questionIdSchema }),
      (input) => services.linkKnowledgePointQuestion(input),
    ),
    defineMcpTool(
      "user_unlink_knowledge_point_question",
      "Remove a question link from one of your own Knowledge Points. Never affects an attempt or study statistics.",
      z.strictObject({ id: knowledgePointIdSchema, questionId: questionIdSchema }),
      (input) => services.unlinkKnowledgePointQuestion(input),
    ),
    defineMcpTool(
      "user_create_knowledge_point_group",
      "Create a new Knowledge Point group. Group names are case-insensitively unique per user.",
      z.strictObject({ name: knowledgePointNameSchema }),
      (input) => services.createKnowledgePointGroup(input),
    ),
    defineMcpTool(
      "user_rename_knowledge_point_group",
      "Rename one of your own Knowledge Point groups.",
      z.strictObject({ id: knowledgePointGroupIdSchema, name: knowledgePointNameSchema }),
      (input) => services.renameKnowledgePointGroup(input),
    ),
    defineMcpTool(
      "user_delete_knowledge_point_group",
      "Delete one of your own Knowledge Point groups. Its notes are never deleted — they fall back to Ungrouped, keeping their relative order.",
      z.strictObject({ id: knowledgePointGroupIdSchema }),
      (input) => services.deleteKnowledgePointGroup(input),
    ),
    defineMcpTool(
      "user_create_knowledge_point_tag",
      "Attach a tag (by name) to one of your own Knowledge Points, creating the tag first if it doesn't already exist for you (case-insensitive match). Idempotent.",
      z.strictObject({ id: knowledgePointIdSchema, name: knowledgePointNameSchema }),
      (input) => services.createKnowledgePointTag(input),
    ),
    defineMcpTool(
      "user_rename_knowledge_point_tag",
      "Rename one of your own Knowledge Point tags. Affects every note carrying it.",
      z.strictObject({ id: knowledgePointTagIdSchema, name: knowledgePointNameSchema }),
      (input) => services.renameKnowledgePointTag(input),
    ),
    defineMcpTool(
      "user_delete_knowledge_point_tag",
      "Permanently delete one of your own Knowledge Point tags. Removes it from every note that carries it, but never deletes those notes — use user_unlink_knowledge_point_tag to remove the tag from just one note instead.",
      z.strictObject({ id: knowledgePointTagIdSchema }),
      (input) => services.deleteKnowledgePointTag(input),
    ),
    defineMcpTool(
      "user_unlink_knowledge_point_tag",
      "Remove one tag from one of your own Knowledge Points, without deleting the tag itself or its links to any other note.",
      z.strictObject({ id: knowledgePointIdSchema, tagId: knowledgePointTagIdSchema }),
      (input) => services.unlinkKnowledgePointTag(input),
    ),
    defineMcpTool(
      "user_reorder_knowledge_points",
      "Move one of your own Knowledge Points to a new position within its current group (or Ungrouped), immediately before `beforeId` (or to the end, if null). Requires `expectedOrderRevision` (from user_list_knowledge_points, scoped to that same group/ungrouped view) — a stale value is rejected as a conflict rather than silently applied, so refetch the current order and retry if that happens. `beforeId` must belong to the same group.",
      z.strictObject({ id: knowledgePointIdSchema, beforeId: knowledgePointIdSchema.nullable(), expectedOrderRevision: z.number().int().min(1) }),
      (input) => services.reorderKnowledgePoints(input),
    ),
  ], observation);
}
