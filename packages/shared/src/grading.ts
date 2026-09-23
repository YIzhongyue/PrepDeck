// Single source of truth for "is this answer correct", used both by the
// practice per-question grading endpoint and the mock-exam complete endpoint
// (Sections 3.3/3.4). Keeping this in one place matters: grading practice and
// mock exams differently would let a question's correctness depend on which
// mode it was answered in.

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// "Did the user answer this question?" — deliberately NOT `selected.length > 0`.
// A fill-in the user typed into and then cleared arrives as [""], which is an
// answer by that test but not by any other. Counting it grades an untouched
// question wrong and files it in the Wrong Question Book, while a deselected
// multiple choice (which arrives as []) is correctly left alone.
//
// Every place that asks the question has to ask it the same way: the mock
// header/palette/submit dialog, the wrong-book upserts on both the practice and
// the mock path, and the client's optimistic wrong-book update. Keeping one
// predicate here is what stops them drifting apart again.
export function hasAnswer(type: string, selected: readonly string[]): boolean {
  return type === "fill_blank" ? selected.some((s) => typeof s === "string" && s.trim() !== "") : selected.length > 0;
}

export function isAnswerCorrect(type: string, selected: string[], correct: string[]): boolean {
  if (type === "fill_blank") {
    // `typeof s === "string"` is a backstop, not the validation: request bodies
    // are checked with isStringArray at the route boundary. It is here because a
    // draft written before that check existed must still grade, not throw.
    return selected.some((s) => {
      if (typeof s !== "string") return false;
      const normalized = s.trim().toLowerCase();
      return correct.some((c) => c.trim().toLowerCase() === normalized);
    });
  }
  if (type === "ordering") return selected.length === correct.length && selected.every((v, i) => v === correct[i]);
  // Choice-based types (single_choice/multiple_choice/true_false): set equality.
  if (selected.length !== correct.length) return false;
  const a = selected.slice().sort();
  const b = correct.slice().sort();
  return a.every((v, i) => v === b[i]);
}
