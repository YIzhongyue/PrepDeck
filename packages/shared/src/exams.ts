// Exam fields shared by the Admin UI's exam forms and the Worker routes and
// Admin MCP tools that store them (docs/requirements/question-bank-management.md, FR-2.1).

import type { z } from "zod";
import type { updateExamRequestSchema } from "./exams.schema.ts";

/** An exam slug: lowercase letters and digits in hyphen-separated groups, e.g. aws-sap-c02. */
export const EXAM_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type { CreateExamRequest } from "./exams.schema.ts";
export type UpdateExamRequest = z.input<typeof updateExamRequestSchema>;

export interface ExamBadgeSource {
  imageUrl: string;
  issuerUrl: string;
}

export type ExamBadgeImportError = "source_not_allowed" | "download_failed" | "image_too_large" | "invalid_image" | "storage_failed" | "exam_changed";

export type ExamBadgeImportResult =
  | { status: "imported" | "already_has_badge"; badgeIconUrl: string }
  | { status: "missing_source" }
  | { status: "failed"; reason: ExamBadgeImportError };
