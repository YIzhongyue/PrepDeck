// implementation — per-user, per-exam study plan: the exam date the Statistics
// header counts down to, and the weekly study-time goal the Study time card
// measures against. Both are genuinely user-supplied: neither can be derived
// from attempt history, and neither has a defensible default, so a missing
// value renders as "Set exam date" / "Set weekly goal" rather than an
// invented date or an assumed eight-hour week.

export interface ExamStudyPreferencesResponse {
  examId: string;
  /** Exam date as a "YYYY-MM-DD" calendar day, counted down in UTC. */
  targetDate: string | null;
  weeklyGoalMinutes: number | null;
}

// Partial: the two values are edited independently, and `null` is a
// meaningful value (clear the date / clear the goal), so "field omitted" and
// "field set to null" must stay distinguishable.
export interface UpdateExamStudyPreferencesRequest {
  targetDate?: string | null;
  weeklyGoalMinutes?: number | null;
}

export const WEEKLY_GOAL_MIN_MINUTES = 15;
export const WEEKLY_GOAL_MAX_MINUTES = 7 * 24 * 60;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar day: rejects "2026-02-31" as well as "banana". */
export function isValidTargetDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidWeeklyGoalMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value)
    && value >= WEEKLY_GOAL_MIN_MINUTES && value <= WEEKLY_GOAL_MAX_MINUTES;
}
