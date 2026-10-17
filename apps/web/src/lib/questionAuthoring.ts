import type { Question, QuestionType } from "@prepdeck/shared";

export function blankQuestion(type: QuestionType = "single_choice") {
  return { type, stem: "", externalId: "", options: type === "fill_blank" ? [] : type === "true_false"
    ? [{ id: "true", text: "True" }, { id: "false", text: "False" }] : [{ id: "A", text: "" }, { id: "B", text: "" }],
    correctAnswers: [] as string[], explanation: "", difficulty: "", tags: [] as string[], needsReview: false, points: "1" };
}
export type QuestionForm = ReturnType<typeof blankQuestion>;
export function questionForm(q: Question): QuestionForm {
  return { type: q.type, stem: q.stem, externalId: q.externalId ?? "", options: q.options ?? [],
    correctAnswers: q.correctAnswers, explanation: q.explanation ?? "", difficulty: q.difficulty ?? "",
    tags: [...q.tags], needsReview: q.needsReview, points: String(q.points) };
}
export function formPayload(form: QuestionForm) {
  return { ...form, externalId: form.externalId || undefined, options: form.type === "fill_blank" ? undefined : form.options,
    // "One per line": blank lines are layout, not empty accepted answers.
    correctAnswers: form.type === "fill_blank" ? form.correctAnswers.filter(answer => answer.trim()) : form.correctAnswers,
    explanation: form.explanation || null, difficulty: form.difficulty || null,
    // The API removes one leading # from input; escape it in canonical chip names.
    tags: form.tags.map(tag => tag.startsWith("#") ? `#${tag}` : tag), points: form.points.trim() ? Number(form.points) : NaN };
}
export type AuthoringNavigationEvent = CustomEvent<{ waitUntil: (decision: Promise<boolean>) => void }>;
// A dirty editor may need an accessible dialog before navigation can proceed.
// Every registered guard must approve; rejection also keeps the current page.
export async function allowAuthoringNavigation(): Promise<boolean> {
  const decisions: Promise<boolean>[] = [];
  const allowed = window.dispatchEvent(new CustomEvent("prepdeck:before-navigate", {
    cancelable: true, detail: { waitUntil: (decision: Promise<boolean>) => decisions.push(decision) }
  }));
  const results = await Promise.allSettled(decisions);
  return allowed && results.every(result => result.status === "fulfilled" && result.value);
}
export function questionBankChanged() { window.dispatchEvent(new Event("prepdeck:question-bank-changed")); }
// Provider edits change exam grouping and labels, never questions: refresh
// only the exam list instead of reloading the open exam's catalog.
export function examListChanged() { window.dispatchEvent(new Event("prepdeck:exam-list-changed")); }
