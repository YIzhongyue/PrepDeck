// Issue #119 — per-user, per-question studied status; precedence rules live
// in lib/studyStatus.ts. Practice and Mock answers mark questions studied on
// the server where they are recorded (lib/attemptMutations.ts and
// routes/attempts.ts), so these routes serve only the Learning screen's
// automatic mark, its manual toggle, and the setup screens' filters.

import { Hono } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import type { LearningViewRequest, SetStudyStatusRequest, StudyStatusListResponse } from "@prepdeck/shared";
import { examExists } from "../lib/examManagement";
import { listStudyStatuses, recordLearningView, setStudyStatus } from "../lib/studyStatus";
import { studyMutationStatus } from "../lib/studyMutationResult";

// Mounted at /api/exams/:examId/study-status
export const studyStatusRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

studyStatusRouter.get("/", async (c) => {
  const examId = c.req.param("examId")!;
  if (!(await examExists(c.env.DB, examId))) return c.json({ error: "Exam not found" }, 404);
  const response: StudyStatusListResponse = { examId, statuses: await listStudyStatuses(c.env.DB, c.get("user").id, examId) };
  return c.json(response);
});

studyStatusRouter.put("/:questionId", async (c) => {
  const body = await c.req.json<SetStudyStatusRequest>().catch(() => null);
  const result = await setStudyStatus(c.env.DB, c.get("user").id, c.req.param("examId")!, c.req.param("questionId"), body);
  return result.ok ? c.json(result.data) : c.json(result.error, studyMutationStatus(result.reason));
});

studyStatusRouter.post("/:questionId/learning-view", async (c) => {
  const body = await c.req.json<LearningViewRequest>().catch(() => null);
  const result = await recordLearningView(c.env.DB, c.get("user").id, c.req.param("examId")!, c.req.param("questionId"), body);
  return result.ok ? c.json(result.data) : c.json(result.error, studyMutationStatus(result.reason));
});
