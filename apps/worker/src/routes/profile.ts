// docs/requirements/authentication-and-users.md — User Profile (Display Name & Avatar) (FR-12.2–FR-12.4).
// FR-12.1 (initializing from the Google profile on first sign-in) and
// FR-12.5 (showing name/avatar wherever identity is surfaced) live
// elsewhere — see middleware/access.ts and routes/notes.ts respectively.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { invalidateCachedUser } from "../lib/userCache";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // FR-12.4
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_DISPLAY_NAME_LENGTH = 100;

interface ProfileRow {
  id: string;
  email: string;
  role: "admin" | "user";
  display_name: string | null;
  avatar_url: string | null;
}

function toProfile(row: ProfileRow) {
  return { id: row.id, email: row.email, role: row.role, displayName: row.display_name, avatarUrl: row.avatar_url };
}

// Mounted at /api/me.
export const profileRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// FR-12.2: edit one's own display name.
profileRouter.patch("/", async (c) => {
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) return c.json({ error: "displayName is required" }, 400);
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return c.json({ error: `displayName must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer` }, 400);
  }

  await c.env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(displayName, userId).run();
  await invalidateCachedUser(c.env, userId, c.get("user").email);
  const row = await c.env.DB.prepare("SELECT id, email, role, display_name, avatar_url FROM users WHERE id = ?")
    .bind(userId)
    .first<ProfileRow>();
  return c.json({ user: toProfile(row!) });
});

// FR-12.3/FR-12.4: upload a custom avatar, overriding the Google-sourced
// default photo. The client sends the already-resized/compressed image as a
// raw binary body with its real image Content-Type (no multipart parsing
// needed for a single-file upload); size and type are re-validated here
// since the client-side check is a UX nicety, not a security boundary.
profileRouter.post("/avatar", async (c) => {
  const userId = c.get("user").id;
  const contentType = c.req.header("Content-Type") ?? "";
  if (!ALLOWED_AVATAR_TYPES.has(contentType)) {
    return c.json({ error: "Avatar must be a JPEG, PNG, or WebP image" }, 400);
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "Empty upload" }, 400);
  if (body.byteLength > MAX_AVATAR_BYTES) return c.json({ error: "Avatar must be 2 MB or smaller" }, 413);

  // One active avatar per user — a re-upload overwrites the previous object
  // at the same key. The `v` query param is cache-busting only (the GET
  // handler below ignores it): browsers would otherwise keep serving the
  // old image from cache at the same URL for the "Cache-Control: max-age"
  // window, in this tab and any other place the stored avatar_url is reused.
  const key = `avatars/${userId}`;
  await c.env.BUCKET.put(key, body, { httpMetadata: { contentType } });

  const avatarUrl = `/api/avatars/${userId}?v=${Date.now()}`;
  await c.env.DB.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").bind(avatarUrl, userId).run();
  await invalidateCachedUser(c.env, userId, c.get("user").email);
  return c.json({ avatarUrl });
});

// Mounted at /api/avatars — separate from /api/me since any signed-in user
// may need to load another user's avatar (FR-12.5: shared notes, the
// Authorized Users list, etc.), not just their own. R2 objects aren't
// publicly readable by default (docs/architecture/system-overview.md#storage-and-services), so this streams them through
// the Worker instead.
export const avatarsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

avatarsRouter.get("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const object = await c.env.BUCKET.get(`avatars/${userId}`);
  if (!object) return c.json({ error: "Not found" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300"
    }
  });
});
