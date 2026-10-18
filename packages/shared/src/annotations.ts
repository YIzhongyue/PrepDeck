// DTOs for the Annotation & Review API (docs/requirements/review-notes-and-annotations.md), shared between the
// Worker's responses and the web client's fetch calls.

import type { Annotation } from "./types";
import type { z } from "zod";
import type { createAnnotationRequestSchema, updateAnnotationRequestSchema } from "./annotations.schema.ts";

export type CreateAnnotationRequest = z.input<typeof createAnnotationRequestSchema>;

export type UpdateAnnotationRequest = z.input<typeof updateAnnotationRequestSchema>;

export interface AnnotationResponse {
  annotation: Annotation;
}

export interface AnnotationsListResponse {
  annotations: Annotation[];
}

// Length limits (issue #45), in UTF-16 code units: an annotation note is a
// short remark on a marked span (FR-8.2), and its style is a mark identifier.
export const MAX_ANNOTATION_NOTE_LENGTH = 2_000;
export const MAX_ANNOTATION_STYLE_LENGTH = 64;
