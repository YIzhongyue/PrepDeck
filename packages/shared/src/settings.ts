// DTOs for the small set of persisted per-user preferences that live outside
// the richer profile fields docs/requirements/authentication-and-users.md owns (display name, avatar):
// FR-11.4's "show other users' shared notes" toggle, and the Settings page's
// color-scheme (theme) picker, added to this task's scope alongside 3.12.

export type ThemeId = "cream" | "sage" | "clay" | "dusk";

export interface UserSettingsResponse {
  showSharedNotes: boolean;
  theme: ThemeId | null;
}

// Partial: the two preferences are edited independently in the UI (the
// shared-notes toggle and the theme picker are separate controls), so a
// PATCH only needs to carry whichever one changed.
export interface UpdateUserSettingsRequest {
  showSharedNotes?: boolean;
  theme?: ThemeId | null;
}
