// DTOs for per-user annotation "mark" aliases (implementation). Purely
// presentational: separates a mark's stable logical slot (hl1/hl2/hl3,
// already the annotations.style value — see annotations.ts) from its
// theme-driven color and from the user's own display name for it.

import type { z } from "zod";
import type { updateAnnotationSettingsRequestSchema } from "./annotationSettings.schema.ts";
export type MarkStyle = "hl1" | "hl2" | "hl3";

export const MARK_STYLES: readonly MarkStyle[] = ["hl1", "hl2", "hl3"];

export const DEFAULT_MARK_ALIASES: Record<MarkStyle, string> = {
  hl1: "Service",
  hl2: "Key constraint",
  hl3: "Other"
};

export const MARK_ALIAS_MAX_LENGTH = 40;

export interface AnnotationSettingsResponse {
  hl1Alias: string;
  hl2Alias: string;
  hl3Alias: string;
}

export type UpdateAnnotationSettingsRequest = z.input<typeof updateAnnotationSettingsRequestSchema>;
