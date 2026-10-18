// Request body for PUT /api/admin/appearance. See appearance.ts.

import { z } from "zod";
import { MASCOT_STYLES } from "./appearance.ts";

const MASCOT_STYLE = "Expected mascotStyle to be 3D-Chibi or 2D-Anime";

// Exactly one field: anything else in the body is refused, not ignored.
export const updateSiteAppearanceRequestSchema = z.strictObject({
  mascotStyle: z.enum(MASCOT_STYLES, MASCOT_STYLE),
}, MASCOT_STYLE);
