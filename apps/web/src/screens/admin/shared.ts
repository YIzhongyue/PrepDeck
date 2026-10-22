import type { Exam } from "@prepdeck/shared";
import { t } from "../../i18n/runtime";

// Types and formatting shared by the admin console's panels (screens/Admin.tsx).

export type Tab = "overview" | "users" | "exams" | "mcp" | "appearance";

export interface ExamRow extends Exam {
  questionCount: number;
}

export const DANGER = "var(--color-danger, #c0392b)";

// "1 exam", "2 exams": every count the console prints goes through this.
export function countOf(n: number, noun: "exam" | "question"): string {
  return t(noun === "exam" ? "admin.count.exams" : "admin.count.questions", { count: n });
}

export function initials(source: string): string {
  const cleaned = source.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("");
  return (cleaned || source.slice(0, 2)).toUpperCase();
}
