import { z } from "zod";
import { getImportSchemas, KNOWLEDGE_POINT_MAX_BODY_LENGTH, KNOWLEDGE_POINT_MAX_TITLE_LENGTH, MAX_ATTEMPT_QUESTIONS, MAX_ANSWER_VALUES, MAX_ANSWER_TEXT_LENGTH, MAX_TIME_SPENT_SECONDS } from "@prepdeck/shared";
import type { Env } from "../../bindings";
import type { McpPrincipal } from "../credentials";
import type { McpObservation } from "../observability";
import { createUserMcpAdapter } from "../adapter";
import { createCatalogServer, defineMcpTool, type McpTool, type McpToolPolicy } from "../catalog";
import { paginationSchema } from "../conventions";
import { STUDY_PRESENTATION_INSTRUCTIONS } from "../questionPresentation";

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
const knowledgePointTitleSchema = z.string().max(KNOWLEDGE_POINT_MAX_TITLE_LENGTH);
const knowledgePointBodySchema = z.string().max(KNOWLEDGE_POINT_MAX_BODY_LENGTH);
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

// The whole catalog, before any OAuth scope filtering (see createServer below).
export function userMcpTools(principal: McpPrincipal, env: Env): McpTool[] {
  const services = createUserMcpAdapter(principal, env);
  return [
    defineMcpTool(
      "user_get_identity",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Inspect the authenticated User MCP identity.", z.strictObject({}),
      () => services.getIdentity()),
    defineMcpTool(
      "user_get_import_schemas",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Get supported question components, interactions and JSON import schemas to prepare a reviewed import locally with pdf-to-quiz. Saving questions to the shared bank requires an administrator.",
      z.strictObject({}), () => getImportSchemas()),

    // --- Learning overview and statistics -----------------------------------
    defineMcpTool(
      "user_get_learning_overview",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Cross-exam summary of your own study activity: per-exam attempt/accuracy totals, bookmark and active wrong-question counts, and a recent activity summary. `days` bounds only the activity summary, not the per-exam (all-time) figures. Activity days are calendar days in your account's time zone, returned as `activity.timeZone`.",
      z.strictObject({ days: z.number().int().min(7).max(365).default(84) }),
      (input) => services.getLearningOverview(input),
    ),
    defineMcpTool(
      "user_get_exam_progress",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Your progress in one exam: Learning Mode resume position, question count, bookmark/active-wrong-question counts, and overall accuracy.",
      z.strictObject({ examId: examIdSchema }),
      (input) => services.getExamProgress(input),
    ),
    defineMcpTool(
      "user_get_learning_stats",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Detailed per-exam statistics: accuracy trend, breakdown by tag/difficulty, and mock exam score history (paginated via limit/offset). Trend days are calendar days in your account's time zone, returned as `timeZone`.",
      z.strictObject({ examId: examIdSchema, ...paginationSchema.shape }),
      (input) => services.getLearningStats(input),
    ),

    // --- Explicit study writes -----------------------------------------------
    defineMcpTool(
      "user_start_practice",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      "Start a persisted practice session for the authenticated user when they want their study recorded. All questionIds must belong to examId and must not be archived. Starting also finalizes your other open practice sessions in this exam idle for over one hour, including web sessions; they will no longer accept answers. Save the returned attemptId, submit answers with user_submit_practice_answer, then end with user_complete_practice. This call creates a new session each time; after an uncertain result inspect user_list_attempts and compare examId, startedAt and the ordered questionIds. If several attempts match, report ambiguity; do not guess or start another session. Does not move Learning Mode's resume position.",
      z.strictObject({ examId: examIdSchema, questionIds: z.array(questionIdSchema).min(1).max(MAX_ATTEMPT_QUESTIONS) }),
      (input) => services.startPractice(input),
    ),
    defineMcpTool(
      "user_submit_practice_answer",
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Record and lock the learner's actual answer in their own open practice session. The server validates and grades against PrepDeck's answer key, saves the grading revision, and updates wrong-question state and statistics. Use original option IDs/answer values; never send a caller-computed score or correctness. Repeating a question in an open attempt returns its original grade without revising it. After completion inspect user_get_attempt instead. Omit timeSpentSeconds if unknown. Empty or blank fill-in answers are rejected; skip unanswered questions without submitting them.",
      z.strictObject({
        attemptId: attemptIdSchema, questionId: questionIdSchema,
        selectedAnswer: z.array(z.string().max(MAX_ANSWER_TEXT_LENGTH)).max(MAX_ANSWER_VALUES),
        timeSpentSeconds: z.number().int().min(0).max(MAX_TIME_SPENT_SECONDS).optional(),
      }),
      (input) => services.submitPracticeAnswer(input),
    ),
    defineMcpTool(
      "user_complete_practice",
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "End your persisted practice session, finalize timing and answered counts, and invalidate its statistics cache. May end early; unanswered questions are not recorded as wrong. Safe to repeat without regrading. Only practice sessions are supported, not mock exams. Does not move Learning Mode's resume position.",
      z.strictObject({ attemptId: attemptIdSchema }),
      (input) => services.completePractice(input),
    ),
    defineMcpTool(
      "user_set_learning_progress",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      "Set your Learning Mode resume position for an exam to the requested positive sequenceNumber (not a question ID or an answered count). Replaces the previous position, including moving backward. Only updates the resume position; does not create attempts, grade answers, or change accuracy/wrong-question statistics. Use the practice tools to persist quiz results.",
      z.strictObject({ examId: examIdSchema, sequenceNumber: z.number().int().min(1) }),
      (input) => services.setLearningProgress(input),
    ),

    // --- Attempts and review sets --------------------------------------------
    defineMcpTool(
      "user_list_attempts",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List your own practice/mock attempts, optionally filtered by exam, mode, or completed-only. Includes ordered questionIds to help identify a session after an uncertain start; multiple matching sessions remain ambiguous.",
      z.strictObject({
        examId: examIdSchema.optional(), mode: attemptModeSchema.optional(),
        completedOnly: z.boolean().optional(), ...paginationSchema.shape,
      }),
      (input) => services.listAttempts(input),
    ),
    defineMcpTool(
      "user_get_attempt",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Fetch one of your own attempts by id, including its ordered questionIds and per-question breakdown (paginated via breakdownLimit/breakdownOffset). `passed` is recomputed live against the exam's current pass mark, not a stored historical snapshot.",
      z.strictObject({
        id: attemptIdSchema,
        breakdownLimit: z.number().int().min(1).max(200).default(50),
        breakdownOffset: z.number().int().min(0).max(100_000).default(0),
      }),
      (input) => services.getAttempt(input),
    ),
    defineMcpTool(
      "user_get_recent_attempts",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Your most recent attempts (a fixed recency window, not a browsable page — use user_list_attempts for that).",
      z.strictObject({ examId: examIdSchema.optional(), limit: z.number().int().min(1).max(50).default(10) }),
      (input) => services.getRecentAttempts(input),
    ),
    defineMcpTool(
      "user_get_wrong_questions",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Your Wrong Question Book: questions you've answered incorrectly and haven't marked mastered (set includeMastered to also see mastered ones).",
      z.strictObject({
        examId: examIdSchema.optional(), includeMastered: z.boolean().default(false), ...paginationSchema.shape,
      }),
      (input) => services.getWrongQuestions(input),
    ),
    defineMcpTool(
      "user_get_bookmarked_questions",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Your bookmarked questions.",
      z.strictObject({ examId: examIdSchema.optional(), ...paginationSchema.shape }),
      (input) => services.getBookmarkedQuestions(input),
    ),
    defineMcpTool(
      "user_get_unattempted_questions",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Questions in one exam you have never answered, in exam order.",
      z.strictObject({ examId: examIdSchema, ...paginationSchema.shape }),
      (input) => services.getUnattemptedQuestions(input),
    ),

    // --- Question/exam discovery ---------------------------------------------
    defineMcpTool(
      "user_search_questions",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Search questions within one exam by text, id, type, difficulty, or tag. Returns the full question record, including the correct answer(s) and explanation. Archived questions are never returned.",
      z.strictObject({
        examId: examIdSchema, q: z.string().min(1).max(200).optional(),
        type: questionTypeSchema.optional(), difficulty: difficultySchema.optional(),
        tag: z.string().min(1).max(200).optional(), ...paginationSchema.shape,
      }),
      (input) => services.searchQuestions(input),
    ),
    defineMcpTool(
      "user_get_question",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Fetch one question by exam and question id, including the correct answer(s) and explanation. For a quiz use user_present_question first; fetch this record after the learner responds and check its revision before grading. A question an admin has archived still resolves here (archivedAt is set) so past attempts can be reviewed, but it cannot be practiced again.",
      z.strictObject({ examId: examIdSchema, id: questionIdSchema }),
      (input) => services.getQuestion(input),
    ),
    defineMcpTool(
      "user_present_question",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Present one complete question without grading keys, explanations or annotations. Returns ordered Markdown text and original MCP images from full components/shared material (or preserved legacy Markdown), plus metadata/warnings. Keep tables, code, figure captions and option labels intact; never replace images with lists. Use imageMode=text-only if the client cannot show images and disclose missing visual material. An incomplete presentation must be reviewed before answering. Read-only; does not inspect the original PDF or change the bank.",
      z.strictObject({ examId: examIdSchema, id: questionIdSchema, imageMode: z.enum(["inline", "text-only"]).default("inline") }),
      (input) => services.presentQuestion(input),
      (result) => result,
    ),
    defineMcpTool(
      "user_list_exams",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List exams available to study (archived exams are excluded).",
      z.strictObject({ ...paginationSchema.shape }),
      (input) => services.listExams(input),
    ),
    defineMcpTool(
      "user_get_exam",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Fetch one exam by id, including its providers and question count.",
      z.strictObject({ id: examIdSchema }),
      (input) => services.getExam(input),
    ),
    defineMcpTool(
      "user_list_question_tags",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List question-bank tags and how many questions carry each, optionally scoped to one exam.",
      z.strictObject({ examId: examIdSchema.optional(), ...paginationSchema.shape }),
      (input) => services.listQuestionTags(input),
    ),

    // --- Study selection ------------------------------------------------------
    defineMcpTool(
      "user_get_recommended_questions",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "A blended pick of what to study next — drawn from your wrong-question book, then bookmarks, then unattempted questions, in that order, with no duplicates. Never includes the correct answer. These are selection projections; call user_present_question for complete material before quizzing.",
      z.strictObject({ examId: examIdSchema.optional(), limit: candidateLimitSchema }),
      (input) => services.getRecommendedQuestions(input),
    ),
    defineMcpTool(
      "user_get_questions_for_review",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "A random sample of questions due for review — from your wrong-question book, your bookmarks, or both (`source`, default \"both\"). Never includes the correct answer. These are selection projections; call user_present_question for complete material before quizzing.",
      z.strictObject({
        examId: examIdSchema.optional(), source: reviewSourceSchema.default("both"),
        type: questionTypeSchema.optional(), difficulty: difficultySchema.optional(),
        tag: z.string().min(1).max(200).optional(), limit: candidateLimitSchema,
      }),
      (input) => services.getQuestionsForReview(input),
    ),
    defineMcpTool(
      "user_get_practice_candidates",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "A random, filterable pool of questions to practice. unattemptedOnly/wrongOnly/bookmarkedOnly may be combined; when more than one is set, a question must satisfy all of them. Never includes the correct answer. These are selection projections; call user_present_question for complete material before quizzing.",
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
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List your own annotations (highlights/notes), optionally filtered by exam or mark type and sorted by creation time.",
      z.strictObject({
        examId: examIdSchema.optional(), markType: z.string().min(1).max(200).optional(),
        sort: sortSchema.optional(), ...paginationSchema.shape,
      }),
      (input) => services.listAnnotations(input),
    ),
    defineMcpTool(
      "user_get_annotations_for_question",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List your own annotations on one specific question.",
      z.strictObject({ questionId: questionIdSchema, ...paginationSchema.shape }),
      (input) => services.getAnnotationsForQuestion(input),
    ),

    // --- Knowledge Points (implementation) ------------------------------------------
    defineMcpTool(
      "user_list_knowledge_points",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List your own Knowledge Points (personal Markdown notes), optionally filtered by group, ungrouped, tags (AND semantics), linked question, exam, or sort mode. When scoped to exactly one group (or ungrouped) with no other filter, the response includes `orderRevision` — pass it to user_reorder_knowledge_points to reorder within that scope.",
      z.strictObject({ ...knowledgePointListFilters, q: z.string().min(1).max(200).optional(), ...paginationSchema.shape }),
      (input) => services.listKnowledgePoints(input),
    ),
    defineMcpTool(
      "user_search_knowledge_points",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Search your own Knowledge Points by title/body text, with the same optional filters as user_list_knowledge_points.",
      z.strictObject({ ...knowledgePointListFilters, q: z.string().min(1).max(200), ...paginationSchema.shape }),
      (input) => services.searchKnowledgePoints(input),
    ),
    defineMcpTool(
      "user_get_knowledge_point",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Fetch one of your own Knowledge Points by id, including its Markdown body, group, tags, linked questions, and stable image references.",
      z.strictObject({ id: knowledgePointIdSchema }),
      (input) => services.getKnowledgePoint(input),
    ),
    defineMcpTool(
      "user_get_knowledge_points_for_question",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List your own Knowledge Points linked to one specific question.",
      z.strictObject({ questionId: questionIdSchema, ...paginationSchema.shape }),
      (input) => services.getKnowledgePointsForQuestion(input),
    ),
    defineMcpTool(
      "user_list_knowledge_point_groups",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List your own Knowledge Point groups (flat, no nesting) and how many notes each contains.",
      z.strictObject({ ...paginationSchema.shape }),
      (input) => services.listKnowledgePointGroups(input),
    ),
    defineMcpTool(
      "user_list_knowledge_point_tags",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List your own Knowledge Point tags and how many notes carry each.",
      z.strictObject({ ...paginationSchema.shape }),
      (input) => services.listKnowledgePointTags(input),
    ),
    defineMcpTool(
      "user_create_knowledge_point",
      { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
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
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      "Permanently delete one of your own Knowledge Points, including its image attachments. Never deletes its group, tags, or any linked question.",
      z.strictObject({ id: knowledgePointIdSchema }),
      (input) => services.deleteKnowledgePoint(input),
    ),
    defineMcpTool(
      "user_link_knowledge_point_question",
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Link one of your own Knowledge Points to a question. Idempotent — linking an already-linked question succeeds without creating a duplicate. Never creates an attempt or changes study statistics.",
      z.strictObject({ id: knowledgePointIdSchema, questionId: questionIdSchema }),
      (input) => services.linkKnowledgePointQuestion(input),
    ),
    defineMcpTool(
      "user_unlink_knowledge_point_question",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      "Remove a question link from one of your own Knowledge Points. Never affects an attempt or study statistics.",
      z.strictObject({ id: knowledgePointIdSchema, questionId: questionIdSchema }),
      (input) => services.unlinkKnowledgePointQuestion(input),
    ),
    defineMcpTool(
      "user_create_knowledge_point_group",
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Create a new Knowledge Point group. Group names are case-insensitively unique per user.",
      z.strictObject({ name: knowledgePointNameSchema }),
      (input) => services.createKnowledgePointGroup(input),
    ),
    defineMcpTool(
      "user_rename_knowledge_point_group",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      "Rename one of your own Knowledge Point groups.",
      z.strictObject({ id: knowledgePointGroupIdSchema, name: knowledgePointNameSchema }),
      (input) => services.renameKnowledgePointGroup(input),
    ),
    defineMcpTool(
      "user_delete_knowledge_point_group",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      "Delete one of your own Knowledge Point groups. Its notes are never deleted — they fall back to Ungrouped, keeping their relative order.",
      z.strictObject({ id: knowledgePointGroupIdSchema }),
      (input) => services.deleteKnowledgePointGroup(input),
    ),
    defineMcpTool(
      "user_create_knowledge_point_tag",
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Attach a tag (by name) to one of your own Knowledge Points, creating the tag first if it doesn't already exist for you (case-insensitive match). Idempotent.",
      z.strictObject({ id: knowledgePointIdSchema, name: knowledgePointNameSchema }),
      (input) => services.createKnowledgePointTag(input),
    ),
    defineMcpTool(
      "user_rename_knowledge_point_tag",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      "Rename one of your own Knowledge Point tags. Affects every note carrying it.",
      z.strictObject({ id: knowledgePointTagIdSchema, name: knowledgePointNameSchema }),
      (input) => services.renameKnowledgePointTag(input),
    ),
    defineMcpTool(
      "user_delete_knowledge_point_tag",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      "Permanently delete one of your own Knowledge Point tags. Removes it from every note that carries it, but never deletes those notes — use user_unlink_knowledge_point_tag to remove the tag from just one note instead.",
      z.strictObject({ id: knowledgePointTagIdSchema }),
      (input) => services.deleteKnowledgePointTag(input),
    ),
    defineMcpTool(
      "user_unlink_knowledge_point_tag",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      "Remove one tag from one of your own Knowledge Points, without deleting the tag itself or its links to any other note.",
      z.strictObject({ id: knowledgePointIdSchema, tagId: knowledgePointTagIdSchema }),
      (input) => services.unlinkKnowledgePointTag(input),
    ),
    defineMcpTool(
      "user_reorder_knowledge_points",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      "Move one of your own Knowledge Points to a new position within its current group (or Ungrouped), immediately before `beforeId` (or to the end, if null). Requires `expectedOrderRevision` (from user_list_knowledge_points, scoped to that same group/ungrouped view) — a stale value is rejected as a conflict rather than silently applied, so refetch the current order and retry if that happens. `beforeId` must belong to the same group.",
      z.strictObject({ id: knowledgePointIdSchema, beforeId: knowledgePointIdSchema.nullable(), expectedOrderRevision: z.number().int().min(1) }),
      (input) => services.reorderKnowledgePoints(input),
    ),
  ];
}

// Serves an already-built catalog (the route inspects the same tools before
// dispatch). `policy` narrows it to what an OAuth grant's scopes allow; a PAT
// passes none and keeps the full catalog its account role allows.
export function createUserMcpServer(tools: readonly McpTool[], observation?: McpObservation, policy?: McpToolPolicy) {
  return createCatalogServer("prepdeck-user-mcp", tools, observation, STUDY_PRESENTATION_INSTRUCTIONS, policy);
}
