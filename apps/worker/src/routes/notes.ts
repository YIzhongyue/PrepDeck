// docs/requirements/review-notes-and-annotations.md — Question Notes (Personal & Shared) (FR-11.1–FR-11.8).
// Distinct from Annotations (docs/requirements/review-notes-and-annotations.md): a Note is a freestanding,
// whole-question free-text note, not tied to a text span, and — unlike an
// Annotation, which is always private — may be marked `shared` so other
// users can see it (subject to FR-11.4/FR-11.5). Like Annotations, Notes are
// never rendered during live, untimed practice or timed mock answering
// (FR-11.6); that gating is a front-end concern.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import type { NoteVisibility, NoteWithAuthor } from "@prepdeck/shared";

interface NoteRow {
  id: string;
  user_id: string;
  question_id: string;
  content: string;
  visibility: string;
  created_at: string;
  updated_at: string;
  display_name: string | null;
  avatar_url: string | null;
}

function toNote(row: NoteRow, viewerId: string): NoteWithAuthor {
  return {
    id: row.id,
    userId: row.user_id,
    questionId: row.question_id,
    content: row.content,
    visibility: row.visibility as NoteVisibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: { id: row.user_id, displayName: row.display_name, avatarUrl: row.avatar_url },
    isMine: row.user_id === viewerId,
  };
}

// A note is visible to `viewerId` when: it's their own (private or shared —
// FR-11.4 only affects *other* users' notes), or it's `shared` and the
// viewer's own "show other users' shared notes" toggle is on (FR-11.4). A
// `private` note belonging to someone else is never visible (FR-11.5).
const VISIBLE_TO_CLAUSE = `(n.user_id = ? OR (n.visibility = 'shared' AND (SELECT show_shared_notes FROM users WHERE id = ?) = 1))`;

const SELECT_NOTE = `SELECT n.*, u.display_name, u.avatar_url FROM notes n JOIN users u ON u.id = n.user_id`;

function validateCreate(body: any): string | null {
  if (!body || typeof body !== "object") return "Invalid JSON body";
  if (typeof body.content !== "string" || !body.content.trim()) return "content is required";
  if (body.visibility !== "private" && body.visibility !== "shared") return "visibility must be private or shared";
  return null;
}

// Mounted at /api/questions/:questionId/notes — FR-11.1: add a note to a
// question; also lists the notes visible to this user for that one question.
export const questionNotesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

questionNotesRouter.get("/", async (c) => {
  const questionId = c.req.param("questionId");
  const userId = c.get("user").id;
  const { results } = await c.env.DB.prepare(
    `${SELECT_NOTE} WHERE n.question_id = ? AND ${VISIBLE_TO_CLAUSE} ORDER BY n.created_at ASC`
  )
    .bind(questionId, userId, userId)
    .all<NoteRow>();
  return c.json({ notes: (results ?? []).map((r) => toNote(r, userId)) });
});

questionNotesRouter.post("/", async (c) => {
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
    `INSERT INTO notes (id, user_id, question_id, content, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, questionId, body.content.trim(), body.visibility, now, now)
    .run();

  const row = await c.env.DB.prepare(`${SELECT_NOTE} WHERE n.id = ?`).bind(id).first<NoteRow>();
  return c.json({ note: toNote(row!, userId) }, 201);
});

// Mounted at /api/notes — bulk fetch of every note visible to this user
// (own + visible shared, across questions), and edit/delete by note id
// (FR-11.3/FR-11.8), independent of question id.
export const notesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

notesRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const examId = c.req.query("examId");
  const scope = examId === undefined ? "" : " AND n.question_id IN (SELECT id FROM questions WHERE exam_id = ?)";
  const binds = examId === undefined ? [userId, userId] : [userId, userId, examId];
  const { results } = await c.env.DB.prepare(`${SELECT_NOTE} WHERE ${VISIBLE_TO_CLAUSE}${scope} ORDER BY n.created_at ASC`)
    .bind(...binds)
    .all<NoteRow>();
  return c.json({ notes: (results ?? []).map((r) => toNote(r, userId)) });
});

notesRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;

  // FR-11.3: only the author may edit — not even Admin (FR-11.8 grants Admin
  // deletion of shared notes only, not editing).
  const existing = await c.env.DB.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<NoteRow>();
  if (!existing) return c.json({ error: "Note not found" }, 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "Invalid JSON body" }, 400);
  if (body.content != null && (typeof body.content !== "string" || !body.content.trim())) {
    return c.json({ error: "content must be a non-empty string" }, 400);
  }
  if (body.visibility != null && body.visibility !== "private" && body.visibility !== "shared") {
    return c.json({ error: "visibility must be private or shared" }, 400);
  }

  const content = body.content !== undefined ? body.content.trim() : existing.content;
  const visibility = body.visibility ?? existing.visibility;
  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE notes SET content = ?, visibility = ?, updated_at = ? WHERE id = ?")
    .bind(content, visibility, now, id)
    .run();

  const row = await c.env.DB.prepare(`${SELECT_NOTE} WHERE n.id = ?`).bind(id).first<NoteRow>();
  return c.json({ note: toNote(row!, userId) });
});

notesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const existing = await c.env.DB.prepare("SELECT * FROM notes WHERE id = ?").bind(id).first<NoteRow>();
  if (!existing) return c.json({ error: "Note not found" }, 404);

  // FR-11.3: the author can always delete their own note. FR-11.8 (light-touch
  // moderation): Admin may additionally delete any `shared` note, but never
  // another user's `private` note.
  const isOwner = existing.user_id === user.id;
  const isAdminModeratingShared = user.role === "admin" && existing.visibility === "shared";
  if (!isOwner && !isAdminModeratingShared) return c.json({ error: "Forbidden" }, 403);

  await c.env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});
