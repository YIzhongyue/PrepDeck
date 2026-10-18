// Request body for PATCH /api/daily-email-settings. See dailyEmailSettings.ts.

import { z } from "zod";
import { DAILY_EMAIL_MAX_QUESTIONS, DAILY_EMAIL_MIN_QUESTIONS, DAILY_EMAIL_SOURCES } from "./dailyEmailSettings.ts";
import { isValidTimeZone } from "./timeZone.ts";

const QUESTIONS_PER_EMAIL = `questionsPerEmail must be an integer between ${DAILY_EMAIL_MIN_QUESTIONS} and ${DAILY_EMAIL_MAX_QUESTIONS}`;
const SEND_HOUR = "sendHourLocal must be an integer between 0 and 23";
const TIMEZONE = "timezone must be a valid IANA time zone name";
const FIELDS = ["enabled", "questionsPerEmail", "source", "timezone", "sendHourLocal"] as const;

// Partial: Settings PATCHes one or more fields at a time.
export const updateDailyEmailSettingsRequestSchema = z.object({
  enabled: z.boolean("enabled must be a boolean").optional(),
  questionsPerEmail: z.int(QUESTIONS_PER_EMAIL).min(DAILY_EMAIL_MIN_QUESTIONS, QUESTIONS_PER_EMAIL).max(DAILY_EMAIL_MAX_QUESTIONS, QUESTIONS_PER_EMAIL).optional(),
  source: z.enum(DAILY_EMAIL_SOURCES, `source must be one of ${DAILY_EMAIL_SOURCES.join(", ")}`).optional(),
  // The account's time zone (users.timezone, issue #47); writing it here
  // changes it for the statistics too.
  timezone: z.string(TIMEZONE).refine(isValidTimeZone, TIMEZONE).optional(),
  sendHourLocal: z.int(SEND_HOUR).min(0, SEND_HOUR).max(23, SEND_HOUR).optional(),
}, "Invalid JSON body").refine(
  (body) => FIELDS.some((field) => body[field] !== undefined),
  `Provide at least one of ${FIELDS.join(", ")}`,
);
