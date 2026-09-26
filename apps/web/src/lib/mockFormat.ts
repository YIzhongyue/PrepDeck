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
