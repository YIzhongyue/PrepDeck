// docs/requirements/question-bank-management.md — Exam management (FR-2.1): create, rename, and archive an Exam.
// Listing is available to any authenticated user (needed to pick an exam for
// practice, per FR-3.1); mutations are Admin-only.

import { createRouter } from "../context";
import { requireAdmin } from "../middleware/admin";
import { createExamRequestSchema, importExamBadgeRequestSchema, updateExamRequestSchema } from "@prepdeck/shared/schemas";
import {
  getExam, listExams,
  createExamStatement, updateExamStatement, archiveExamStatement, unarchiveExamStatement,
} from "../lib/examManagement";
import { readBody } from "../lib/requestBody";
import { jsonBodyLimit } from "../lib/bodyLimit";
import { streamBodyLimit } from "../lib/streamBodyLimit";
import {
  examBadgeObjectKey, getBadgeTarget, importExamBadge, isApprovedBadgeSource, isBadgeContentType,
  MAX_EXAM_BADGE_BYTES, resolveBadgeSource, storeExamBadge,
} from "../lib/examBadges";

export const examsRouter = createRouter();

examsRouter.get("/", async (c) => {
  const includeArchived = c.req.query("includeArchived") === "true" && c.get("user").role === "admin";
  // The admin console's includeArchived view also shows archived provider links.
  return c.json({ exams: await listExams(c.env.DB, { includeArchived, includeArchivedProviders: includeArchived }) });
});

examsRouter.get("/:id", async (c) => {
  const includeArchivedProviders = c.req.query("includeArchived") === "true" && c.get("user").role === "admin";
  const exam = await getExam(c.env.DB, c.req.param("id"), { includeArchivedProviders });
  if (!exam) return c.json({ error: "Exam not found" }, 404);
  return c.json({ exam });
});

examsRouter.post("/", requireAdmin, jsonBodyLimit, async (c) => {
  const parsed = await readBody(c, createExamRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (body.badgeSource && !isApprovedBadgeSource(body.badgeSource, c.env)) {
    return c.json({ error: "The badge image host is not approved", code: "source_not_allowed" }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await createExamStatement(c.env.DB, id, body, now).run();
  } catch {
    return c.json({ error: "An exam with this slug already exists" }, 409);
  }

  const badgeImport = body.importBadge === false ? undefined : await importExamBadge(c.env, id);
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
        officialFormat: body.officialFormat ?? null,
        badgeIconUrl: badgeImport && "badgeIconUrl" in badgeImport ? badgeImport.badgeIconUrl : null,
        questionCount: 0,
        providers: [],
      },
      badgeImport,
    },
    201
  );
});

examsRouter.patch("/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const parsed = await readBody(c, updateExamRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const existing = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(id).first();
  if (!existing) return c.json({ error: "Exam not found" }, 404);

  const statement = updateExamStatement(c.env.DB, id, body);
  if (!statement) return c.json({ error: "No fields to update" }, 400);

  try {
    await statement.run();
  } catch {
    return c.json({ error: "An exam with this slug already exists" }, 409);
  }

  return c.json({ exam: await getExam(c.env.DB, id, { includeArchivedProviders: true }) });
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

examsRouter.get("/:id/badge-source", requireAdmin, async (c) => {
  const target = await getBadgeTarget(c.env.DB, c.req.param("id"));
  return target ? c.json({ source: resolveBadgeSource(target) }) : c.json({ error: "Exam not found" }, 404);
});

examsRouter.post("/:id/badge/import", requireAdmin, jsonBodyLimit, async (c) => {
  const parsed = await readBody(c, importExamBadgeRequestSchema);
  if (!parsed.ok) return parsed.response;
  return c.json({ badgeImport: await importExamBadge(c.env, c.req.param("id"), parsed.data) });
});

// Admin-only badge upload. R2 stays private, so the stored database URL points
// to the authenticated streaming route below rather than directly to a bucket.
examsRouter.post("/:id/badge", requireAdmin, streamBodyLimit(MAX_EXAM_BADGE_BYTES, "Badge icon must be 2 MB or smaller"), async (c) => {
  const id = c.req.param("id");
  const contentType = c.req.header("Content-Type") ?? "";
  if (!isBadgeContentType(contentType)) {
    return c.json({ error: "Badge icon must be a JPEG, PNG, or WebP image" }, 400);
  }

  const target = await getBadgeTarget(c.env.DB, id);
  if (!target) return c.json({ error: "Exam not found" }, 404);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "Empty upload" }, 400);
  const badgeIconUrl = await storeExamBadge(c.env, id, target.badge_icon_url, body, contentType);
  return badgeIconUrl ? c.json({ badgeIconUrl }) : c.json({ error: "The badge changed. Reload the exam and try again." }, 409);
});

export const examBadgesRouter = createRouter();

examBadgesRouter.get("/:examId", async (c) => {
  const object = await c.env.BUCKET.get(examBadgeObjectKey(c.req.param("examId"), c.req.query("v")));
  if (!object) return c.json({ error: "Not found" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
