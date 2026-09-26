import { hasAnswer } from "@prepdeck/shared";
import type { Question } from "../types";

// Live practice's keyboard shortcuts, and the rule behind its Check answer
// button. The button used to wait for a complete answer while Enter submitted
// whatever was selected, and the shortcut panel advertised a "B" bookmark key
// that actually picked option B. The key handler (PrepDeckContext), the button
// and the panel (PracticeLive) all read this module now, so Enter can only
// submit an answer the button would accept, and the panel lists exactly the
// shortcuts that exist.

const CHOICE_TYPES = new Set(["single_choice", "multiple_choice", "true_false"]);

// Every plain letter can be an option ID (a question may have up to 20
// options), so the one shortcut that is not an answer lives on Shift.
export const BOOKMARK_KEY = "B";

/** How many selections a complete answer to `question` has. */
export function requiredSelections(question: Question): number {
  const interaction = question.content?.interaction;
  if (interaction?.type === "order") return interaction.options.length;
  if (interaction?.type === "match") return interaction.left.length;
  return question.type === "multiple_choice" ? (question.chooseCount || 1) : 1;
}

/** Whether `chosen` is a complete answer to a question whose content has loaded. */
export function canCheckAnswer(question: Question, chosen: readonly string[]): boolean {
  if (question.hasContent && !question.content) return false;
  const need = requiredSelections(question);
  if (chosen.length !== need) return false;
  if (question.content?.interaction.type === "order" && (chosen.some((id) => !id) || new Set(chosen).size !== need)) return false;
  return hasAnswer(question.type, chosen);
}

// Letter and number keys pick options only on choice questions. On ordering and
// matching they would replace a structured response with a single option ID.
function isChoiceQuestion(question: Question): boolean {
  return CHOICE_TYPES.has(question.type) && !!question.options?.length;
}

export type PracticeKeyAction =
  | { kind: "pick"; optionId: string }
  | { kind: "check" }
  | { kind: "next" }
  | { kind: "bookmark" };

/**
 * What a key press does on the live practice question, or null when it does
 * nothing and should be left to the browser. The caller filters out keys aimed
 * at text entry and at focused controls first.
 */
export function practiceKeyAction(
  event: { key: string; shiftKey: boolean },
  question: Question,
  answer: { graded: boolean; chosen: readonly string[] }
): PracticeKeyAction | null {
  const letter = event.key.length === 1 ? event.key.toUpperCase() : "";
  if (event.shiftKey) return letter === BOOKMARK_KEY ? { kind: "bookmark" } : null;
  if (event.key === "Enter") {
    if (answer.graded) return { kind: "next" };
    return canCheckAnswer(question, answer.chosen) ? { kind: "check" } : null;
  }
  if (answer.graded || !isChoiceQuestion(question) || (question.hasContent && !question.content) || !letter) return null;
  const options = question.options!;
  const byId = options.find((o) => o.id === letter);
  if (byId) return { kind: "pick", optionId: byId.id };
  const position = /^[1-9]$/.test(letter) ? Number(letter) : 0;
  const byPosition = position ? options[position - 1] : undefined;
  return byPosition ? { kind: "pick", optionId: byPosition.id } : null;
}

export interface ShortcutHint {
  keys: string;
  action: string;
}

function range(values: string[]): string {
  if (values.length === 1) return values[0]!;
  const contiguous = values.every((v, i) => i === 0 || v.charCodeAt(0) === values[i - 1]!.charCodeAt(0) + 1);
  return contiguous ? `${values[0]} – ${values[values.length - 1]}` : values.join(", ");
}

/** The shortcut panel for `question`: exactly what practiceKeyAction implements. */
export function practiceShortcutHints(question: Question): ShortcutHint[] {
  const hints: ShortcutHint[] = [];
  if (isChoiceQuestion(question)) {
    const options = question.options!;
    const count = Math.min(options.length, 9);
    hints.push({ keys: range(Array.from({ length: count }, (_, i) => String(i + 1))), action: "Select an option" });
    const letters = options.map((o) => o.id).filter((id) => /^[A-Z]$/.test(id));
    if (letters.length) hints.push({ keys: range(letters), action: "Select by letter" });
  }
  hints.push({ keys: "Enter", action: "Check answer / next question" });
  hints.push({ keys: `Shift + ${BOOKMARK_KEY}`, action: "Bookmark" });
  return hints;
}
