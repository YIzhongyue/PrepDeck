// docs/requirements/statistics-and-progress.md — Personal Statistics Dashboard.
//
// Query logic lives in lib/learningStats.ts (shared with the User MCP's
// get_learning_stats tool, implementation); this file is just the cached HTTP
// wrapper around it.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { getOrComputeExamStats } from "../lib/statsCache";
import { computeStudyActivity } from "../lib/learningStats";

// Mounted at /api/exams/:examId/stats
export const examStatsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

examStatsRouter.get("/", async (c) => {
  const examId = c.req.param("examId")!;
  const userId = c.get("user").id;

  const response = await getOrComputeExamStats(c.env, userId, examId);
  if (!response) return c.json({ error: "Exam not found" }, 404);
  return c.json(response);
});

// Mounted at /api/stats/activity
export const studyActivityRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

studyActivityRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const examId = c.req.query("examId") ?? null;
  const days = parseInt(c.req.query("days") ?? "84", 10) || 84;

  const response = await computeStudyActivity(c.env.DB, userId, { examId, days });
  return c.json(response);
});
