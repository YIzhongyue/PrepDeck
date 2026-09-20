import type { GradedAnswer, Question } from "../types";

function answerLines(question: Question, answerIds: string[]): string {
  if (!answerIds.length) return "- No answer provided";

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
  const options = question.options?.length
    ? question.options.map((option) => `- **${option.id}.** ${option.text}`).join("\n")
    : attempt ? "- No options (free-response question)" : "Free text (fill in the blank); accepted answers are listed below.";
  const officialExplanation = answerKey.explanation?.trim();

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
    "",
    !attempt && !question.options?.length ? "## Answer format" : "## Options",
    "",
    options,
    "",
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
    attempt
      ? "Please explain why the correct answer is right and why my answer is right or wrong. Clarify the underlying concepts and address each relevant option."
      : "Please explain why the correct answer is right, why the other options are wrong when applicable, and clarify the underlying concepts needed to solve this question."
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
