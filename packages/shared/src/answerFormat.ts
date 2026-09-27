import { blockText, optionText, type ComponentOption, type ContentBlock, type QuestionContentModel } from "./question-components.ts";

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

// Two ways to write an option. The UI summaries put a whole answer on one line,
// so "line" collapses whitespace. The AI prompts must not: code is valid option
// content, and `if x:\n    a()\nb()` and `if x:\n    a()\n    b()` collapse to
// the same text, so the model could not tell them apart (review of #69).
// "prompt" keeps every line break and indent, and fences code blocks.
type Style = "line" | "prompt";

// Option text on one line: component options can hold several blocks.
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

// A fence longer than any backtick run inside the code, so the code cannot close it.
function fenced(text: string, language = ""): string {
  const ticks = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (run) => run[0].length + 1)));
  return `${ticks}${language}\n${text}\n${ticks}`;
}
const promptBlockText = (block: ContentBlock) => block.type === "code" ? fenced(block.text, block.language) : blockText(block);

/** Option text for a prompt: nothing collapsed, code blocks fenced. */
export function promptOptionText(option: ComponentOption, content: QuestionContentModel): string {
  return option.body ? option.body.map(promptBlockText).join("\n\n") : optionText(option, content);
}

function componentText(option: ComponentOption | undefined, content: QuestionContentModel | null | undefined, style: Style): string | null {
  if (!option || !content) return null;
  const text = style === "line" ? oneLine(optionText(option, content)) : promptOptionText(option, content).trim();
  return text || null;
}

function parts(question: FormattableQuestion, values: readonly string[], style: Style): string[] {
  const interaction = question.content?.interaction;
  const flat = (text: string) => style === "line" ? oneLine(text) : text;
  if (question.type === "matching") {
    return values.map((value) => {
      let pair: unknown;
      try { pair = JSON.parse(value); } catch { return value; }
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") return value;
      const [left, right] = pair;
      const match = interaction?.type === "match" ? interaction : null;
      const leftText = flat(componentText(match?.left.find((o) => o.id === left), question.content, style) ?? question.options?.find((o) => o.id === left)?.text ?? left);
      const rightText = componentText(match?.right.find((o) => o.id === right), question.content, style) ?? right;
      // A fence has to start its own line.
      return `${leftText}${`${leftText}${rightText}`.includes("\n") ? "\n→\n" : " → "}${rightText}`;
    });
  }
  if (question.type === "ordering") {
    const order = interaction?.type === "order" ? interaction : null;
    return values.map((id, n) => {
      const text = flat(!id ? "—" : componentText(order?.options.find((o) => o.id === id), question.content, style) ?? question.options?.find((o) => o.id === id)?.text ?? id);
      // "1." is a list marker, so a fence may follow it on the same line; the
      // lines after it are indented to the marker's content column. (A "1."
      // alone on its line would be read as an empty list item.)
      const marker = `${n + 1}. `;
      return marker + continueListItem(text, marker.length);
    });
  }
  return [...values];
}

/** The readable parts of an answer, one per stored value, each on one line. IDs are the fallback. */
export function answerParts(question: FormattableQuestion, values: readonly string[]): string[] {
  return parts(question, values, "line");
}

/** answerParts for AI prompts: whitespace kept, code fenced, so a part may span lines. */
export function promptAnswerParts(question: FormattableQuestion, values: readonly string[]): string[] {
  return parts(question, values, "prompt");
}

/** An answer as one line of text; choice and fill-in answers read as before. */
export function formatAnswerText(question: FormattableQuestion, values: readonly string[]): string {
  if (question.type !== "matching" && question.type !== "ordering") return values.join(", ");
  return answerParts(question, values).join(question.type === "ordering" ? "  " : "; ");
}

/** The options a prompt lists (a matching question's left column), in prompt style when the question has content. */
export function promptOptions(question: FormattableQuestion): { id: string; text: string }[] {
  const interaction = question.content?.interaction;
  const options = interaction?.type === "match" ? interaction.left : interaction?.type === "order" || interaction?.type === "choice" ? interaction.options : null;
  if (!options) return [...(question.options ?? [])];
  return options.map((o) => ({ id: o.id, text: componentText(o, question.content, "prompt") ?? question.options?.find((legacy) => legacy.id === o.id)?.text ?? o.id }));
}

/** The right-hand column of a matching question, for prompts that list it, in prompt style. */
export function matchingTargets(question: FormattableQuestion): { id: string; text: string }[] {
  const interaction = question.content?.interaction;
  if (interaction?.type !== "match") return [];
  return interaction.right.map((o) => ({ id: o.id, text: componentText(o, question.content, "prompt") ?? o.id }));
}

/**
 * Indents every line after the first by `width` spaces, so a multi-line entry
 * (a fenced snippet, say) stays inside the list item that introduces it.
 * Blank lines are left empty rather than padded.
 */
export function continueListItem(text: string, width = 2): string {
  const pad = " ".repeat(width);
  return text.split("\n").map((line, n) => n && line ? pad + line : line).join("\n");
}

/**
 * A labelled list item's content, such as "**R.** 443" or "(R) 443". A
 * multi-line text goes on the lines under the label, indented to the item's
 * content column: text after a label is a paragraph, so a code fence there
 * would not open a code block, and its closing fence would open an empty one.
 */
export function labelledListItem(label: string, text: string, width = 2): string {
  if (!text.includes("\n")) return `${label} ${text}`;
  return `${label}\n${" ".repeat(width)}${continueListItem(text, width)}`;
}
