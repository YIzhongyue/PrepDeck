import type { QuestionType } from "../types";

// The badge above a question used to be an inline ternary, copied into Practice,
// Mock and Learning and then edited in only one of them: all three called a
// fill-in "Single choice" until Learning grew a branch for it, and all three
// still called a true/false question "Single choice" too. Admin printed a
// fourth spelling of its own (`type.replaceAll("_", " ")`), so an author and a
// learner saw different words for the same question.
//
// One switch over `QuestionType` with no `default` makes a fifth question type
// a compile error here instead of three silently wrong labels in the UI.
export function questionTypeLabel(question: { type: QuestionType; chooseCount?: number | null }): string {
  switch (question.type) {
    case "multiple_choice": return `Choose ${question.chooseCount || 1}`;
    case "single_choice": return "Single choice";
    case "true_false": return "True / false";
    case "fill_blank": return "Fill in the blank";
  }
}
