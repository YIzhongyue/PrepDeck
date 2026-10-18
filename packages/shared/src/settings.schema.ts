// Request body for PATCH /api/settings. See settings.ts.

import { z } from "zod";
import type { ThemeId } from "./settings.ts";
import { canonicalTimeZone } from "./timeZone.ts";

const THEME_IDS = ["cream", "sage", "clay", "dusk"] as const satisfies readonly ThemeId[];
const TIMEZONE = "timezone must be a valid IANA time zone name";

// Partial: the preferences are edited independently in the UI (the
// shared-notes toggle, the theme picker and the time zone are separate
// controls), so a PATCH only needs to carry whichever one changed.
export const updateUserSettingsRequestSchema = z.object({
  showSharedNotes: z.boolean("showSharedNotes must be a boolean").optional(),
  theme: z.enum(THEME_IDS, `theme must be one of ${THEME_IDS.join(", ")}, or null`).nullable().optional(),
  // Stored in its canonical spelling (issue #47).
  timezone: z.string(TIMEZONE).transform((value, ctx) => {
    const canonical = canonicalTimeZone(value);
    if (!canonical) {
      ctx.addIssue({ code: "custom", message: TIMEZONE });
      return z.NEVER;
    }
    return canonical;
  }).optional(),
}, "Invalid JSON body").refine(
  (body) => body.showSharedNotes !== undefined || body.theme !== undefined || body.timezone !== undefined,
  "Provide showSharedNotes, theme and/or timezone",
);
