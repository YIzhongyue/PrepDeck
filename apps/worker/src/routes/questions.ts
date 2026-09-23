import { exportComponentPackage } from "@prepdeck/shared";
import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { getExam as getExamRecord } from "../lib/examManagement";
import { requireAdmin } from "../middleware/admin";
import { invalidatePracticeQuestions } from "../lib/practiceCache";
import { parseJsonBody } from "../lib/importSecurity";
import { createStatement, getQuestion, searchQuestions, toQuestion, updateStatement, validatePayload } from "../lib/questionManagement";
import { buildTagLinkStatements, fetchTagIdsForQuestion, resolveOrCreateTags } from "../lib/questionBankTags";
import { questionMutationAuditStatement, type QuestionMutationContext } from "../lib/questionMutationAudit";

// Audits that accompany a REJECTED request, written on their own rather than
// inside the mutation's batch. The handler has already decided the response by
// this point, so an audit that cannot be written must not convert a 4xx the
// caller can act on into a 500 it cannot — the rejection itself is the
// user-visible contract, and losing its audit row degrades a record, not the
// outcome. Successful mutations are the opposite case and stay batched with
// the row they describe, where the audit is not allowed to go missing.
function auditRejection(db: D1Database, context: QuestionMutationContext, reason: string): Promise<unknown> {
  return questionMutationAuditStatement(db, context, "failure", reason).run().catch(() => {});
}

export const questionsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();
questionsRouter.use("*", requireAdmin);
questionsRouter.get("/", async c => c.json(await searchQuestions(c.env.DB, c.req.param("examId")!, c.req.query())));
questionsRouter.get("/export", async c => {
  const examId = c.req.param("examId")!;
  const result = await searchQuestions(c.env.DB, examId, c.req.query());
  if (!result.questions.length) return c.json({ error: "No questions in this page" }, 404);
  try {
    const exam = (await getExamRecord(c.env.DB, examId))!;
    const file = exportComponentPackage({ id: examId, name: exam.name }, result.questions.map(q => ({ ...q, externalId: q.externalId ?? undefined, options: q.options ?? undefined })));
    return c.json({ file, total: result.total, offset: result.offset, nextOffset: result.offset + result.questions.length < result.total ? result.offset + result.questions.length : null });
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Cannot export snapshots" }, 409); }
});
questionsRouter.get("/:id", async c => {
  const row = await getQuestion(c.env.DB, c.req.param("examId")!, c.req.param("id"));
  return row ? c.json({ question: toQuestion(row) }) : c.json({ error: "Question not found" }, 404);
});

questionsRouter.on(["POST", "PATCH"], ["/", "/:id"], async c => {
  const creating = c.req.method === "POST";
  if (creating === !!c.req.param("id")) return c.json({ error: "Not found" }, 404);
  const examId = c.req.param("examId")!;
  const audit: QuestionMutationContext = { userId: c.get("user").id, entryPoint: "admin_api", action: creating ? "create" : "update", examId, questionId: c.req.param("id") };
  const exam = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(examId).first();
  if (!exam) return c.json({ error: "Exam not found" }, 404);
  const row = creating ? null : await getQuestion(c.env.DB, examId, c.req.param("id")!);
  if (!creating && !row) return c.json({ error: "Question not found" }, 404);
  const parsed = await parseJsonBody(c.req.raw);
  if (!parsed.ok) {
    await auditRejection(c.env.DB, audit, "invalid_json");
    return c.json({ error: parsed.error }, parsed.status);
  }
  const { payload, issues } = validatePayload(parsed.data, row ? toQuestion(row) : undefined);
  if (issues.length) {
    await auditRejection(c.env.DB, audit, "validation");
    return c.json({ error: "Validation failed", issues }, 422);
  }
  if (row && (parsed.data as Record<string, unknown>).expectedRevision !== row.revision) {
    await auditRejection(c.env.DB, audit, "stale_revision");
    return c.json({ error: "This question has changed. Reopen it and review the latest version before saving.", code: "stale_question", currentRevision: row.revision }, 409);
  }
  const id = row?.id ?? crypto.randomUUID();
  audit.questionId = id;
  const now = new Date().toISOString();
  // Resolved before the write so its statements can commit ATOMICALLY with
  // the row itself (implementation review: question_tag_links is authoritative
  // content now, not a best-effort side effect like cache invalidation).
  // Resolving/creating catalog rows for brand-new tag names is its own,
  // separately-idempotent step — worst case a name that ends up unused
  // (e.g. this write then fails) leaves a harmless zero-reference catalog
  // entry, the same state admin_create_tag already produces deliberately.
  const desiredTagIds = (await resolveOrCreateTags(c.env.DB, payload.tags ?? [], now)).map((t) => t.id);
  const currentTagIds = row ? await fetchTagIdsForQuestion(c.env.DB, row.id) : [];
  const rowStatement = row ? updateStatement(c.env.DB, row, payload, now) : createStatement(c.env.DB, examId, id, payload, now);
  // Guarded on the row's own post-write revision for an update, so a
  // stale-revision write (0 rows changed, not an exception) never still
  // applies a tag-link change alongside it. A create has no revision race
  // to guard against — a fresh id either commits with the whole batch or
  // the batch throws and rolls everything, links included, back together.
  const linkStatements = buildTagLinkStatements(
    c.env.DB, id, desiredTagIds, currentTagIds, row ? { questionId: row.id, revision: row.revision + 1, updatedAt: now } : undefined,
  );
  try {
    const [result] = await c.env.DB.batch([rowStatement, questionMutationAuditStatement(c.env.DB, audit, "conditional"), ...linkStatements]);
    if (!result!.meta.changes) return c.json({ error: "This question changed during saving. Reopen it before retrying.", code: "stale_question" }, 409);
  } catch (error) {
    await auditRejection(c.env.DB, audit, String(error).includes("duplicate external ID") ? "duplicate_external_id" : "write_failed");
    if (String(error).includes("duplicate external ID")) return c.json({ error: "External ID already exists in this exam.", issues: [{ path: "$.externalId", message: "Choose a unique external ID or leave it empty." }] }, 409);
    throw error;
  }
  await invalidatePracticeQuestions(c.env, examId);
  return c.json({ question: toQuestion((await getQuestion(c.env.DB, examId, id))!) }, creating ? 201 : 200);
});

questionsRouter.delete("/:id", async (c) => {
  const examId = c.req.param("examId")!;
  const id = c.req.param("id");
  const audit: QuestionMutationContext = { userId: c.get("user").id, entryPoint: "admin_api", action: "delete", examId, questionId: id };
  try {
    const [result] = await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM questions WHERE id = ? AND exam_id = ?").bind(id, examId),
      questionMutationAuditStatement(c.env.DB, audit, "conditional"),
    ]);
    if (result!.meta.changes === 0) return c.json({ error: "Question not found" }, 404);
  } catch (error) {
    await auditRejection(c.env.DB, audit, /FOREIGN KEY|question referenced by an attempt/i.test(String(error)) ? "dependency_conflict" : "write_failed");
    if (/FOREIGN KEY|question referenced by an attempt/i.test(String(error))) {
      return c.json({ error: "Cannot delete: this question is used by attempts, bookmarks, notes, annotations, or cached explanations. These records are preserved; edit the question instead." }, 409);
    }
    throw error;
  }
  await invalidatePracticeQuestions(c.env, examId);
  return c.body(null, 204);
});
