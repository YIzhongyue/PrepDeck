// docs/requirements/question-bank-management.md (FR-13.4) — a lightweight usage overview for the /admin
// landing page: at-a-glance counts, read live from D1 at request time. No
// new table; this is a convenience view, not an analytics/reporting feature.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAdmin } from "../middleware/admin";
import type { AdminOverviewResponse } from "@prepdeck/shared";

export const adminOverviewRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

adminOverviewRouter.use("*", requireAdmin);

adminOverviewRouter.get("/", async (c) => {
  const [usersByStatus, examCounts, questionsByExam, attemptsTotal] = await Promise.all([
    c.env.DB.prepare("SELECT status, COUNT(*) AS n FROM users GROUP BY status").all<{ status: string; n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived FROM exams"
    ).first<{ total: number; archived: number | null }>(),
    c.env.DB.prepare(
      `SELECT e.id AS examId, e.name AS examName, COUNT(q.id) AS questionCount
       FROM exams e LEFT JOIN questions q ON q.exam_id = e.id
       GROUP BY e.id ORDER BY e.created_at ASC`
    ).all<{ examId: string; examName: string; questionCount: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM attempts").first<{ n: number }>(),
  ]);

  const byStatus: Record<string, number> = { invited: 0, active: 0, revoked: 0 };
  let usersTotal = 0;
  for (const row of usersByStatus.results ?? []) {
    byStatus[row.status] = row.n;
    usersTotal += row.n;
  }

  const byExam = questionsByExam.results ?? [];
  const response: AdminOverviewResponse = {
    users: { invited: byStatus.invited ?? 0, active: byStatus.active ?? 0, revoked: byStatus.revoked ?? 0, total: usersTotal },
    exams: { total: examCounts?.total ?? 0, archived: examCounts?.archived ?? 0 },
    questions: { total: byExam.reduce((sum, r) => sum + r.questionCount, 0), byExam },
    attempts: { total: attemptsTotal?.n ?? 0 },
  };
  return c.json(response);
});
