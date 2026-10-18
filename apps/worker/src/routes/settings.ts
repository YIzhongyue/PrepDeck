// FR-11.4's "show other users' shared notes" toggle, plus the Settings
// page's color-scheme (theme) picker added to this task's scope, and the
// account's time zone (issue #47, lib/userTimeZone.ts). Kept
// minimal and separate from the richer profile settings docs/requirements/authentication-and-users.md owns
// (display name, avatar — see routes/profile.ts).

import { createRouter } from "../context";
import type { ThemeId } from "@prepdeck/shared";
import { updateUserSettingsRequestSchema } from "@prepdeck/shared/schemas";
import { readBody } from "../lib/requestBody";

interface SettingsRow {
  show_shared_notes: number;
  theme: string | null;
  timezone: string | null;
}

export const settingsRouter = createRouter();

settingsRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const row = await c.env.DB.prepare("SELECT show_shared_notes, theme, timezone FROM users WHERE id = ?")
    .bind(userId)
    .first<SettingsRow>();
  return c.json({ showSharedNotes: !!row?.show_shared_notes, theme: (row?.theme as ThemeId | null) ?? null, timezone: row?.timezone ?? null });
});

settingsRouter.patch("/", async (c) => {
  const userId = c.get("user").id;
  const parsed = await readBody(c, updateUserSettingsRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const current = await c.env.DB.prepare("SELECT show_shared_notes, theme, timezone FROM users WHERE id = ?")
    .bind(userId)
    .first<SettingsRow>();
  const showSharedNotes = body.showSharedNotes ?? !!current?.show_shared_notes;
  const theme = body.theme !== undefined ? body.theme : ((current?.theme as ThemeId | null) ?? null);
  const timezone = body.timezone ?? current?.timezone ?? null;

  await c.env.DB.prepare("UPDATE users SET show_shared_notes = ?, theme = ?, timezone = ? WHERE id = ?")
    .bind(showSharedNotes ? 1 : 0, theme, timezone, userId)
    .run();

  return c.json({ showSharedNotes, theme, timezone });
});
