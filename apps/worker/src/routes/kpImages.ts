import { isKnowledgePointQuotaError } from "../lib/knowledgePointQuota";
// implementation — Knowledge Point image attachments (paste/upload). Mirrors
// routes/profile.ts's avatar pattern: raw binary body, re-validated
// Content-Type + real image-byte sniffing, R2 storage with only a stable
// Worker-relative streaming URL kept in D1 — never a raw R2 key or public
// URL handed to the client. Unlike avatars, these are private to the owner
// (no sharing), so the GET route is session-gated, not just signed-in-gated.
// Mounted at /api/kp-images.

import { createRouter } from "../context";
import { ICON_CONTENT_TYPES, hasValidImageContent, type IconContentType } from "../lib/imageValidation";
import { enqueueImageRetirementStatement, flushRetiredImages } from "../lib/knowledgePointImageRetirement";

const MAX_KP_IMAGE_BYTES = 8 * 1024 * 1024;

interface ImageRow {
  id: string;
  user_id: string;
  r2_object_key: string;
  content_type: string;
}

export const kpImagesRouter = createRouter();

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

  const requestKey = c.req.header("Idempotency-Key") ?? crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) return c.json({ error: "Invalid upload request key" }, 400);
  const digest = await crypto.subtle.digest("SHA-256", body);
  const payloadHash = `${knowledgePointId}:${contentType}:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("")}`;
  const replay = async () => {
    const existing = await c.env.DB.prepare("SELECT id,payload_hash,upload_state FROM knowledge_point_image_usage WHERE user_id=? AND request_key=?")
      .bind(userId,requestKey).first<{ id: string; payload_hash: string; upload_state: string }>();
    if (!existing) return null;
    if (existing.payload_hash !== payloadHash) return c.json({ error: "Upload request key was already used for different content" }, 409);
    const live = await c.env.DB.prepare("SELECT status FROM knowledge_point_images WHERE id=? AND user_id=?").bind(existing.id,userId).first<{ status: string }>();
    if (live) return c.json({ image: { id: existing.id, url: `/api/kp-images/${existing.id}`, status: live.status } }, 200);
    return c.json({ error: "This upload is still pending or requires reconciliation. Do not start another upload for this request.", code: "upload_pending" }, 409);
  };
  const prior = await replay();
  if (prior) return prior;
  const id = crypto.randomUUID();
  const key = `kp-images/${userId}/${id}`;
  const now = new Date().toISOString();
  // Reserve atomically before sending any bytes to R2. A crashed/ambiguous
  // upload remains charged; never release it merely because a timer expired.
  try {
    await c.env.DB.prepare(`INSERT INTO knowledge_point_image_usage
      (id,user_id,r2_object_key,byte_size,upload_state,created_at,request_key,payload_hash) VALUES(?,?,?,?,'uploading',?,?,?)`)
      .bind(id,userId,key,body.byteLength,now,requestKey,payloadHash).run();
  } catch (error) {
    const duplicate = await replay();
    if (duplicate) return duplicate;
    if (isKnowledgePointQuotaError(error)) return c.json({ error: "Knowledge Point image quota reached. Delete images to free space.", code: "quota_exceeded" }, 409);
    throw error;
  }
  // On a PUT exception, keep the reservation for reconciliation: a failed
  // response alone is not proof that R2 stored no object.
  await c.env.BUCKET.put(key, body, { httpMetadata: { contentType } });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE knowledge_point_image_usage SET upload_state='ready' WHERE id=?").bind(id),
      c.env.DB.prepare(
        `INSERT INTO knowledge_point_images (id, user_id, knowledge_point_id, r2_object_key, content_type, byte_size, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).bind(id,userId,knowledgePointId,key,contentType,body.byteLength,now,now),
    ]);
  } catch (error) {
    // D1 may have committed even when its response failed. A confirmed live
    // attachment must never be retired by this recovery path. If this read
    // fails too, leave the reservation intact for reconciliation.
    const committed = await c.env.DB.prepare("SELECT id FROM knowledge_point_images WHERE id=? AND user_id=?")
      .bind(id,userId).first();
    if (committed) return c.json({ image: { id, url: `/api/kp-images/${id}`, status: "pending" } }, 201);
    // An empty read does not prove the original batch cannot commit later.
    // Keep the reservation and object for reconciliation; never delete here.
    throw error;
  }
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
