import type { QuestionType } from "../types";
import { t } from "../i18n/runtime";

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
    case "multiple_choice": return t("questionTypes.chooseN", { count: question.chooseCount || 1 });
    case "single_choice": return t("questionTypes.single");
    case "true_false": return t("questionTypes.trueFalse");
    case "ordering": return t("questionTypes.ordering");
    case "matching": return t("questionTypes.matching");
    case "fill_blank": return t("questionTypes.fillBlank");
  }
}
