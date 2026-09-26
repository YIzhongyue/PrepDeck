// docs/requirements/review-notes-and-annotations.md — Annotation & Review (FR-8.1–FR-8.5). Annotations are
// personal, per-user markup (highlight/underline/bold, plus an optional
// short note — FR-8.2) applied to a span of a question's stem, an option's
// text, or its AI explanation. They are never visible to other users
// (FR-8.3) and the client must never render or capture them during live,
// untimed practice or timed mock answering (FR-3.4/FR-8.3) — that gating is
// entirely a front-end concern (see apps/web's `graded`/review-mode checks);
// this router only enforces per-user ownership.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { MAX_ANNOTATION_NOTE_LENGTH, MAX_ANNOTATION_STYLE_LENGTH, type AnnotationTargetType } from "@prepdeck/shared";
import { buildAnnotationsListQuery, toAnnotation, type AnnotationRow } from "../lib/annotationsQuery";

const TARGET_TYPES: AnnotationTargetType[] = ["stem", "option", "ai_explanation"];

function validateCreate(body: any): string | null {
  if (!body || typeof body !== "object") return "Invalid JSON body";
  if (!TARGET_TYPES.includes(body.targetType)) return "targetType must be one of stem, option, ai_explanation";
  if (body.targetType === "option") {
    if (typeof body.targetRef !== "string" || !body.targetRef) return "targetRef is required when targetType is option";
  } else if (body.targetRef != null) {
    return "targetRef must be omitted unless targetType is option";
  }
  if (!Number.isInteger(body.rangeStart) || body.rangeStart < 0) return "rangeStart must be a non-negative integer";
  if (!Number.isInteger(body.rangeEnd) || body.rangeEnd <= body.rangeStart) return "rangeEnd must be an integer greater than rangeStart";
  if (typeof body.style !== "string" || !body.style) return "style is required";
  return lengthProblem(body);
}

// Issue #45: both strings used to be unbounded; an oversized one reached D1
// and came back as an unhandled SQLITE_TOOBIG 500.
function lengthProblem(body: { style?: unknown; note?: unknown }): string | null {
  if (body.note != null && typeof body.note !== "string") return "note must be a string";
  if (typeof body.note === "string" && body.note.length > MAX_ANNOTATION_NOTE_LENGTH) {
    return `note must be ${MAX_ANNOTATION_NOTE_LENGTH.toLocaleString("en")} characters or fewer`;
  }
  if (typeof body.style === "string" && body.style.length > MAX_ANNOTATION_STYLE_LENGTH) {
    return `style must be ${MAX_ANNOTATION_STYLE_LENGTH} characters or fewer`;
  }
  return null;
}

// Mounted at /api/questions/:questionId/annotations — FR-8.1: create an
// annotation while reviewing a question; also lists this user's existing
// annotations for that one question.
export const questionAnnotationsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

questionAnnotationsRouter.get("/", async (c) => {
  const questionId = c.req.param("questionId");
  const userId = c.get("user").id;
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM annotations WHERE user_id = ? AND question_id = ? ORDER BY created_at ASC"
  )
    .bind(userId, questionId)
    .all<AnnotationRow>();
  return c.json({ annotations: (results ?? []).map(toAnnotation) });
});

questionAnnotationsRouter.post("/", async (c) => {
  const questionId = c.req.param("questionId");
  const userId = c.get("user").id;

  const question = await c.env.DB.prepare("SELECT id FROM questions WHERE id = ?").bind(questionId).first();
  if (!question) return c.json({ error: "Question not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const error = validateCreate(body);
  if (error) return c.json({ error }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO annotations (id, user_id, question_id, target_type, target_ref, range_start, range_end, style, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      userId,
      questionId,
      body.targetType,
      body.targetRef ?? null,
      body.rangeStart,
      body.rangeEnd,
      body.style,
      body.note ?? null,
      now,
      now
    )
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM annotations WHERE id = ?").bind(id).first<AnnotationRow>();
  return c.json({ annotation: toAnnotation(row!) }, 201);
});

// Mounted at /api/annotations — FR-8.4: "My Annotations" needs every
// annotation belonging to the current user, across questions; also FR-8.5
// edit/remove by the annotation's own id (question id not needed for that).
export const annotationsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// implementation: optional ?markType=hl1,hl2&sort=asc|desc for the "My
// Annotations" filter/sort UI. Omitting both reproduces the original
// unfiltered, created_at ASC behavior exactly (see buildAnnotationsListQuery).
annotationsRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const built = buildAnnotationsListQuery(userId, c.req.query("markType"), c.req.query("sort"), c.req.query("examId"));
  if (!built) {
    return c.json({ error: "markType must be a comma-separated list of hl1, hl2, hl3; sort must be asc or desc" }, 400);
  }
  const { results } = await c.env.DB.prepare(built.sql)
    .bind(...built.binds)
    .all<AnnotationRow>();
  return c.json({ annotations: (results ?? []).map(toAnnotation) });
});

annotationsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;

  const existing = await c.env.DB.prepare("SELECT * FROM annotations WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<AnnotationRow>();
  if (!existing) return c.json({ error: "Annotation not found" }, 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "Invalid JSON body" }, 400);
  if (body.style != null && (typeof body.style !== "string" || !body.style)) {
    return c.json({ error: "style must be a non-empty string" }, 400);
  }
  const tooLong = lengthProblem(body);
  if (tooLong) return c.json({ error: tooLong }, 400);

  const style = body.style ?? existing.style;
  const note = body.note !== undefined ? body.note : existing.note;
  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE annotations SET style = ?, note = ?, updated_at = ? WHERE id = ?")
    .bind(style, note, now, id)
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM annotations WHERE id = ?").bind(id).first<AnnotationRow>();
  return c.json({ annotation: toAnnotation(row!) });
});

annotationsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const result = await c.env.DB.prepare("DELETE FROM annotations WHERE id = ? AND user_id = ?").bind(id, userId).run();
  if (result.meta.changes === 0) return c.json({ error: "Annotation not found" }, 404);
  return c.body(null, 204);
});
