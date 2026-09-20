// DTOs for the Annotation & Review API (docs/requirements/review-notes-and-annotations.md), shared between the
// Worker's responses and the web client's fetch calls.

import type { Annotation } from "./types";

export interface CreateAnnotationRequest {
  targetType: "stem" | "option" | "ai_explanation";
  targetRef?: string | null; // option id, required when targetType === "option"
  rangeStart: number;
  rangeEnd: number;
  style: string; // e.g. 'hl1' | 'underline' | 'bold' — free-form, UI-defined
  note?: string | null; // FR-8.2
}

export interface UpdateAnnotationRequest {
  style?: string;
  note?: string | null;
}

export interface AnnotationResponse {
  annotation: Annotation;
}

export interface AnnotationsListResponse {
  annotations: Annotation[];
}
