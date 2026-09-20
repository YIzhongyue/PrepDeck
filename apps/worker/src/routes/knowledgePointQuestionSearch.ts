// implementation — "Link a question" search for Knowledge Points. Unlike
// routes/questions.ts (Admin-only, returns the full answer key), this must
// be usable by any authenticated user, so it deliberately selects only
// id/exam/stem fields — never options_json/correct_answers_json. Mounted at
// /api/knowledge-points/linkable-questions (registered before the KP CRUD
// router's own "/:id" in index.ts so this static path is never captured as
// a knowledge point id).

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const STEM_EXCERPT_LENGTH = 160;

interface QuestionSearchRow {
  id: string;
  exam_id: string;
  exam_slug: string;
  exam_name: string;
  external_id: string | null;
  stem: string;
}

function excerptOf(stem: string, max = STEM_EXCERPT_LENGTH): string {
  const flat = stem.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

export const knowledgePointQuestionSearchRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

knowledgePointQuestionSearchRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const examId = c.req.query("examId");
  const q = c.req.query("q")?.trim();
  const knowledgePointId = c.req.query("knowledgePointId");

  if (knowledgePointId) {
    const kp = await c.env.DB.prepare("SELECT id FROM knowledge_points WHERE id = ? AND user_id = ?")
      .bind(knowledgePointId, userId)
      .first();
    if (!kp) return c.json({ error: "Knowledge point not found" }, 404);
  }

  const conditions = ["e.archived_at IS NULL"];
  const params: unknown[] = [];
  if (examId) {
    conditions.push("q.exam_id = ?");
    params.push(examId);
  }
  if (q) {
    conditions.push("(q.stem LIKE ? OR q.external_id LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const where = conditions.join(" AND ");

  const [{ results }, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT q.id, q.exam_id, e.slug AS exam_slug, e.name AS exam_name, q.external_id, q.stem
       FROM questions q JOIN exams e ON e.id = q.exam_id
       WHERE ${where} ORDER BY q.created_at ASC LIMIT ? OFFSET ?`
    )
      .bind(...params, limit, offset)
      .all<QuestionSearchRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM questions q JOIN exams e ON e.id = q.exam_id WHERE ${where}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);

  let linkedIds = new Set<string>();
  if (knowledgePointId && results?.length) {
    const linked = await c.env.DB.prepare(
      `SELECT question_id FROM knowledge_point_question_links WHERE knowledge_point_id = ? AND question_id IN (${results
        .map(() => "?")
        .join(",")})`
    )
      .bind(knowledgePointId, ...results.map((r) => r.id))
      .all<{ question_id: string }>();
    linkedIds = new Set((linked.results ?? []).map((r) => r.question_id));
  }

  const questions = (results ?? []).map((r) => ({
    questionId: r.id,
    examId: r.exam_id,
    examSlug: r.exam_slug,
    examName: r.exam_name,
    externalId: r.external_id,
    stemExcerpt: excerptOf(r.stem),
    linked: linkedIds.has(r.id),
  }));

  return c.json({ questions, total: total?.n ?? 0, limit, offset });
});
