// An exam's official mock format — the real test's length, time limit and the
// number of correct answers it takes to pass — and everything derived from it:
// the formats Mock setup offers, and whether a finished mock passed.
//
// Admins set the format per exam. When it is set it is the pass rule for every
// mock of that exam, scaled to the mock's length: a half-length mock needs half
// as many correct answers, rounded up. Exams without it keep the older
// percentage rule (`passMarkPct`), and exams with neither have no pass mark.

import { MAX_ATTEMPT_QUESTIONS } from "./attempts.ts";

export interface OfficialMockFormat {
  questionCount: number;
  timeLimitMinutes: number;
  passCorrectCount: number;
}

export interface ExamPassRule {
  passMarkPct: number | null;
  officialFormat: OfficialMockFormat | null;
}

export const MAX_MOCK_MINUTES = 600;

/** Admin input check; returns a message for the first problem, or null. */
export function officialFormatError(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "object") return "officialFormat must be an object or null";
  const v = value as Partial<Record<keyof OfficialMockFormat, unknown>>;
  const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
  if (!isInt(v.questionCount) || v.questionCount < 1 || v.questionCount > MAX_ATTEMPT_QUESTIONS) {
    return `officialFormat.questionCount must be a whole number from 1 to ${MAX_ATTEMPT_QUESTIONS}`;
  }
  if (!isInt(v.timeLimitMinutes) || v.timeLimitMinutes < 1 || v.timeLimitMinutes > MAX_MOCK_MINUTES) {
    return `officialFormat.timeLimitMinutes must be a whole number from 1 to ${MAX_MOCK_MINUTES}`;
  }
  if (!isInt(v.passCorrectCount) || v.passCorrectCount < 1 || v.passCorrectCount > v.questionCount) {
    return "officialFormat.passCorrectCount must be a whole number from 1 to questionCount";
  }
  return null;
}

/** Correct answers needed to pass a mock of `totalQuestions`, or null without a count-based rule. */
export function requiredCorrectFor(format: OfficialMockFormat | null, totalQuestions: number): number | null {
  if (!format || totalQuestions <= 0) return null;
  // The epsilon keeps exact ratios (38 of 76 → 19) from rounding up on float noise.
  return Math.min(totalQuestions, Math.max(1, Math.ceil((format.passCorrectCount * totalQuestions) / format.questionCount - 1e-9)));
}

export function isMockPassed(rule: ExamPassRule, result: { correctCount: number; totalQuestions: number; score: number }): boolean | null {
  const required = requiredCorrectFor(rule.officialFormat, result.totalQuestions);
  if (required != null) return result.correctCount >= required;
  return rule.passMarkPct != null ? result.score >= rule.passMarkPct : null;
}

/** The pass line Statistics draws: the official ratio when set, else the percentage rule. */
export function effectivePassMarkPct(rule: ExamPassRule): number | null {
  const f = rule.officialFormat;
  if (f) return Math.round((100 * f.passCorrectCount) / f.questionCount);
  return rule.passMarkPct;
}

export type MockFormatId = "full" | "half" | "sprint" | "custom";

export interface MockFormatOption {
  id: Exclude<MockFormatId, "custom">;
  label: string;
  questionCount: number;
  timeLimitMinutes: number;
}

const SPRINT_QUESTIONS = 20;
const roundTo5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

/**
 * The fixed formats Mock setup offers. Full and half length exist only when
 * the exam has an official format; sprint keeps the official pace when there
 * is one, and a default pace of 1.5 min / question otherwise.
 */
export function mockFormatOptions(format: OfficialMockFormat | null): MockFormatOption[] {
  if (!format) return [{ id: "sprint", label: "Sprint", questionCount: SPRINT_QUESTIONS, timeLimitMinutes: 30 }];
  const options: MockFormatOption[] = [{ id: "full", label: "Full exam", questionCount: format.questionCount, timeLimitMinutes: format.timeLimitMinutes }];
  const pace = format.timeLimitMinutes / format.questionCount;
  if (format.questionCount >= 4) {
    const n = Math.ceil(format.questionCount / 2);
    options.push({ id: "half", label: "Half length", questionCount: n, timeLimitMinutes: roundTo5(pace * n) });
  }
  if (format.questionCount > SPRINT_QUESTIONS * 2) {
    options.push({ id: "sprint", label: "Sprint", questionCount: SPRINT_QUESTIONS, timeLimitMinutes: roundTo5(pace * SPRINT_QUESTIONS) });
  }
  return options;
}
