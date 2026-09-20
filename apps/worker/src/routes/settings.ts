// FR-11.4's "show other users' shared notes" toggle, plus the Settings
// page's color-scheme (theme) picker added to this task's scope. Kept
// minimal and separate from the richer profile settings docs/requirements/authentication-and-users.md owns
// (display name, avatar — see routes/profile.ts).

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import type { ThemeId } from "@prepdeck/shared";

const THEME_IDS: ThemeId[] = ["cream", "sage", "clay", "dusk"];

interface SettingsRow {
  show_shared_notes: number;
  theme: string | null;
}

export const settingsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

settingsRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const row = await c.env.DB.prepare("SELECT show_shared_notes, theme FROM users WHERE id = ?")
    .bind(userId)
    .first<SettingsRow>();
  return c.json({ showSharedNotes: !!row?.show_shared_notes, theme: (row?.theme as ThemeId | null) ?? null });
});

settingsRouter.patch("/", async (c) => {
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "Invalid JSON body" }, 400);

  const hasShowSharedNotes = body.showSharedNotes !== undefined;
  const hasTheme = body.theme !== undefined;
  if (!hasShowSharedNotes && !hasTheme) {
    return c.json({ error: "Provide showSharedNotes and/or theme" }, 400);
  }
  if (hasShowSharedNotes && typeof body.showSharedNotes !== "boolean") {
    return c.json({ error: "showSharedNotes must be a boolean" }, 400);
  }
  if (hasTheme && body.theme !== null && !THEME_IDS.includes(body.theme)) {
    return c.json({ error: `theme must be one of ${THEME_IDS.join(", ")}, or null` }, 400);
  }

  const current = await c.env.DB.prepare("SELECT show_shared_notes, theme FROM users WHERE id = ?")
    .bind(userId)
    .first<SettingsRow>();
  const showSharedNotes = hasShowSharedNotes ? (body.showSharedNotes as boolean) : !!current?.show_shared_notes;
  const theme = hasTheme ? (body.theme as ThemeId | null) : ((current?.theme as ThemeId | null) ?? null);

  await c.env.DB.prepare("UPDATE users SET show_shared_notes = ?, theme = ? WHERE id = ?")
    .bind(showSharedNotes ? 1 : 0, theme, userId)
    .run();

  return c.json({ showSharedNotes, theme });
});
