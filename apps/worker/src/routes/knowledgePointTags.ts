// implementation — Knowledge Point tags: per-user, overlapping (many-to-many with
// notes via knowledge_point_tag_links). Renaming here updates every note
// that uses the tag for free (links reference tag_id, not the tag text);
// deleting removes only the association, never the notes. Mounted at
// /api/knowledge-point-tags.
//
// implementation — CRUD now lives in lib/knowledgePointTagMutations.ts, shared
// with the User MCP adapter.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { listTags, renameTag, deleteTag } from "../lib/knowledgePointTagMutations";

// See routes/knowledgePointGroups.ts's UNPAGINATED_LIMIT — REST's GET / has
// never paginated the tag catalog either.
const UNPAGINATED_LIMIT = 100_000;

export const knowledgePointTagsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

knowledgePointTagsRouter.get("/", async (c) => {
  const { tags } = await listTags(c.env.DB, c.get("user").id, { limit: UNPAGINATED_LIMIT, offset: 0 });
  return c.json({ tags });
});

knowledgePointTagsRouter.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = await renameTag(c.env.DB, { id: c.req.param("id"), userId: c.get("user").id, name: (body as { name?: unknown } | null)?.name });
  if (!result.ok) {
    if (result.reason === "not_found") return c.json({ error: "Tag not found" }, 404);
    if (result.reason === "duplicate") return c.json({ error: "A tag with that name already exists" }, 409);
    return c.json({ error: "A valid tag name is required" }, 400);
  }
  return c.json({ tag: result.tag });
});

knowledgePointTagsRouter.delete("/:id", async (c) => {
  const deleted = await deleteTag(c.env.DB, { id: c.req.param("id"), userId: c.get("user").id });
  if (!deleted) return c.json({ error: "Tag not found" }, 404);
  return c.body(null, 204);
});
