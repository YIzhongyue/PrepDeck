// Minimal bookmark toggle (FR-6.1) — just enough to back the bookmark button
// already built into PracticeLive. Browsing a "My Bookmarks" page is section
// 3.6 and out of scope here.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";

export const bookmarksRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

bookmarksRouter.put("/", async (c) => {
  const questionId = c.req.param("questionId");
  const userId = c.get("user").id;

  const question = await c.env.DB.prepare("SELECT id FROM questions WHERE id = ?").bind(questionId).first();
  if (!question) return c.json({ error: "Question not found" }, 404);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO bookmarks (user_id, question_id, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id, question_id) DO NOTHING"
  )
    .bind(userId, questionId, now)
    .run();

  return c.json({ bookmarked: true });
});

bookmarksRouter.delete("/", async (c) => {
  const questionId = c.req.param("questionId");
  const userId = c.get("user").id;
  await c.env.DB.prepare("DELETE FROM bookmarks WHERE user_id = ? AND question_id = ?").bind(userId, questionId).run();
  return c.json({ bookmarked: false });
});
