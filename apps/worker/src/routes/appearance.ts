import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DEFAULT_MASCOT_STYLE, isMascotStyle } from "@prepdeck/shared";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAdmin } from "../middleware/admin";

type Context = { Bindings: Env; Variables: Variables };
export const appearanceRouter = new Hono<Context>();
export const adminAppearanceRouter = new Hono<Context>();

// No cookies or user data in this public response. Read the primary D1
// binding directly (no replicas/KV/cache), so a refresh sees the last save.
appearanceRouter.get("/", async (c) => {
  c.header("Cache-Control", "no-store");
  try {
    const row = await c.env.DB.prepare("SELECT mascot_style FROM site_appearance WHERE id = 1")
      .first<{ mascot_style: string }>();
    return c.json({ mascotStyle: isMascotStyle(row?.mascot_style) ? row.mascot_style : DEFAULT_MASCOT_STYLE });
  } catch {
    console.error("site_appearance_read_failed");
    return c.json({ error: "Site appearance is temporarily unavailable" }, 503);
  }
});

// Mounted behind requireAccessUser in index.ts; never trust a frontend role.
adminAppearanceRouter.use("*", requireAdmin);
adminAppearanceRouter.use("*", bodyLimit({ maxSize: 1024,
  onError: (c) => c.json({ error: "Request body exceeds 1024 bytes" }, 413),
}));
adminAppearanceRouter.put("/", async (c) => {
  c.header("Cache-Control", "no-store");
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).length !== 1 || !("mascotStyle" in body) || !isMascotStyle(body.mascotStyle)) {
    return c.json({ error: "Expected mascotStyle to be 3D-Chibi or 2D-Anime" }, 400);
  }
  try {
    const result = await c.env.DB.prepare(`INSERT INTO site_appearance (id, mascot_style, updated_at)
      VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET mascot_style = excluded.mascot_style,
      updated_at = excluded.updated_at`).bind(body.mascotStyle, new Date().toISOString()).run();
    if (!result.success) throw new Error("Write failed");
    return c.json({ mascotStyle: body.mascotStyle });
  } catch {
    console.error("site_appearance_write_failed");
    return c.json({ error: "Could not save site appearance. Please retry." }, 503);
  }
});
