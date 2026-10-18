// Request body for PATCH /api/me (FR-12.2). See profile.ts.

import { z } from "zod";
import { MAX_DISPLAY_NAME_LENGTH } from "./profile.ts";

export const updateProfileRequestSchema = z.object({
  // Stored trimmed.
  displayName: z.string("displayName is required").trim().min(1, "displayName is required")
    .max(MAX_DISPLAY_NAME_LENGTH, `displayName must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`),
}, "displayName is required");
