import { allContentBlocks, answerParts, matchingTargets } from "@prepdeck/shared";
import type { GradedAnswer, Question } from "../types";

const STRUCTURED = new Set(["ordering", "matching"]);

function answerLines(question: Question, answerIds: string[]): string {
  if (!answerIds.length) return "- No answer provided";
  // Matching pairs and orderings read as the question's own text (issue #42),
  // not as stored IDs such as ["L1","R2"].
  if (STRUCTURED.has(question.type)) return answerParts(question, answerIds).map((part) => `- ${part}`).join("\n");

  return answerIds.map((answerId) => {
    const option = question.options?.find((candidate) => candidate.id === answerId);
    return option ? `- **${option.id}.** ${option.text}` : `- ${answerId}`;
  }).join("\n");
}

type AnswerKey = Pick<GradedAnswer, "correctAnswers" | "explanation">;

function buildQuestionPrompt(
  question: Question,
  answerKey: AnswerKey,
  context: {
    examName?: string;
    attempt?: { selectedAnswers: string[]; isCorrect: boolean };
  }
): string {
  const { attempt } = context;
  const listed = (items: readonly { id: string; text: string }[]) => items.map((option) => `- **${option.id}.** ${option.text}`).join("\n");
  const options = question.options?.length
    ? listed(question.options)
    : attempt ? "- No options (free-response question)" : "Free text (fill in the blank); accepted answers are listed below.";
  // A matching question's options are its left column only; the right column
  // has to be listed too, or its answer names items the prompt never shows.
  const targets = question.type === "matching" ? matchingTargets(question) : [];
  const officialExplanation = answerKey.explanation?.trim();
  // Figures reach the prompt only as caption and alt text; say so, rather than
  // let the model assume it has the whole question.
  const hasFigure = !!question.content && allContentBlocks(question.content).some((block) => block.type === "figure");
  const optionsHeading = question.type === "matching" ? "## Items to match" : question.type === "ordering" ? "## Items to put in order" : "## Options";
  const closing = question.type === "matching"
    ? (attempt ? "Please explain why each pair matches, where my matching went wrong if it did, and the underlying concepts." : "Please explain why each pair matches and clarify the underlying concepts needed to solve this question.")
    : question.type === "ordering"
      ? (attempt ? "Please explain why this order is correct, where my order went wrong if it did, and what each step depends on." : "Please explain why this order is correct and what each step depends on.")
      : attempt
        ? "Please explain why the correct answer is right and why my answer is right or wrong. Clarify the underlying concepts and address each relevant option."
        : "Please explain why the correct answer is right, why the other options are wrong when applicable, and clarify the underlying concepts needed to solve this question.";

  return [
    attempt ? "# Practice question review" : "# Learning question review",
    "",
    context.examName !== undefined ? `**Exam:** ${context.examName}` : null,
    question.externalId ? `**Question ID:** ${question.externalId}` : null,
    `**Question type:** ${question.type.replaceAll("_", " ")}`,
    "",
    "## Question",
    "",
    question.stem,
    hasFigure ? "" : null,
    hasFigure ? "_This question includes a figure that is not reproduced here; only its caption and alt text are included above._" : null,
    "",
    !attempt && !question.options?.length ? "## Answer format" : optionsHeading,
    "",
    options,
    "",
    targets.length ? "## Match with" : null,
    targets.length ? "" : null,
    targets.length ? listed(targets) : null,
    targets.length ? "" : null,
    attempt ? "## My answer" : null,
    attempt ? "" : null,
    attempt ? answerLines(question, attempt.selectedAnswers) : null,
    attempt ? "" : null,
    "## Correct answer",
    "",
    answerLines(question, answerKey.correctAnswers),
    attempt ? "" : null,
    attempt ? "## Result" : null,
    attempt ? "" : null,
    attempt ? (attempt.isCorrect ? "Correct" : "Incorrect") : null,
    officialExplanation ? "" : null,
    officialExplanation ? "## Official explanation" : null,
    officialExplanation ? "" : null,
    officialExplanation || null,
    "",
    "---",
    closing
  ].filter((line): line is string => line !== null).join("\n");
}

/** Build a self-contained Markdown prompt users can paste into any AI chat. */
export function buildPracticePrompt(
  question: Question,
  selectedAnswers: string[],
  gradedAnswer: GradedAnswer
): string {
  return buildQuestionPrompt(question, gradedAnswer, {
    attempt: { selectedAnswers, isCorrect: gradedAnswer.isCorrect }
  });
}

/** Learning reviews an answer key without implying a new user attempt. */
export function buildLearningPrompt(question: Question, examName: string, answerKey: AnswerKey): string {
  return buildQuestionPrompt(question, answerKey, { examName });
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Clipboard copy failed");
  } finally {
    // Also discard potentially sensitive text when the legacy API throws.
    textarea.remove();
  }
}
