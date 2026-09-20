// implementation — the Statistics screen's study plan: the exam date it counts
// down to and the weekly study-time goal it measures against. Both are per
// user AND per exam (migration 0031), and both are genuinely optional: a
// missing value renders as a prompt to set one, never as an invented date or
// an assumed goal.
//
// Deliberately not folded into routes/settings.ts, which owns account-wide
// preferences (theme, shared notes) with no exam scope.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import type { ExamStudyPreferencesResponse } from "@prepdeck/shared";
import { isValidTargetDate, isValidWeeklyGoalMinutes, WEEKLY_GOAL_MAX_MINUTES, WEEKLY_GOAL_MIN_MINUTES } from "@prepdeck/shared";

interface PreferencesRow {
  target_date: string | null;
  weekly_goal_minutes: number | null;
}

// Mounted at /api/exams/:examId/preferences
export const examPreferencesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

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

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "Invalid JSON body" }, 400);

  // `undefined` (field omitted) and `null` (clear this value) are different
  // requests, so the two are kept apart rather than collapsed by `??`.
  const hasTargetDate = body.targetDate !== undefined;
  const hasWeeklyGoal = body.weeklyGoalMinutes !== undefined;
  if (!hasTargetDate && !hasWeeklyGoal) {
    return c.json({ error: "Provide targetDate and/or weeklyGoalMinutes" }, 400);
  }
  if (hasTargetDate && body.targetDate !== null && !isValidTargetDate(body.targetDate)) {
    return c.json({ error: "targetDate must be a calendar date in YYYY-MM-DD form, or null" }, 400);
  }
  if (hasWeeklyGoal && body.weeklyGoalMinutes !== null && !isValidWeeklyGoalMinutes(body.weeklyGoalMinutes)) {
    return c.json(
      { error: `weeklyGoalMinutes must be a whole number of minutes between ${WEEKLY_GOAL_MIN_MINUTES} and ${WEEKLY_GOAL_MAX_MINUTES}, or null` },
      400,
    );
  }

  const current = await readRow(c, userId, examId);
  const targetDate = hasTargetDate ? (body.targetDate as string | null) : (current?.target_date ?? null);
  const weeklyGoalMinutes = hasWeeklyGoal ? (body.weeklyGoalMinutes as number | null) : (current?.weekly_goal_minutes ?? null);
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
