// DTOs for the small set of persisted per-user preferences that live outside
// the richer profile fields docs/requirements/authentication-and-users.md owns (display name, avatar):
// FR-11.4's "show other users' shared notes" toggle, and the Settings page's
// color-scheme (theme) picker, added to this task's scope alongside 3.12.

import type { z } from "zod";
import type { updateUserSettingsRequestSchema } from "./settings.schema.ts";
export type ThemeId = "cream" | "sage" | "clay" | "dusk";

export interface UserSettingsResponse {
  showSharedNotes: boolean;
  theme: ThemeId | null;
  // issue #47: the account's IANA time zone, used for statistics and the daily
  // email. Null until one is chosen; the server counts in UTC until then.
  timezone: string | null;
}

export type UpdateUserSettingsRequest = z.input<typeof updateUserSettingsRequestSchema>;
