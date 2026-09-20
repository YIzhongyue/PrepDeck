// DTOs for the per-user daily question review email (implementation). "source"
// reuses the client's existing PracticeSource vocabulary (PrepDeckContext.tsx)
// rather than inventing a fourth spelling: 'wrong' = Wrong Question Book,
// 'bm' = Bookmarks, 'new' = Unattempted.

export type DailyEmailSource = "wrong" | "bm" | "new";

export const DAILY_EMAIL_SOURCES: readonly DailyEmailSource[] = ["wrong", "bm", "new"];

export const DAILY_EMAIL_MIN_QUESTIONS = 1;
export const DAILY_EMAIL_MAX_QUESTIONS = 5;

export interface DailyEmailSettingsResponse {
  enabled: boolean;
  questionsPerEmail: number;
  source: DailyEmailSource;
  timezone: string;
  sendHourLocal: number;
  unsubscribedAt: string | null;
}

// Partial: Settings PATCHes one or more fields at a time.
export interface UpdateDailyEmailSettingsRequest {
  enabled?: boolean;
  questionsPerEmail?: number;
  source?: DailyEmailSource;
  timezone?: string;
  sendHourLocal?: number;
}
