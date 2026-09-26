import { z } from "zod";
import { getImportSchemas } from "@prepdeck/shared";
import type { Env } from "../../bindings";
import type { McpPrincipal } from "../credentials";
import type { McpObservation } from "../observability";
import { createAdminMcpAdapter } from "../adapter";
import { createCatalogServer, defineMcpTool } from "../catalog";
import { paginationSchema } from "../conventions";
import { MAX_BATCH_MUTATION_ITEMS } from "../../lib/questionManagement";
import { MAX_MERGE_SOURCE_TAGS } from "../../lib/questionBankTags";

const examIdSchema = z.string().min(1).max(200);
const questionIdSchema = z.string().min(1).max(200);
const questionTypeSchema = z.enum(["single_choice", "multiple_choice", "true_false", "fill_blank", "ordering", "matching"]);
const difficultySchema = z.enum(["easy", "medium", "hard"]);
const revisionSchema = z.number().int().min(1);
const proposalTokenSchema = z.string().length(64);
const proposalIdSchema = z.string().uuid();

// implementation — exam lifecycle, import workflow, and taxonomy schemas.
// Cross-field limits (pass count <= question count) are checked by the shared
// officialFormatError in the service, like REST.
const officialFormatSchema = z.strictObject({
  questionCount: z.number().int().min(1).describe("Number of questions in the real exam"),
  timeLimitMinutes: z.number().int().min(1).describe("Time limit of the real exam, in minutes"),
  passCorrectCount: z.number().int().min(1).describe("Correct answers needed to pass the real exam"),
}).nullable().optional().describe("The official exam format mock exams are scaled from; null clears it");
const examSlugSchema = z.string().min(1).max(200);
const examCreateFieldsSchema = z.strictObject({
  slug: examSlugSchema, name: z.string().min(1).max(200),
  subject: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  language: z.string().max(50).nullable().optional(),
  passMarkPct: z.number().min(0).max(100).nullable().optional(),
  officialFormat: officialFormatSchema,
});
const examMutableFieldsSchema = z.strictObject({
  slug: examSlugSchema.optional(), name: z.string().min(1).max(200).optional(),
  subject: z.string().max(200).optional(), description: z.string().max(2000).optional(),
  language: z.string().max(50).optional(), passMarkPct: z.number().min(0).max(100).nullable().optional(),
  officialFormat: officialFormatSchema,
});

// Loose at the MCP boundary, same rationale as questionPayloadSchema above:
// real validation is validateImportFile/validateQuestionRow (@prepdeck/shared),
// shared with REST imports, not reimplemented here.
const importFileSchema = z.looseObject({
  schemaVersion: z.unknown(),
  exam: z.record(z.string(), z.unknown()),
  source: z.record(z.string(), z.unknown()).optional(),
  questions: z.array(z.unknown()),
});
const conflictResolutionSchema = z.strictObject({
  questionId: questionIdSchema,
  expectedRevision: revisionSchema,
  incomingToken: z.string().length(64),
  action: z.enum(["keep", "apply"]),
});
const importIdSchema = z.string().uuid();
const importTokenSchema = z.string().length(64);

const tagNameSchema = z.string().min(1).max(200);

// Loose at the MCP boundary: deep semantic checks (option/answer-reference
// cross-validation, length limits, etc.) live in validateQuestionRow, shared
// with Admin REST and imports (per implementation's "reuse canonical validation rules").
const questionPayloadSchema = z.strictObject({
  externalId: z.string().min(1).max(200).nullable().optional(),
  type: questionTypeSchema.optional(),
  stem: z.string().min(1).optional(),
  options: z.array(z.unknown()).optional(),
  correctAnswers: z.array(z.unknown()).optional(),
  explanation: z.string().nullable().optional(),
  difficulty: difficultySchema.nullable().optional(),
  tags: z.array(z.string()).optional(),
  needsReview: z.boolean().optional(),
  points: z.number().optional(),
  content: z.record(z.string(), z.unknown()).optional(),
});

export function createAdminMcpServer(principal: McpPrincipal, env: Env, observation?: McpObservation) {
  const services = createAdminMcpAdapter(principal, env);
  return createCatalogServer("prepdeck-admin-mcp", [
    defineMcpTool(
      "admin_get_identity",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Inspect the authenticated Admin MCP identity.", z.strictObject({}),
      () => services.getIdentity()),
    defineMcpTool(
      "admin_get_import_schemas",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Get supported question components, interactions, limits, and JSON import schemas. PDFs are converted locally with pdf-to-quiz; review the evidence, then use admin_preview_import and admin_execute_import for the resulting JSON.",
      z.strictObject({}), () => getImportSchemas()),

    defineMcpTool(
      "admin_export_questions",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Export a page of questions as a portable component package, including answer keys. Every question must have a unique external ID for safe re-import; assign missing IDs before exporting. Follow nextOffset for remaining questions. If snapshot identities conflict, export separately; if the 5 MiB package limit is exceeded, reduce limit.",
      z.strictObject({ examId: examIdSchema, ...paginationSchema.shape }), input => services.exportQuestions(input)),

    // --- Question-bank reads (implementation) -------------------------------------
    defineMcpTool(
      "admin_search_questions",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Search questions within one exam by text, id, type, difficulty, tag, or pending-review state.",
      z.strictObject({
        examId: examIdSchema,
        q: z.string().min(1).max(200).optional(),
        type: questionTypeSchema.optional(),
        difficulty: difficultySchema.optional(),
        tag: z.string().min(1).max(200).optional(),
        // Omitted = both; true = only questions still awaiting manual review,
        // false = only questions already signed off (issue #15).
        needsReview: z.boolean().optional(),
        ...paginationSchema.shape,
      }),
      (input) => services.searchQuestions(input),
    ),
    defineMcpTool(
      "admin_get_question",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Fetch the full stored representation of one question by exam and question id.",
      z.strictObject({ examId: examIdSchema, id: questionIdSchema }),
      (input) => services.getQuestion(input),
    ),
    defineMcpTool(
      "admin_list_exams",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List exams, optionally including archived ones.",
      z.strictObject({ includeArchived: z.boolean().default(false), ...paginationSchema.shape }),
      (input) => services.listExams(input),
    ),
    defineMcpTool(
      "admin_get_exam",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Fetch one exam by id, including its providers and question count.",
      z.strictObject({ id: examIdSchema }),
      (input) => services.getExam(input),
    ),
    defineMcpTool(
      "admin_get_exam_statistics",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Summarize one exam's question bank: counts by type/difficulty, content-quality counts, and attempt counts.",
      z.strictObject({ examId: examIdSchema }),
      (input) => services.getExamStatistics(input),
    ),

    // --- Quality-control and maintenance reads -------------------------------
    defineMcpTool(
      "admin_find_duplicate_questions",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Find groups of questions in one exam whose stem text is effectively identical.",
      z.strictObject({ examId: examIdSchema, ...paginationSchema.shape }),
      (input) => services.findDuplicateQuestions(input),
    ),
    defineMcpTool(
      "admin_find_questions_missing_explanations",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Find questions in one exam with no (or blank) official explanation.",
      z.strictObject({ examId: examIdSchema, ...paginationSchema.shape }),
      (input) => services.findQuestionsMissingExplanations(input),
    ),
    defineMcpTool(
      "admin_find_questions_with_invalid_answer_references",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Find questions in one exam whose correctAnswers reference an option id that does not exist, true_false questions missing a true/false option pair, single_choice questions with fewer than two options, or matching questions with fewer than two right-hand items.",
      z.strictObject({ examId: examIdSchema, ...paginationSchema.shape }),
      (input) => services.findQuestionsWithInvalidAnswerReferences(input),
    ),
    defineMcpTool(
      "admin_find_questions_missing_metadata",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Find questions in one exam with no difficulty set, no tags, or points outside the accepted range (greater than 0, at most 100).",
      z.strictObject({ examId: examIdSchema, ...paginationSchema.shape }),
      (input) => services.findQuestionsMissingMetadata(input),
    ),
    defineMcpTool(
      "admin_get_question_bank_statistics",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Summarize content-quality counts across the entire question bank (all exams), bounded to a large but finite scan.",
      z.strictObject({}),
      () => services.getQuestionBankStatistics(),
    ),
    defineMcpTool(
      "admin_get_recent_content_changes",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List recently updated questions, optionally scoped to one exam and/or a since timestamp (epoch ms).",
      z.strictObject({ examId: examIdSchema.optional(), sinceMs: z.number().int().positive().optional(), ...paginationSchema.shape }),
      (input) => services.getRecentContentChanges(input),
    ),

    // --- Metadata reads ---------------------------------------------------
    defineMcpTool(
      "admin_list_tags",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "List distinct question tags and how many questions use each, optionally scoped to one exam.",
      z.strictObject({ examId: examIdSchema.optional(), ...paginationSchema.shape }),
      (input) => services.listTags(input),
    ),

    // --- Question-bank mutations (implementation) ---------------------------------
    defineMcpTool(
      "admin_preview_component_question",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Preview one schemaVersion 2.0 component item with its referenced stimuli/assets. The server validates and derives type/stem/options; do not supply those projections yourself. Optional id previews an edit, preserving omitted metadata. Submit the returned payload unchanged to admin_create_question with proposalToken/proposalId, or admin_update_question with proposalToken/currentRevision as expectedRevision. No question is saved by this preview.",
      z.strictObject({
        examId: examIdSchema, id: questionIdSchema.optional(), question: z.record(z.string(), z.unknown()),
        stimuli: z.array(z.unknown()).max(200).optional(), assets: z.array(z.unknown()).max(100).optional(),
      }),
      input => services.previewComponentQuestion(input),
    ),
    defineMcpTool(
      "admin_validate_question_payload",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Preview a question create or edit without saving it. Validates the payload with the same rules as Admin/imports, and (with id) returns a before/after diff and whether the answer key would be revised. On success, returns a proposalToken that admin_create_question/admin_update_question require to commit this exact reviewed payload.",
      z.strictObject({ examId: examIdSchema, id: questionIdSchema.optional(), payload: questionPayloadSchema }),
      (input) => services.validateQuestionPayload(input),
    ),
    defineMcpTool(
      "admin_create_question",
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Create a question from a payload already reviewed via admin_validate_question_payload. proposalToken must match that exact payload, or the call is rejected as stale. proposalId is a caller-scoped idempotency key from the same preview call: retrying with the same proposalId returns the question already created instead of inserting a duplicate.",
      z.strictObject({
        examId: examIdSchema, payload: questionPayloadSchema,
        proposalToken: proposalTokenSchema, proposalId: proposalIdSchema,
      }),
      (input) => services.createQuestion(input),
    ),
    defineMcpTool(
      "admin_update_question",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      "Update a question from a payload already reviewed via admin_validate_question_payload. Requires expectedRevision (optimistic concurrency) and a matching proposalToken; either being stale rejects the call and requires a refreshed preview.",
      z.strictObject({
        examId: examIdSchema, id: questionIdSchema, expectedRevision: revisionSchema,
        payload: questionPayloadSchema, proposalToken: proposalTokenSchema,
      }),
      (input) => services.updateQuestion(input),
    ),
    defineMcpTool(
      "admin_delete_question",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      "Delete a question, guarded by expectedRevision so the caller must already know its current state. Blocked with a conflict if the question is referenced by an attempt, bookmark, note, or annotation; no cascading deletion.",
      z.strictObject({ examId: examIdSchema, id: questionIdSchema, expectedRevision: revisionSchema }),
      (input) => services.deleteQuestion(input),
    ),
    defineMcpTool(
      "admin_batch_create_questions",
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      `Create up to ${MAX_BATCH_MUTATION_ITEMS} questions in one call. Each item must carry a proposalToken and proposalId from admin_validate_question_payload for its exact payload. Returns per-item outcomes (each tagged with inputIndex, matching the item's position in the submitted array) plus created/skipped/failed counts; never partially applies an item that failed validation or token binding. Retrying an item with the same proposalId returns its already-created question instead of inserting a duplicate.`,
      z.strictObject({
        examId: examIdSchema,
        items: z.array(z.strictObject({
          payload: questionPayloadSchema, proposalToken: proposalTokenSchema, proposalId: proposalIdSchema,
        })).min(1).max(MAX_BATCH_MUTATION_ITEMS),
      }),
      (input) => services.batchCreateQuestions(input),
    ),
    defineMcpTool(
      "admin_batch_update_questions",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      `Update up to ${MAX_BATCH_MUTATION_ITEMS} questions in one call. Each item must carry its expectedRevision and a proposalToken from admin_validate_question_payload for that exact question/payload; the committed set is exactly the submitted items, never expanded server-side. Returns per-item outcomes (each tagged with inputIndex, matching the item's position in the submitted array, and a diff for updated items) plus updated/skipped/failed counts.`,
      z.strictObject({
        examId: examIdSchema,
        items: z.array(z.strictObject({
          id: questionIdSchema, expectedRevision: revisionSchema,
          proposalToken: proposalTokenSchema, payload: questionPayloadSchema,
        })).min(1).max(MAX_BATCH_MUTATION_ITEMS),
      }),
      (input) => services.batchUpdateQuestions(input),
    ),

    // --- Exam lifecycle (implementation) -------------------------------------------
    defineMcpTool(
      "admin_create_exam",
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Create a new exam. Prefer archive/disable semantics over destructive deletion for exams with historical attempts or references — there is no delete tool.",
      examCreateFieldsSchema,
      (input) => services.createExam(input),
    ),
    defineMcpTool(
      "admin_update_exam",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      "Update one or more fields of an existing exam.",
      z.strictObject({ id: examIdSchema, ...examMutableFieldsSchema.shape }),
      (input) => services.updateExam(input),
    ),
    defineMcpTool(
      "admin_archive_exam",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      "Archive an exam (soft, reversible — sets archivedAt). Conflict if already archived.",
      z.strictObject({ id: examIdSchema }),
      (input) => services.archiveExam(input),
    ),

    // --- Import workflow (implementation) ------------------------------------------
    defineMcpTool(
      "admin_validate_import",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Schema-validate a Question Import file without touching the database (no conflict/duplicate lookup). For a full create/update/skip/conflict breakdown against the current question bank, use admin_preview_import instead.",
      z.strictObject({ examId: examIdSchema, file: importFileSchema }),
      (input) => services.validateImport(input),
    ),
    defineMcpTool(
      "admin_preview_import",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Validate a Question Import file and classify every row as a create, a candidate update, an identical skip, or a conflict needing explicit resolution, without writing anything. Returns importId/importToken that admin_execute_import requires to commit this exact reviewed file.",
      z.strictObject({ examId: examIdSchema, file: importFileSchema }),
      (input) => services.previewImport(input),
    ),
    defineMcpTool(
      "admin_execute_import",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      "Execute a Question Import already reviewed via admin_preview_import. importToken must match that exact file, or the call is rejected as stale. conflictResolutions apply only to the exact previously-previewed {questionId, expectedRevision, incomingToken} triples — a broad \"overwrite everything\" is never authorized. Retrying with the same importId and the same conflictResolutions replays the original result instead of re-applying; the same importId with different conflictResolutions is rejected as a conflict.",
      z.strictObject({
        examId: examIdSchema, file: importFileSchema, importId: importIdSchema, importToken: importTokenSchema,
        conflictResolutions: z.array(conflictResolutionSchema).max(1000).optional(),
      }),
      (input) => services.executeImport(input),
    ),
    defineMcpTool(
      "admin_get_import_status",
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Fetch the recorded status and outcome summary of a previously executed import by importId.",
      z.strictObject({ importId: importIdSchema }),
      (input) => services.getImportStatus(input),
    ),

    // --- Taxonomy (implementation) --------------------------------------------------
    // Administrator-managed question-bank taxonomy only — distinct from the
    // per-user Knowledge Points feature (implementation: notes, groups, tags,
    // question links), which is exposed exclusively via User MCP and has no
    // tools of any kind here. Admin status never grants access to another
    // user's private Knowledge Points.
    defineMcpTool(
      "admin_create_tag",
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      "Register a new question-bank tag name in the admin taxonomy catalog. Conflict if the name already exists (case-insensitive).",
      z.strictObject({ name: tagNameSchema }),
      (input) => services.createTag(input),
    ),
    defineMcpTool(
      "admin_update_tag",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      "Rename a question-bank tag (case-insensitive match). A pure catalog identity change — every question already carrying the tag keeps its association and content unchanged, so this works instantly regardless of how many questions carry it. Conflict if newName already names a different existing tag — use admin_merge_tags instead.",
      z.strictObject({ name: tagNameSchema, newName: tagNameSchema }),
      (input) => services.updateTag(input),
    ),
    defineMcpTool(
      "admin_merge_tags",
      { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      `Merge up to ${MAX_MERGE_SOURCE_TAGS} source tags into a target tag name, reassigning every affected question's association (deduping if a question already carries the target) and removing the source tags from the catalog. A catalog + association change only — no question content or revision is touched.`,
      z.strictObject({ names: z.array(tagNameSchema).min(1).max(MAX_MERGE_SOURCE_TAGS), targetName: tagNameSchema }),
      (input) => services.mergeTags(input),
    ),
  ], observation);
}
