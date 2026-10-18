// Request bodies for the Annotation & Review API (docs/requirements/review-notes-and-annotations.md).
// See annotations.ts for the response DTOs and length limits.

import { z } from "zod";
import { MAX_ANNOTATION_NOTE_LENGTH, MAX_ANNOTATION_STYLE_LENGTH } from "./annotations.ts";

const TARGET_REF_REQUIRED = "targetRef is required when targetType is option";
const RANGE_END = "rangeEnd must be an integer greater than rangeStart";

// Issue #45: both strings used to be unbounded; an oversized one reached D1
// and came back as an unhandled SQLITE_TOOBIG 500.
const note = z.string("note must be a string")
  .max(MAX_ANNOTATION_NOTE_LENGTH, `note must be ${MAX_ANNOTATION_NOTE_LENGTH.toLocaleString("en")} characters or fewer`)
  .nullish(); // FR-8.2

// Checked after `note`, as it always has been, so it is not a field check.
function checkStyleLength(body: { style?: string | null }, ctx: z.RefinementCtx) {
  if (typeof body.style === "string" && body.style.length > MAX_ANNOTATION_STYLE_LENGTH) {
    ctx.addIssue({ code: "custom", message: `style must be ${MAX_ANNOTATION_STYLE_LENGTH} characters or fewer`, path: ["style"] });
  }
}

// POST /api/questions/:questionId/annotations.
export const createAnnotationRequestSchema = z.object({
  targetType: z.enum(["stem", "option", "ai_explanation"], "targetType must be one of stem, option, ai_explanation"),
  // Option id, required when targetType === "option" and omitted otherwise;
  // which of the two depends on targetType, so it is checked below.
  targetRef: z.custom<string | null>().optional(),
  rangeStart: z.int("rangeStart must be a non-negative integer").min(0, "rangeStart must be a non-negative integer"),
  rangeEnd: z.int(RANGE_END),
  // e.g. 'hl1' | 'underline' | 'bold' — free-form, UI-defined.
  style: z.string("style is required").min(1, "style is required"),
  note,
}, "Invalid JSON body").superRefine((body, ctx) => {
  if (body.targetType === "option") {
    if (typeof body.targetRef !== "string" || !body.targetRef) ctx.addIssue({ code: "custom", message: TARGET_REF_REQUIRED, path: ["targetRef"] });
  } else if (body.targetRef != null) {
    ctx.addIssue({ code: "custom", message: "targetRef must be omitted unless targetType is option", path: ["targetRef"] });
  }
  if (body.rangeEnd <= body.rangeStart) ctx.addIssue({ code: "custom", message: RANGE_END, path: ["rangeEnd"] });
  checkStyleLength(body, ctx);
});

// PATCH /api/annotations/:id. An omitted or null style keeps the current one;
// a null note clears it.
export const updateAnnotationRequestSchema = z.object({
  style: z.string("style must be a non-empty string").min(1, "style must be a non-empty string").nullish(),
  note,
}, "Invalid JSON body").superRefine(checkStyleLength);
