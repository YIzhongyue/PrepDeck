import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAdmin } from "../middleware/admin";
import { hasValidImageContent, ICON_CONTENT_TYPES, type IconContentType } from "../lib/imageValidation";

interface ProviderRow { id: string; name: string; short_name: string; website_url: string | null; icon_url: string | null; created_at: string; archived_at: string | null }
const toProvider = (p: ProviderRow) => ({ id: p.id, name: p.name, shortName: p.short_name, websiteUrl: p.website_url, iconUrl: p.icon_url, createdAt: p.created_at, archivedAt: p.archived_at });

const websiteUrl = z.string().trim().refine((value) => {
  if (!value) return true;
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}, "websiteUrl must be an HTTP or HTTPS URL").nullable().transform((value) => value || null);
const providerFields = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  shortName: z.string().trim().min(1, "shortName is required").max(80),
  websiteUrl: websiteUrl.optional(),
}).strict();
const providerPatch = providerFields.partial().refine((value) => Object.keys(value).length > 0, "No fields to update");

export const providersRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

providersRouter.get("/", async (c) => {
  const includeArchived = c.req.query("includeArchived") === "true" && c.get("user").role === "admin";
  const { results } = await c.env.DB.prepare(`SELECT * FROM providers ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY name`).all<ProviderRow>();
  return c.json({ providers: (results ?? []).map(toProvider) });
});

providersRouter.post("/", requireAdmin, async (c) => {
  const parsed = providerFields.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid provider" }, 400);
  const { name, shortName, websiteUrl = null } = parsed.data;
  const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
  await c.env.DB.prepare("INSERT INTO providers (id, name, short_name, website_url, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, shortName, websiteUrl, createdAt).run();
  return c.json({ provider: { id, name, shortName, websiteUrl, iconUrl: null, createdAt, archivedAt: null } }, 201);
});

providersRouter.patch("/:id", requireAdmin, async (c) => {
  const parsed = providerPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid provider" }, 400);
  const body = parsed.data;
  const fields: string[] = []; const values: unknown[] = [];
  for (const [key, column] of [["name", "name"], ["shortName", "short_name"], ["websiteUrl", "website_url"]] as const) {
    if (body[key] !== undefined) { fields.push(`${column} = ?`); values.push(body[key]); }
  }
  if (!fields.length) return c.json({ error: "No fields to update" }, 400);
  await c.env.DB.prepare(`UPDATE providers SET ${fields.join(", ")} WHERE id = ?`).bind(...values, c.req.param("id")).run();
  const row = await c.env.DB.prepare("SELECT * FROM providers WHERE id = ?").bind(c.req.param("id")).first<ProviderRow>();
  if (!row) return c.json({ error: "Provider not found" }, 404);
  return c.json({ provider: toProvider(row) });
});

for (const action of ["archive", "unarchive"] as const) {
  providersRouter.post(`/:id/${action}`, requireAdmin, async (c) => {
    const id = c.req.param("id");
    const archivedAt = action === "archive" ? new Date().toISOString() : null;
    // Preserve the original archive timestamp on repeated requests.
    await c.env.DB.prepare(`UPDATE providers SET archived_at = ${action === "archive" ? "COALESCE(archived_at, ?)" : "?"} WHERE id = ?`).bind(archivedAt, id).run();
    const row = await c.env.DB.prepare("SELECT * FROM providers WHERE id = ?").bind(id).first<ProviderRow>();
    if (!row) return c.json({ error: "Provider not found" }, 404);
    return c.json({ provider: toProvider(row) });
  });
}

providersRouter.delete("/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  // Check references in the DELETE itself: a concurrent assignment must never
  // be silently removed by provider_exams' ON DELETE CASCADE.
  const result = await c.env.DB.prepare("DELETE FROM providers WHERE id = ? AND NOT EXISTS (SELECT 1 FROM provider_exams WHERE provider_id = providers.id)").bind(id).run();
  if (result.meta.changes === 0) {
    const exists = await c.env.DB.prepare("SELECT id FROM providers WHERE id = ?").bind(id).first();
    return c.json({ error: exists ? "Provider is still assigned to exams. Archive it instead, or reassign its exams before deleting." : "Provider not found" }, exists ? 409 : 404);
  }
  await c.env.BUCKET.delete(`provider-icons/${id}`);
  return c.body(null, 204);
});

providersRouter.put("/:id/exams/:examId", requireAdmin, async (c) => {
  const id = c.req.param("id"); const examId = c.req.param("examId");
  const provider = await c.env.DB.prepare("SELECT * FROM providers WHERE id = ?").bind(id).first<ProviderRow>();
  if (!provider) return c.json({ error: "Provider not found" }, 404);
  if (provider.archived_at) return c.json({ error: "Restore this provider before assigning exams" }, 409);
  if (!await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(examId).first()) return c.json({ error: "Exam not found" }, 404);
  await c.env.DB.prepare("INSERT OR IGNORE INTO provider_exams (provider_id, exam_id) SELECT id, ? FROM providers WHERE id = ? AND archived_at IS NULL").bind(examId, id).run();
  return c.body(null, 204);
});
providersRouter.delete("/:id/exams/:examId", requireAdmin, async (c) => {
  await c.env.DB.prepare("DELETE FROM provider_exams WHERE provider_id = ? AND exam_id = ?").bind(c.req.param("id"), c.req.param("examId")).run();
  return c.body(null, 204);
});

const MAX_ICON_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set<string>(ICON_CONTENT_TYPES);
providersRouter.delete("/:id/icon", requireAdmin, async (c) => {
  const id = c.req.param("id");
  if (!await c.env.DB.prepare("SELECT id FROM providers WHERE id = ?").bind(id).first()) return c.json({ error: "Provider not found" }, 404);
  await c.env.BUCKET.delete(`provider-icons/${id}`);
  await c.env.DB.prepare("UPDATE providers SET icon_url = NULL WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});
providersRouter.post("/:id/icon", requireAdmin, async (c) => {
  const type = c.req.header("Content-Type") ?? "";
  if (!ALLOWED.has(type)) return c.json({ error: "Icon must be a JPEG, PNG, or WebP image" }, 400);
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: "Empty upload" }, 400);
  if (body.byteLength > MAX_ICON_BYTES) return c.json({ error: "Icon must be 2 MB or smaller" }, 413);
  if (!hasValidImageContent(body, type as IconContentType)) {
    return c.json({ error: "Icon content does not match its declared image type or has unsafe dimensions" }, 400);
  }
  const id = c.req.param("id"); if (!await c.env.DB.prepare("SELECT id FROM providers WHERE id = ?").bind(id).first()) return c.json({ error: "Provider not found" }, 404);
  await c.env.BUCKET.put(`provider-icons/${id}`, body, { httpMetadata: { contentType: type } });
  const iconUrl = `/api/provider-icons/${id}?v=${Date.now()}`;
  await c.env.DB.prepare("UPDATE providers SET icon_url = ? WHERE id = ?").bind(iconUrl, id).run();
  return c.json({ iconUrl });
});

export const providerIconsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();
providerIconsRouter.get("/:id", async (c) => {
  const object = await c.env.BUCKET.get(`provider-icons/${c.req.param("id")}`); if (!object) return c.json({ error: "Not found" }, 404);
  const storedType = object.httpMetadata?.contentType ?? "";
  const contentType = ALLOWED.has(storedType) ? storedType : "application/octet-stream";
  return new Response(object.body, { headers: {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "attachment; filename=\"provider-icon\"",
  } });
});
