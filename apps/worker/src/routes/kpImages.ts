// implementation — Knowledge Point image attachments (paste/upload). Mirrors
// routes/profile.ts's avatar pattern: raw binary body, re-validated
// Content-Type + real image-byte sniffing, R2 storage with only a stable
// Worker-relative streaming URL kept in D1 — never a raw R2 key or public
// URL handed to the client. Unlike avatars, these are private to the owner
// (no sharing), so the GET route is session-gated, not just signed-in-gated.
// Mounted at /api/kp-images.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { ICON_CONTENT_TYPES, hasValidImageContent, type IconContentType } from "../lib/imageValidation";
import { enqueueImageRetirementStatement, flushRetiredImages } from "../lib/knowledgePointImageRetirement";

const MAX_KP_IMAGE_BYTES = 8 * 1024 * 1024;

interface ImageRow {
  id: string;
  user_id: string;
  r2_object_key: string;
  content_type: string;
}

export const kpImagesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

kpImagesRouter.post("/:knowledgePointId", async (c) => {
  const userId = c.get("user").id;
  const knowledgePointId = c.req.param("knowledgePointId");
  const kp = await c.env.DB.prepare("SELECT id FROM knowledge_points WHERE id = ? AND user_id = ?")
    .bind(knowledgePointId, userId)
    .first();
  if (!kp) return c.json({ error: "Knowledge point not found" }, 404);

  const contentType = c.req.header("Content-Type") ?? "";
  if (!(ICON_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return c.json({ error: "Image must be a JPEG, PNG, or WebP" }, 400);
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "Empty upload" }, 400);
  if (body.byteLength > MAX_KP_IMAGE_BYTES) return c.json({ error: "Image must be 8 MB or smaller" }, 413);
  if (!hasValidImageContent(body, contentType as IconContentType)) {
    return c.json({ error: "File content does not match the declared image type" }, 400);
  }

  const id = crypto.randomUUID();
  const key = `kp-images/${userId}/${id}`;
  await c.env.BUCKET.put(key, body, { httpMetadata: { contentType } });

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO knowledge_point_images (id, user_id, knowledge_point_id, r2_object_key, content_type, byte_size, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(id, userId, knowledgePointId, key, contentType, body.byteLength, now, now)
    .run();

  return c.json({ image: { id, url: `/api/kp-images/${id}`, status: "pending" } }, 201);
});

kpImagesRouter.get("/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM knowledge_point_images WHERE id = ?")
    .bind(c.req.param("id"))
    .first<ImageRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  // Private per note — unlike avatars, never shareable to another user.
  if (row.user_id !== c.get("user").id) return c.json({ error: "Forbidden" }, 403);

  const object = await c.env.BUCKET.get(row.r2_object_key);
  if (!object) return c.json({ error: "Not found" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? row.content_type,
      "Cache-Control": "private, max-age=86400",
    },
  });
});

kpImagesRouter.delete("/:id", async (c) => {
  const userId = c.get("user").id;
  const row = await c.env.DB.prepare("SELECT * FROM knowledge_point_images WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .first<ImageRow>();
  if (!row) return c.json({ error: "Not found" }, 404);

  // Enqueue the tombstone in the same transaction that drops the row, then
  // try R2 immediately so the common case still reclaims storage now. If that
  // delete fails the tombstone survives and the daily sweep retries it — which
  // deleting from R2 first could not do, since a failure there left an object
  // no row remembered.
  await c.env.DB.batch([
    enqueueImageRetirementStatement(c.env.DB, [row], Date.now()),
    c.env.DB.prepare("DELETE FROM knowledge_point_images WHERE id = ?").bind(row.id),
  ]);
  c.executionCtx.waitUntil(flushRetiredImages(c.env.DB, c.env.BUCKET, [row]));
  return c.body(null, 204);
});
