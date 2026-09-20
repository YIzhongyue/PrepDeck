// implementation — per-user daily question review email settings. Extracted as a
// pure helper so validation is unit testable without a D1 binding; the route
// (routes/dailyEmailSettings.ts) only does DB plumbing.

import { DAILY_EMAIL_MAX_QUESTIONS, DAILY_EMAIL_MIN_QUESTIONS, DAILY_EMAIL_SOURCES } from "@prepdeck/shared";

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// null = valid; otherwise the error message to return as a 400.
export function dailyEmailSettingsValidationError(field: string, value: unknown): string | null {
  if (value === undefined) return null;
  switch (field) {
    case "enabled":
      if (typeof value !== "boolean") return "enabled must be a boolean";
      return null;
    case "questionsPerEmail":
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < DAILY_EMAIL_MIN_QUESTIONS ||
        value > DAILY_EMAIL_MAX_QUESTIONS
      ) {
        return `questionsPerEmail must be an integer between ${DAILY_EMAIL_MIN_QUESTIONS} and ${DAILY_EMAIL_MAX_QUESTIONS}`;
      }
      return null;
    case "source":
      if (typeof value !== "string" || !(DAILY_EMAIL_SOURCES as readonly string[]).includes(value)) {
        return `source must be one of ${DAILY_EMAIL_SOURCES.join(", ")}`;
      }
      return null;
    case "sendHourLocal":
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 23) {
        return "sendHourLocal must be an integer between 0 and 23";
      }
      return null;
    case "timezone":
      if (typeof value !== "string" || value.length === 0 || !isValidTimeZone(value)) {
        return "timezone must be a valid IANA time zone name";
      }
      return null;
    default:
      return null;
  }
}
