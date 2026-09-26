// implementation — Knowledge Points: personal, concept-level Markdown notes,
// distinct from docs/requirements/review-notes-and-annotations.md `notes` (question-scoped, optionally shared)
// and docs/requirements/review-notes-and-annotations.md `annotations` (span-anchored). Always private to the
// owner. Mounted at /api/knowledge-points.
//
// implementation — the actual create/update/delete/link/tag/reorder logic now
// lives in lib/knowledgePointMutations.ts (and lib/knowledgePointDetail.ts
// for reads), shared with the User MCP adapter, so the two surfaces can
// never drift on ownership/validation/concurrency rules. These handlers are
// thin: parse the request, call the lib function, map its result to the
// same HTTP status/body this route has always returned.

import { Hono } from "hono";
import { KNOWLEDGE_POINT_MAX_BODY_LENGTH, KNOWLEDGE_POINT_MAX_TITLE_LENGTH } from "@prepdeck/shared";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { buildKnowledgePointsListQuery } from "../lib/knowledgePointsQuery";
import { loadDetail, toSummary, LIST_SELECT, type KnowledgePointRow } from "../lib/knowledgePointDetail";
import { createNote, applyNoteUpdate, applyGroupMove, reorderNote, deleteNote, linkQuestion, unlinkQuestion, attachTag, detachTag } from "../lib/knowledgePointMutations";
import { SELECT_ORDER_REVISION_SQL } from "../lib/knowledgePointOrderScopes";
import { scopeKeyFor } from "../lib/knowledgePointOrdering";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_TITLE_LENGTH = KNOWLEDGE_POINT_MAX_TITLE_LENGTH;
const MAX_BODY_LENGTH = KNOWLEDGE_POINT_MAX_BODY_LENGTH;

export const knowledgePointsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

knowledgePointsRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);

  const query = buildKnowledgePointsListQuery(userId, {
    groupId: c.req.query("groupId"),
    ungrouped: c.req.query("ungrouped") === "true",
    tagIds: c.req.query("tagIds")?.split(",") ?? [],
    q: c.req.query("q"),
    sort: c.req.query("sort"),
    linkedQuestionId: c.req.query("linkedQuestionId"),
    examId: c.req.query("examId"),
  });
  if (!query) return c.json({ error: "Invalid groupId/tagIds/sort" }, 400);

  const groupId = c.req.query("ungrouped") === "true" ? null : c.req.query("groupId");
  const statements = [
    c.env.DB.prepare(`${LIST_SELECT} WHERE ${query.where} ORDER BY ${query.orderBy} LIMIT ? OFFSET ?`)
      .bind(...query.binds, limit, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM knowledge_points kp WHERE ${query.where}`)
      .bind(...query.binds),
  ];
  if (groupId !== undefined) statements.push(c.env.DB.prepare(SELECT_ORDER_REVISION_SQL).bind(userId, scopeKeyFor(groupId)));
  // The order token describes the same snapshot as the rendered rows.
  const [page, count, order] = await c.env.DB.batch<Record<string, unknown>>(statements);
  const orderRevision = groupId === undefined ? null : Number(order?.results[0]?.revision ?? 1);
  return c.json({ knowledgePoints: (page!.results as unknown as KnowledgePointRow[]).map(toSummary), total: Number(count!.results[0]?.n ?? 0), limit, offset, orderRevision });
});

knowledgePointsRouter.post("/", async (c) => {
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const groupId = body && typeof body === "object" && "groupId" in body && (body as { groupId?: unknown }).groupId != null
    ? String((body as { groupId?: unknown }).groupId)
    : null;

  const result = await createNote(c.env.DB, { userId, groupId });
  if (!result.ok) return c.json({ error: "Group not found" }, 404);

  const detail = await loadDetail(c.env.DB, result.id, userId);
  return c.json({ knowledgePoint: detail }, 201);
});

knowledgePointsRouter.get("/:id", async (c) => {
  const detail = await loadDetail(c.env.DB, c.req.param("id"), c.get("user").id);
  if (!detail) return c.json({ error: "Knowledge point not found" }, 404);
  return c.json({ knowledgePoint: detail });
});

function validateAutosave(body: unknown): string | null {
  if (!body || typeof body !== "object") return "Invalid JSON body";
  const b = body as Record<string, unknown>;
  if (typeof b.baseRevision !== "number") return "baseRevision is required";
  if (typeof b.title !== "string") return "title is required";
  if (b.title.length > MAX_TITLE_LENGTH) return `title must be ${MAX_TITLE_LENGTH} characters or fewer`;
  if (typeof b.bodyMarkdown !== "string") return "bodyMarkdown is required";
  if (b.bodyMarkdown.length > MAX_BODY_LENGTH) return `bodyMarkdown must be ${MAX_BODY_LENGTH} characters or fewer`;
  return null;
}

knowledgePointsRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;

  const body = await c.req.json().catch(() => null);
  const error = validateAutosave(body);
  if (error) return c.json({ error }, 400);
  const { baseRevision, title, bodyMarkdown } = body as { baseRevision: number; title: string; bodyMarkdown: string };

  const result = await applyNoteUpdate(c.env.DB, { id, userId, baseRevision, title, bodyMarkdown });
  if (!result.ok) {
    if (result.reason === "not_found") return c.json({ error: "Knowledge point not found" }, 404);
    const latest = await loadDetail(c.env.DB, id, userId);
    return c.json({ error: "revision_conflict", latest }, 409);
  }
  return c.json({ knowledgePoint: result.detail });
});

knowledgePointsRouter.patch("/:id/group", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("groupId" in body)) return c.json({ error: "groupId is required" }, 400);
  const groupId = (body as { groupId?: unknown }).groupId == null ? null : String((body as { groupId?: unknown }).groupId);

  const result = await applyGroupMove(c.env.DB, { id, userId, groupId });
  if (!result.ok) {
    return c.json({ error: result.reason === "not_found" ? "Knowledge point not found" : "Group not found" }, 404);
  }
  const detail = await loadDetail(c.env.DB, id, userId);
  return c.json({ knowledgePoint: detail });
});

knowledgePointsRouter.patch("/:id/reorder", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("beforeId" in body)) return c.json({ error: "beforeId is required" }, 400);
  const beforeId = (body as { beforeId?: unknown }).beforeId == null ? null : String((body as { beforeId?: unknown }).beforeId);

  // COMPATIBILITY WINDOW — make this required in the release after the one
  // that ships it, then delete this comment and the `undefined` branch.
  //
  // The order token is new in this release, so any browser tab still running
  // the previous bundle sends no `expectedOrderRevision`. Rejecting those
  // would hard-break every drag in an already-open tab for as long as it
  // stays open — a worse outcome than the stale-render race the token exists
  // to close, which is merely the behaviour those tabs have today anyway.
  // Omitting it is treated as "no claim about what I was looking at", not as
  // "skip the concurrency check": reorderNote substitutes the scope's current
  // revision, so the write stays atomic either way.
  const raw = (body as { expectedOrderRevision?: unknown }).expectedOrderRevision;
  if (raw !== undefined && (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1)) {
    return c.json({ error: "expectedOrderRevision must be a positive integer; reload the list before reordering" }, 400);
  }
  const expectedOrderRevision = raw as number | undefined;
  const result = await reorderNote(c.env.DB, { id, userId, beforeId, expectedOrderRevision });
  if (!result.ok) {
    if (result.reason === "not_found") return c.json({ error: "Knowledge point not found" }, 404);
    if (result.reason === "before_not_found") return c.json({ error: "beforeId not found" }, 404);
    if (result.reason === "cross_group") return c.json({ error: "beforeId must be in the same group" }, 400);
    if (result.reason === "conflict") return c.json({ error: "order_conflict" }, 409);
    return c.json({ error: "Unable to reorder" }, 500);
  }
  return c.json({ position: result.position });
});

knowledgePointsRouter.post("/:id/questions", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  const questionId = body && typeof (body as { questionId?: unknown }).questionId === "string" ? (body as { questionId: string }).questionId : null;
  if (!questionId) return c.json({ error: "questionId is required" }, 400);

  const result = await linkQuestion(c.env.DB, { id, userId, questionId });
  if (!result.ok) {
    return c.json({ error: result.reason === "kp_not_found" ? "Knowledge point not found" : "Question not found" }, 404);
  }
  const detail = await loadDetail(c.env.DB, id, userId);
  return c.json({ knowledgePoint: detail }, 201);
});

// Returns the updated note, like its POST counterpart above: a 204 forced the
// editor to re-fetch the detail it needs to re-render, so a single unlink cost
// two round trips and left the removed chip on screen for both of them.
knowledgePointsRouter.delete("/:id/questions/:questionId", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const result = await unlinkQuestion(c.env.DB, { id, userId, questionId: c.req.param("questionId") });
  if (!result.ok) {
    return c.json({ error: result.reason === "kp_not_found" ? "Knowledge point not found" : "Link not found" }, 404);
  }
  return c.json({ knowledgePoint: await loadDetail(c.env.DB, id, userId) });
});

knowledgePointsRouter.post("/:id/tags", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  const name = (body as { name?: unknown } | null)?.name;

  const result = await attachTag(c.env.DB, { id, userId, name });
  if (!result.ok) {
    if (result.reason === "kp_not_found") return c.json({ error: "Knowledge point not found" }, 404);
    return c.json({ error: "A valid tag name is required" }, 400);
  }
  const detail = await loadDetail(c.env.DB, id, userId);
  return c.json({ knowledgePoint: detail }, 201);
});

knowledgePointsRouter.delete("/:id/tags/:tagId", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const result = await detachTag(c.env.DB, { id, userId, tagId: c.req.param("tagId") });
  if (!result.ok) {
    return c.json({ error: result.reason === "kp_not_found" ? "Knowledge point not found" : "Link not found" }, 404);
  }
  return c.json({ knowledgePoint: await loadDetail(c.env.DB, id, userId) });
});

knowledgePointsRouter.delete("/:id", async (c) => {
  const deleted = await deleteNote(c.env.DB, c.env.BUCKET, { id: c.req.param("id"), userId: c.get("user").id });
  if (!deleted) return c.json({ error: "Knowledge point not found" }, 404);
  return c.body(null, 204);
});
