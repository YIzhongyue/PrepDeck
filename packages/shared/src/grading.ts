// Single source of truth for "is this answer correct", used both by the
// practice per-question grading endpoint and the mock-exam complete endpoint
// (Sections 3.3/3.4). Keeping this in one place matters: grading practice and
// mock exams differently would let a question's correctness depend on which
// mode it was answered in.

import type { Interaction } from "./question-components.ts";

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// Answer validation (issue #39). A selection used to be checked only for being
// an array of strings, so the API graded ["red", "blue", "green"] correct for a
// fill-in whose answer is green, and stored option IDs a question does not
// have. The practice answer endpoint and the mock draft endpoint both run these
// checks before anything is written, and mock grading applies them to drafts
// saved before they existed.

/** At most this many values in one answer, whatever the question. */
export const MAX_ANSWER_VALUES = 50;
/** At most this many characters in one answer value (a fill-in answer or an ID). */
export const MAX_ANSWER_TEXT_LENGTH = 1000;
/** A recorded time on one question longer than a day is not a measurement. */
export const MAX_TIME_SPENT_SECONDS = 86_400;

/** What answer validation needs to know about a question. */
export interface AnswerableQuestion {
  type: string;
  options: readonly { id: string }[] | null;
  /** The component interaction, when the question has structured content. */
  interaction?: Interaction | null;
}

/** Why `selected` is too large to be any answer, or null. Needs no question. */
export function answerSizeProblem(selected: readonly string[]): string | null {
  if (selected.length > MAX_ANSWER_VALUES) return `an answer has at most ${MAX_ANSWER_VALUES} values`;
  if (selected.some((value) => value.length > MAX_ANSWER_TEXT_LENGTH)) return `each answer value is at most ${MAX_ANSWER_TEXT_LENGTH} characters`;
  return null;
}

/**
 * Why `selected` cannot be an answer to `question`, or null when it can.
 *
 * Empty selections are valid for every type: they are how a learner clears an
 * answer, and `hasAnswer` already treats them as unanswered. The rules are the
 * ones a draft must meet, which is why an ordering may still contain blanks and
 * repeats: the learner can be halfway through arranging it. Such an answer is
 * graded incorrect, never rejected.
 */
export function answerProblem(question: AnswerableQuestion, selected: readonly string[]): string | null {
  const size = answerSizeProblem(selected);
  if (size) return size;
  const optionIds = new Set((question.options ?? []).map((option) => option.id));
  switch (question.type) {
    case "fill_blank":
      return selected.length <= 1 ? null : "a fill-in answer is a single value";
    case "single_choice":
    case "true_false":
      if (selected.length > 1) return "choose at most one option";
      return selected.every((id) => optionIds.has(id)) ? null : "unknown option ID";
    case "multiple_choice":
      if (new Set(selected).size !== selected.length) return "each option can be chosen once";
      return selected.every((id) => optionIds.has(id)) ? null : "unknown option ID";
    case "ordering": {
      const items = question.interaction?.type === "order" ? new Set(question.interaction.options.map((o) => o.id)) : optionIds;
      if (selected.length !== 0 && selected.length !== items.size) return "an ordering answer has one position per item";
      return selected.every((id) => id === "" || items.has(id)) ? null : "unknown item ID";
    }
    case "matching": {
      const interaction = question.interaction;
      if (interaction?.type !== "match") return "this question has no matching content";
      const left = new Set(interaction.left.map((o) => o.id));
      const right = new Set(interaction.right.map((o) => o.id));
      const matched = new Set<string>();
      for (const value of selected) {
        let pair: unknown;
        try { pair = JSON.parse(value); } catch { pair = null; }
        if (!Array.isArray(pair) || pair.length !== 2 || JSON.stringify(pair) !== value
          || !left.has(pair[0]) || !right.has(pair[1]) || matched.has(pair[0])) {
          return "a matching answer is canonical [leftId, rightId] pairs of known items, one per left item";
        }
        matched.add(pair[0]);
      }
      return null;
    }
    default:
      return null;
  }
}

/** A client-reported time on one question: absent, or whole seconds within a day. */
export function isValidTimeSpent(value: unknown): boolean {
  return value == null || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_TIME_SPENT_SECONDS);
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
    // One blank, one answer: several guesses in one submission are not an
    // answer, even if one of them matches (issue #39). The routes reject them
    // with answerProblem; this keeps a draft saved before that check from
    // grading correct.
    if (selected.length !== 1) return false;
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
