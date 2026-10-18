// implementation — the Statistics screen's study plan: the exam date it counts
// down to and the weekly study-time goal it measures against. Both are per
// user AND per exam (migration 0031), and both are genuinely optional: a
// missing value renders as a prompt to set one, never as an invented date or
// an assumed goal.
//
// Deliberately not folded into routes/settings.ts, which owns account-wide
// preferences (theme, shared notes) with no exam scope.

import type { Env } from "../bindings";
import { createRouter } from "../context";
import type { ExamStudyPreferencesResponse } from "@prepdeck/shared";
import { updateExamStudyPreferencesRequestSchema } from "@prepdeck/shared/schemas";
import { readBody } from "../lib/requestBody";

interface PreferencesRow {
  target_date: string | null;
  weekly_goal_minutes: number | null;
}

// Mounted at /api/exams/:examId/preferences
export const examPreferencesRouter = createRouter();

async function readRow(c: { env: Env }, userId: string, examId: string): Promise<PreferencesRow | null> {
  return await c.env.DB.prepare(
    "SELECT target_date, weekly_goal_minutes FROM user_exam_preferences WHERE user_id = ? AND exam_id = ?"
  )
    .bind(userId, examId)
    .first<PreferencesRow>();
}

examPreferencesRouter.get("/", async (c) => {
  const examId = c.req.param("examId")!;
  const userId = c.get("user").id;

  const exam = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(examId).first<{ id: string }>();
  if (!exam) return c.json({ error: "Exam not found" }, 404);

  const row = await readRow(c, userId, examId);
  const response: ExamStudyPreferencesResponse = {
    examId,
    targetDate: row?.target_date ?? null,
    weeklyGoalMinutes: row?.weekly_goal_minutes ?? null,
  };
  return c.json(response);
});

examPreferencesRouter.patch("/", async (c) => {
  const examId = c.req.param("examId")!;
  const userId = c.get("user").id;

  const exam = await c.env.DB.prepare("SELECT id FROM exams WHERE id = ?").bind(examId).first<{ id: string }>();
  if (!exam) return c.json({ error: "Exam not found" }, 404);

  const parsed = await readBody(c, updateExamStudyPreferencesRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // `undefined` (field omitted) and `null` (clear this value) are different
  // requests, so the two are kept apart rather than collapsed by `??`.
  const current = await readRow(c, userId, examId);
  const targetDate = body.targetDate !== undefined ? body.targetDate : (current?.target_date ?? null);
  const weeklyGoalMinutes = body.weeklyGoalMinutes !== undefined ? body.weeklyGoalMinutes : (current?.weekly_goal_minutes ?? null);
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO user_exam_preferences (user_id, exam_id, target_date, weekly_goal_minutes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, exam_id) DO UPDATE SET
       target_date = excluded.target_date,
       weekly_goal_minutes = excluded.weekly_goal_minutes,
       updated_at = excluded.updated_at`
  )
    .bind(userId, examId, targetDate, weeklyGoalMinutes, now, now)
    .run();

  const response: ExamStudyPreferencesResponse = { examId, targetDate, weeklyGoalMinutes };
  return c.json(response);
});
