// Request body for PATCH /api/exams/:examId/preferences. See examPreferences.ts.

import { z } from "zod";
import { isValidTargetDate, WEEKLY_GOAL_MAX_MINUTES, WEEKLY_GOAL_MIN_MINUTES } from "./examPreferences.ts";

const TARGET_DATE = "targetDate must be a calendar date in YYYY-MM-DD form, or null";
const WEEKLY_GOAL = `weeklyGoalMinutes must be a whole number of minutes between ${WEEKLY_GOAL_MIN_MINUTES} and ${WEEKLY_GOAL_MAX_MINUTES}, or null`;

// Partial: the two values are edited independently, and `null` is a
// meaningful value (clear the date / clear the goal), so "field omitted" and
// "field set to null" must stay distinguishable.
export const updateExamStudyPreferencesRequestSchema = z.object({
  targetDate: z.string(TARGET_DATE).refine(isValidTargetDate, TARGET_DATE).nullable().optional(),
  weeklyGoalMinutes: z.int(WEEKLY_GOAL).min(WEEKLY_GOAL_MIN_MINUTES, WEEKLY_GOAL).max(WEEKLY_GOAL_MAX_MINUTES, WEEKLY_GOAL).nullable().optional(),
}, "Invalid JSON body").refine(
  (body) => body.targetDate !== undefined || body.weeklyGoalMinutes !== undefined,
  "Provide targetDate and/or weeklyGoalMinutes",
);
