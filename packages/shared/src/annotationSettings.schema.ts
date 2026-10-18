// Request body for PATCH /api/annotation-settings. See annotationSettings.ts.

import { z } from "zod";
import { MARK_ALIAS_MAX_LENGTH } from "./annotationSettings.ts";

// Measured trimmed: empty or whitespace-only input falls back to the stored
// alias or the built-in default (see the Worker's resolveMarkAlias).
const alias = (field: string) => z.string(`${field} must be a string`)
  .refine((value) => value.trim().length <= MARK_ALIAS_MAX_LENGTH, `${field} must be ${MARK_ALIAS_MAX_LENGTH} characters or fewer`)
  .optional();

// Partial: Settings edits/saves one alias field at a time.
export const updateAnnotationSettingsRequestSchema = z.object({
  hl1Alias: alias("hl1Alias"),
  hl2Alias: alias("hl2Alias"),
  hl3Alias: alias("hl3Alias"),
}, "Invalid JSON body").refine(
  (body) => body.hl1Alias !== undefined || body.hl2Alias !== undefined || body.hl3Alias !== undefined,
  "Provide at least one of hl1Alias, hl2Alias, hl3Alias",
);
