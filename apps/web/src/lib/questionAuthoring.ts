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
    explanation: form.explanation || null, difficulty: form.difficulty || null,
    // The API removes one leading # from input; escape it in canonical chip names.
    tags: form.tags.map(tag => tag.startsWith("#") ? `#${tag}` : tag), points: form.points.trim() ? Number(form.points) : NaN };
}
// App navigation and editor dismissal use the same cancellation boundary.
export function allowAuthoringNavigation() {
  return window.dispatchEvent(new Event("prepdeck:before-navigate", { cancelable: true }));
}
export function questionBankChanged() { window.dispatchEvent(new Event("prepdeck:question-bank-changed")); }
