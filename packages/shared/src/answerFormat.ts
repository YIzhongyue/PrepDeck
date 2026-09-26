import { optionText, type ComponentOption, type QuestionContentModel } from "./question-components.ts";

// Readable answers (issues #42 and #43). Matching answers are stored as
// canonical JSON pair strings (["L1","R2"]) and ordering answers as item IDs,
// and every text summary used to print those as they are: "Correct answer:
// ["L1","R2"], ["L2","R1"]" in the practice banner, mock results, history,
// previews and both AI prompts. These turn them into what the question says:
// "HTTPS → 443" and "1. Read the values". Choice and fill-in answers are
// unchanged.

export interface FormattableQuestion {
  type: string;
  options?: readonly { id: string; text: string }[] | null;
  content?: QuestionContentModel | null;
}

// Option text on one line: component options can hold several blocks.
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function componentText(option: ComponentOption | undefined, content: QuestionContentModel | null | undefined): string | null {
  if (!option || !content) return null;
  const text = oneLine(optionText(option, content));
  return text || null;
}

/** The readable parts of an answer, one per stored value. IDs are the fallback. */
export function answerParts(question: FormattableQuestion, values: readonly string[]): string[] {
  const interaction = question.content?.interaction;
  if (question.type === "matching") {
    return values.map((value) => {
      let pair: unknown;
      try { pair = JSON.parse(value); } catch { return value; }
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") return value;
      const [left, right] = pair;
      const match = interaction?.type === "match" ? interaction : null;
      const leftText = componentText(match?.left.find((o) => o.id === left), question.content) ?? question.options?.find((o) => o.id === left)?.text ?? left;
      const rightText = componentText(match?.right.find((o) => o.id === right), question.content) ?? right;
      return `${oneLine(leftText)} → ${rightText}`;
    });
  }
  if (question.type === "ordering") {
    const order = interaction?.type === "order" ? interaction : null;
    return values.map((id, n) => {
      const text = !id ? "—" : componentText(order?.options.find((o) => o.id === id), question.content) ?? question.options?.find((o) => o.id === id)?.text ?? id;
      return `${n + 1}. ${oneLine(text)}`;
    });
  }
  return [...values];
}

/** An answer as one line of text; choice and fill-in answers read as before. */
export function formatAnswerText(question: FormattableQuestion, values: readonly string[]): string {
  if (question.type !== "matching" && question.type !== "ordering") return values.join(", ");
  return answerParts(question, values).join(question.type === "ordering" ? "  " : "; ");
}

/** The right-hand column of a matching question, for prompts that list it. */
export function matchingTargets(question: FormattableQuestion): { id: string; text: string }[] {
  const interaction = question.content?.interaction;
  if (interaction?.type !== "match") return [];
  return interaction.right.map((o) => ({ id: o.id, text: componentText(o, question.content) ?? o.id }));
}
