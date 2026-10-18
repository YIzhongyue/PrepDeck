// docs/requirements/review-notes-and-annotations.md — Annotation & Review (FR-8.1–FR-8.5). Annotations are
// personal, per-user markup (highlight/underline/bold, plus an optional
// short note — FR-8.2) applied to a span of a question's stem, an option's
// text, or its AI explanation. They are never visible to other users
// (FR-8.3) and the client must never render or capture them during live,
// untimed practice or timed mock answering (FR-3.4/FR-8.3) — that gating is
// entirely a front-end concern (see apps/web's `graded`/review-mode checks);
// this router only enforces per-user ownership.

import { createRouter } from "../context";
import { createAnnotationRequestSchema, updateAnnotationRequestSchema } from "@prepdeck/shared/schemas";
import { buildAnnotationsListQuery, toAnnotation, type AnnotationRow } from "../lib/annotationsQuery";
import { readBody } from "../lib/requestBody";

// Mounted at /api/questions/:questionId/annotations — FR-8.1: create an
// annotation while reviewing a question; also lists this user's existing
// annotations for that one question.
export const questionAnnotationsRouter = createRouter();

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

  const parsed = await readBody(c, createAnnotationRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

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
export const annotationsRouter = createRouter();

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

  const parsed = await readBody(c, updateAnnotationRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

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
