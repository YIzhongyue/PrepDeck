import type { Exam } from "@prepdeck/shared";

// Types and formatting shared by the admin console's panels (screens/Admin.tsx).

export type Tab = "overview" | "users" | "exams" | "mcp" | "appearance";

export interface ExamRow extends Exam {
  questionCount: number;
}

export const DANGER = "var(--color-danger, #c0392b)";

// "1 exam", "2 exams": every count the console prints goes through this.
export function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}

export function initials(source: string): string {
  const cleaned = source.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("");
  return (cleaned || source.slice(0, 2)).toUpperCase();
}
