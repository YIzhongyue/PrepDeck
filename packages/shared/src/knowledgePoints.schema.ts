// Request bodies for the Knowledge Points API (implementation). See
// knowledgePoints.ts for the response DTOs and limits. Group and tag names
// are checked by the Worker's knowledge point libraries, which User MCP
// shares, so their bodies have no schema here.

import { z } from "zod";
import { KNOWLEDGE_POINT_MAX_BODY_LENGTH, KNOWLEDGE_POINT_MAX_TITLE_LENGTH } from "./knowledgePoints.ts";

// A group or note id, or null. Any other value is passed through String() and
// then simply not found, as these routes have always done, rather than refused.
const toId = (value: string | null | undefined) => (value == null ? null : String(value));
const requiredId = (message: string) => z.custom<string | null>((value) => value !== undefined, message).transform(toId);

// POST /api/knowledge-points. Never refused: a body that is not an object
// creates an ungrouped note.
export const createKnowledgePointRequestSchema = z.object({
  groupId: z.custom<string | null>().optional().transform(toId),
}).catch(() => ({ groupId: null }));

// PUT /api/knowledge-points/:id (autosave).
export const autosaveKnowledgePointRequestSchema = z.object({
  baseRevision: z.number("baseRevision is required"),
  title: z.string("title is required")
    .max(KNOWLEDGE_POINT_MAX_TITLE_LENGTH, `title must be ${KNOWLEDGE_POINT_MAX_TITLE_LENGTH} characters or fewer`),
  bodyMarkdown: z.string("bodyMarkdown is required")
    .max(KNOWLEDGE_POINT_MAX_BODY_LENGTH, `bodyMarkdown must be ${KNOWLEDGE_POINT_MAX_BODY_LENGTH} characters or fewer`),
}, "Invalid JSON body");

// PATCH /api/knowledge-points/:id/group. null moves the note to Ungrouped.
export const setKnowledgePointGroupRequestSchema = z.object({
  groupId: requiredId("groupId is required"),
}, "groupId is required");

// PATCH /api/knowledge-points/:id/reorder. null moves the note to the end.
export const reorderKnowledgePointRequestSchema = z.object({
  beforeId: requiredId("beforeId is required"),
  // The list's orderRevision the drag was made against. Optional only for
  // tabs still running a bundle from before it existed; see the route.
  expectedOrderRevision: z.int("expectedOrderRevision must be a positive integer; reload the list before reordering")
    .min(1, "expectedOrderRevision must be a positive integer; reload the list before reordering")
    .optional(),
}, "beforeId is required");

// POST /api/knowledge-points/:id/questions.
export const linkKnowledgePointQuestionRequestSchema = z.object({
  questionId: z.string("questionId is required").min(1, "questionId is required"),
}, "questionId is required");
