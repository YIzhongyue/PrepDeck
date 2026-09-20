// implementation — Knowledge Point groups: flat, per-user, at most one per note.
// "Ungrouped" is virtual (knowledge_points.group_id IS NULL) — never a real
// row here, so it can't be renamed/deleted through this router. Mounted at
// /api/knowledge-point-groups.
//
// implementation — CRUD now lives in lib/knowledgePointGroupMutations.ts, shared
// with the User MCP adapter.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { listGroups, createGroup, renameGroup, deleteGroup } from "../lib/knowledgePointGroupMutations";

// REST's GET / has never paginated — every group for the user, in one
// response. listGroups() itself always takes a page window (the User MCP
// tool genuinely paginates), so this asks for everything in one call rather
// than duplicating the query with a second code path.
const UNPAGINATED_LIMIT = 100_000;

export const knowledgePointGroupsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

knowledgePointGroupsRouter.get("/", async (c) => {
  const { groups, ungroupedCount } = await listGroups(c.env.DB, c.get("user").id, { limit: UNPAGINATED_LIMIT, offset: 0 });
  return c.json({ groups, ungroupedCount });
});

knowledgePointGroupsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = await createGroup(c.env.DB, { userId: c.get("user").id, name: (body as { name?: unknown } | null)?.name });
  if (!result.ok) {
    return c.json({ error: result.reason === "duplicate" ? "A group with that name already exists" : "A valid group name is required" }, result.reason === "duplicate" ? 409 : 400);
  }
  return c.json({ group: result.group }, 201);
});

knowledgePointGroupsRouter.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = await renameGroup(c.env.DB, { id: c.req.param("id"), userId: c.get("user").id, name: (body as { name?: unknown } | null)?.name });
  if (!result.ok) {
    if (result.reason === "not_found") return c.json({ error: "Group not found" }, 404);
    if (result.reason === "duplicate") return c.json({ error: "A group with that name already exists" }, 409);
    return c.json({ error: "A valid group name is required" }, 400);
  }
  return c.json({ group: result.group });
});

// ON DELETE SET NULL on knowledge_points.group_id gives "notes fall back to
// Ungrouped, keeping their relative order" for free — no extra bookkeeping.
knowledgePointGroupsRouter.delete("/:id", async (c) => {
  const deleted = await deleteGroup(c.env.DB, { id: c.req.param("id"), userId: c.get("user").id });
  if (!deleted) return c.json({ error: "Group not found" }, 404);
  return c.body(null, 204);
});
