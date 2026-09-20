import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAdmin } from "../middleware/admin";
import { hasValidImageContent, ICON_CONTENT_TYPES, type IconContentType } from "../lib/imageValidation";

interface ProviderRow { id: string; name: string; short_name: string; website_url: string | null; icon_url: string | null; created_at: string }
const toProvider = (p: ProviderRow) => ({ id: p.id, name: p.name, shortName: p.short_name, websiteUrl: p.website_url, iconUrl: p.icon_url, createdAt: p.created_at });

export const providersRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

providersRouter.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM providers ORDER BY name").all<ProviderRow>();
  return c.json({ providers: (results ?? []).map(toProvider) });
});

providersRouter.post("/", requireAdmin, async (c) => {
  const body = await c.req.json<{ name?: string; shortName?: string; websiteUrl?: string }>().catch(() => null);
  const name = body?.name?.trim(); const shortName = body?.shortName?.trim();
  if (!name || !shortName) return c.json({ error: "name and shortName are required" }, 400);
  const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
  await c.env.DB.prepare("INSERT INTO providers (id, name, short_name, website_url, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, shortName, body?.websiteUrl?.trim() || null, createdAt).run();
  return c.json({ provider: { id, name, shortName, websiteUrl: body?.websiteUrl?.trim() || null, iconUrl: null, createdAt } }, 201);
});

providersRouter.patch("/:id", requireAdmin, async (c) => {
  const body = await c.req.json<{ name?: string; shortName?: string; websiteUrl?: string | null }>().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);
  const fields: string[] = []; const values: unknown[] = [];
  for (const [key, column] of [["name", "name"], ["shortName", "short_name"], ["websiteUrl", "website_url"]] as const) {
    if (body[key] !== undefined) { fields.push(`${column} = ?`); values.push(typeof body[key] === "string" ? body[key]!.trim() || null : null); }
  }
  if (!fields.length) return c.json({ error: "No fields to update" }, 400);
  await c.env.DB.prepare(`UPDATE providers SET ${fields.join(", ")} WHERE id = ?`).bind(...values, c.req.param("id")).run();
  const row = await c.env.DB.prepare("SELECT * FROM providers WHERE id = ?").bind(c.req.param("id")).first<ProviderRow>();
  if (!row) return c.json({ error: "Provider not found" }, 404);
  return c.json({ provider: toProvider(row) });
});

providersRouter.put("/:id/exams/:examId", requireAdmin, async (c) => {
  await c.env.DB.prepare("INSERT OR IGNORE INTO provider_exams (provider_id, exam_id) VALUES (?, ?)").bind(c.req.param("id"), c.req.param("examId")).run();
  return c.body(null, 204);
});
providersRouter.delete("/:id/exams/:examId", requireAdmin, async (c) => {
  await c.env.DB.prepare("DELETE FROM provider_exams WHERE provider_id = ? AND exam_id = ?").bind(c.req.param("id"), c.req.param("examId")).run();
  return c.body(null, 204);
});

const MAX_ICON_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set<string>(ICON_CONTENT_TYPES);
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
