import { MAX_ATTEMPT_QUESTIONS, mockFormatOptions, requiredCorrectFor, type MockFormatId, type OfficialMockFormat } from "@prepdeck/shared";
import type { ExamSummary } from "../types";

// What "Begin exam" will actually start: the chosen format's length and time
// limit, or the custom values, capped to the bank and to the API's limit.

export interface MockPlan {
  format: MockFormatId;
  /** Questions the format asks for. */
  requested: number;
  /** Questions the attempt will have — fewer when the bank is smaller. */
  questionCount: number;
  timeLimitMinutes: number;
  /** Correct answers needed to pass, or null when the exam has no count-based rule. */
  requiredCorrect: number | null;
}

export function officialFormatOf(exams: readonly ExamSummary[], examId: string | null): OfficialMockFormat | null {
  return exams.find((e) => e.id === examId)?.officialFormat ?? null;
}

/** The format selected when an exam opens: the real test when it is defined. */
export function defaultMockFormat(official: OfficialMockFormat | null): MockFormatId {
  return official ? "full" : "custom";
}

export function mockPlan(s: {
  exams: readonly ExamSummary[];
  examId: string | null;
  catalog: readonly unknown[];
  mockFormat: MockFormatId;
  mockCount: number;
  mockMinutes: number;
}): MockPlan {
  const official = officialFormatOf(s.exams, s.examId);
  const option = mockFormatOptions(official).find((o) => o.id === s.mockFormat);
  const format: MockFormatId = option ? option.id : "custom";
  const requested = option ? option.questionCount : s.mockCount;
  const questionCount = Math.max(0, Math.min(requested, s.catalog.length, MAX_ATTEMPT_QUESTIONS));
  // A fixed format cut short by a small bank keeps its pace rather than its
  // full time limit; custom values are the user's own choice and stay as set.
  const timeLimitMinutes = !option ? s.mockMinutes
    : questionCount < requested ? Math.max(1, Math.ceil((option.timeLimitMinutes * questionCount) / requested))
    : option.timeLimitMinutes;
  return {
    format,
    requested,
    questionCount,
    timeLimitMinutes,
    requiredCorrect: requiredCorrectFor(official, questionCount)
  };
}

// Custom mock bounds. The Worker only requires a positive limit; these are the
// setup screen's own sensible range.
export const MIN_CUSTOM_MINUTES = 5;
export const MAX_CUSTOM_MINUTES = 300;

/**
 * The whole number typed into a setup field, or null when the text is empty,
 * not a plain whole number, or outside [min, max]. Fields validate with this
 * instead of clamping each keystroke, which made values such as 120 impossible
 * to type (1 → 5, 52, 520 → 300).
 */
export function wholeNumberInRange(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= min && n <= max ? n : null;
}
