// docs/requirements/question-bank-management.md — Exam management (FR-2.1): create, rename, and archive an Exam.
// Listing is available to any authenticated user (needed to pick an exam for
// practice, per FR-3.1); mutations are Admin-only.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAdmin } from "../middleware/admin";
import {
  getExam, listExams, EXAM_SLUG_PATTERN,
  createExamStatement, updateExamStatement, archiveExamStatement, unarchiveExamStatement,
  type ExamMutableFields,
} from "../lib/examManagement";

const SLUG_RE = EXAM_SLUG_PATTERN;

export const examsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

examsRouter.get("/", async (c) => {
  const includeArchived = c.req.query("includeArchived") === "true" && c.get("user").role === "admin";
  return c.json({ exams: await listExams(c.env.DB, { includeArchived }) });
});

examsRouter.get("/:id", async (c) => {
  const exam = await getExam(c.env.DB, c.req.param("id"));
  if (!exam) return c.json({ error: "Exam not found" }, 404);
  return c.json({ exam });
});

examsRouter.post("/", requireAdmin, async (c) => {
  const body = await c.req.json<ExamMutableFields>().catch(() => null);
  if (!body || !body.slug || !body.name) {
    return c.json({ error: "slug and name are required" }, 400);
  }
  if (!SLUG_RE.test(body.slug)) {
    return c.json({ error: "slug must be lowercase alphanumeric segments separated by hyphens" }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await createExamStatement(c.env.DB, id, { ...body, slug: body.slug, name: body.name }, now).run();
  } catch {
    return c.json({ error: "An exam with this slug already exists" }, 409);
  }

  return c.json(
    {
      exam: {
        id,
        slug: body.slug,
        name: body.name,
        description: body.description ?? null,
        subject: body.subject ?? null,
        language: body.language ?? null,
        createdAt: now,
        archivedAt: null,
        passMarkPct: body.passMarkPct ?? null,
        badgeIconUrl: null,
        questionCount: 0,
        providers: [],
      },
    },
    201
  );
});

examsRouter.patch("/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<ExamMutableFields>().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);
  if (body.slug !== undefined && !SLUG_RE.test(body.slug)) {
    return c.json({ error: "slug must be lowercase alphanumeric segments separated by hyphens" }, 400);
  }

  const existing = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(id).first();
  if (!existing) return c.json({ error: "Exam not found" }, 404);

  const statement = updateExamStatement(c.env.DB, id, body);
  if (!statement) return c.json({ error: "No fields to update" }, 400);

  try {
    await statement.run();
  } catch {
    return c.json({ error: "An exam with this slug already exists" }, 409);
  }

  return c.json({ exam: await getExam(c.env.DB, id) });
});

examsRouter.post("/:id/archive", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const now = new Date().toISOString();
  const result = await archiveExamStatement(c.env.DB, id, now).run();
  if (result.meta.changes === 0) {
    const exists = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(id).first();
    return c.json({ error: exists ? "Exam already archived" : "Exam not found" }, exists ? 409 : 404);
  }
  return c.json({ archivedAt: now });
});

examsRouter.post("/:id/unarchive", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const result = await unarchiveExamStatement(c.env.DB, id).run();
  if (result.meta.changes === 0) return c.json({ error: "Exam not found" }, 404);
  return c.json({ archivedAt: null });
});

const MAX_BADGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_BADGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Admin-only badge upload. R2 stays private, so the stored database URL points
// to the authenticated streaming route below rather than directly to a bucket.
examsRouter.post("/:id/badge", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const contentType = c.req.header("Content-Type") ?? "";
  if (!ALLOWED_BADGE_TYPES.has(contentType)) {
    return c.json({ error: "Badge icon must be a JPEG, PNG, or WebP image" }, 400);
  }

  const existing = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(id).first();
  if (!existing) return c.json({ error: "Exam not found" }, 404);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "Empty upload" }, 400);
  if (body.byteLength > MAX_BADGE_BYTES) return c.json({ error: "Badge icon must be 2 MB or smaller" }, 413);

  await c.env.BUCKET.put(`exam-badges/${id}`, body, { httpMetadata: { contentType } });
  const badgeIconUrl = `/api/exam-badges/${id}?v=${Date.now()}`;
  await c.env.DB.prepare("UPDATE exams SET badge_icon_url = ? WHERE id = ?").bind(badgeIconUrl, id).run();
  return c.json({ badgeIconUrl });
});

export const examBadgesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

examBadgesRouter.get("/:examId", async (c) => {
  const object = await c.env.BUCKET.get(`exam-badges/${c.req.param("examId")}`);
  if (!object) return c.json({ error: "Not found" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
