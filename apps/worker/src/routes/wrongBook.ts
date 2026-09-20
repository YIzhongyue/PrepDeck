// FR-5.3 — mark a Wrong Question Book entry "mastered," removing it from the
// active view (practice-catalog's wrongEntries) until/unless the user misses
// it again, which un-masters it (see wrongBookUpsert in routes/attempts.ts).

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";

export const wrongBookMasteredRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

wrongBookMasteredRouter.put("/", async (c) => {
  const questionId = c.req.param("questionId");
  const userId = c.get("user").id;

  const result = await c.env.DB.prepare(
    "UPDATE wrong_question_book SET mastered = 1 WHERE user_id = ? AND question_id = ?"
  )
    .bind(userId, questionId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: "This question is not in your wrong question book" }, 404);
  }
  return c.json({ mastered: true });
});
