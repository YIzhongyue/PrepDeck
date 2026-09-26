// Deterministic, explainable quality-control checks for implementation's Admin
// MCP read tools (admin_find_duplicate_questions,
// admin_find_questions_missing_explanations,
// admin_find_questions_with_invalid_answer_references,
// admin_find_questions_missing_metadata, and the statistics tools). Pure
// functions over already-loaded Question[] so they are usable both from the
// scoped find_* tools (which need matching records) and the statistics
// tools (which only need counts), and so they can be unit tested without a
// database.

import { IMPORT_LIMITS, type Question } from "@prepdeck/shared";

const CHOICE_TYPES = new Set<Question["type"]>(["single_choice", "multiple_choice", "true_false"]);

export function normalizeStemForDuplicateCheck(stem: string): string {
  return stem.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface DuplicateQuestionGroup {
  normalizedStem: string;
  questions: { id: string; examId: string; externalId: string | null; sequenceNumber: number }[];
}

// Groups by normalized stem text only (not by answers), so an admin also
// sees near-duplicates that were later given a different answer key.
export function findDuplicateQuestions(questions: readonly Question[]): DuplicateQuestionGroup[] {
  const groups = new Map<string, DuplicateQuestionGroup>();
  for (const q of questions) {
    const key = normalizeStemForDuplicateCheck(q.stem);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { normalizedStem: key, questions: [] };
      groups.set(key, group);
    }
    group.questions.push({ id: q.id, examId: q.examId, externalId: q.externalId, sequenceNumber: q.sequenceNumber });
  }
  return [...groups.values()].filter((group) => group.questions.length > 1);
}

export function isMissingExplanation(question: Pick<Question, "explanation">): boolean {
  return question.explanation === null || question.explanation.trim() === "";
}

// Referential integrity between correctAnswers and options[].id — narrower
// than validateQuestionRow (used for full payload validation on write),
// scoped to the answer structure this read tool is named for. That includes
// the structures validation started refusing in issue #54, so rows saved before
// then can be found and fixed rather than silently grandfathered: once the
// rule exists, such a row cannot be saved again until it is corrected.
export function findAnswerReferenceIssues(question: Pick<Question, "type" | "options" | "correctAnswers" | "content">): string[] {
  if (question.type === "matching") {
    const interaction = question.content?.interaction;
    return interaction?.type === "match" && interaction.right.length < 2
      ? ["matching must have at least two right-hand items; with one, every match is correct"]
      : [];
  }
  if (!CHOICE_TYPES.has(question.type)) return [];
  const optionIds = new Set((question.options ?? []).map((option) => option.id));
  const issues: string[] = [];
  if (question.type === "single_choice" && optionIds.size < 2) {
    issues.push("single_choice must have at least two options; with one, it is always answered correctly");
  }
  for (const answer of question.correctAnswers) {
    if (!optionIds.has(answer)) issues.push(`correctAnswers references unknown option id "${answer}"`);
  }
  if (question.type === "true_false" && (optionIds.size !== 2 || !optionIds.has("true") || !optionIds.has("false"))) {
    issues.push('true_false must have exactly options "true" and "false"');
  }
  return issues;
}

export interface MissingMetadataFlags {
  missingDifficulty: boolean;
  missingTags: boolean;
  // Points outside the range validation accepts (issue #54): greater than 0
  // and at most IMPORT_LIMITS.maxPoints.
  invalidPoints: boolean;
}

export function isValidPoints(points: number): boolean {
  return Number.isFinite(points) && points > 0 && points <= IMPORT_LIMITS.maxPoints;
}

export function missingMetadataFlags(question: Pick<Question, "difficulty" | "tags" | "points">): MissingMetadataFlags {
  return { missingDifficulty: question.difficulty === null, missingTags: question.tags.length === 0, invalidPoints: !isValidPoints(question.points) };
}

export function hasMissingMetadata(flags: MissingMetadataFlags): boolean {
  return flags.missingDifficulty || flags.missingTags || flags.invalidPoints;
}

export function stemPreview(stem: string, maxLength = 160): string {
  const collapsed = stem.trim().replace(/\s+/g, " ");
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
}

export interface QuestionSetStatistics {
  scannedCount: number;
  truncated: boolean;
  byType: Record<Question["type"], number>;
  byDifficulty: Record<"easy" | "medium" | "hard" | "unset", number>;
  missingExplanationCount: number;
  missingMetadataCount: number;
  invalidAnswerReferenceCount: number;
  duplicateGroupCount: number;
  duplicateQuestionCount: number;
  answerRevisedCount: number;
  // Questions still flagged for manual review (issue #15). Sits with the
  // other quality counts rather than in byTag, because it is workflow state.
  needsReviewCount: number;
}

// `scanLimit` is the bound the caller used to load `questions`; when the
// scanned count reaches it, the report is flagged `truncated` so callers
// never mistake a bounded scan for a complete one.
export function buildQuestionSetStatistics(questions: readonly Question[], scanLimit: number): QuestionSetStatistics {
  const byType: QuestionSetStatistics["byType"] = { single_choice: 0, multiple_choice: 0, true_false: 0, fill_blank: 0, ordering: 0, matching: 0 };
  const byDifficulty: QuestionSetStatistics["byDifficulty"] = { easy: 0, medium: 0, hard: 0, unset: 0 };
  let missingExplanationCount = 0;
  let missingMetadataCount = 0;
  let invalidAnswerReferenceCount = 0;
  let answerRevisedCount = 0;
  let needsReviewCount = 0;
  for (const q of questions) {
    byType[q.type]++;
    byDifficulty[q.difficulty ?? "unset"]++;
    if (isMissingExplanation(q)) missingExplanationCount++;
    if (hasMissingMetadata(missingMetadataFlags(q))) missingMetadataCount++;
    if (findAnswerReferenceIssues(q).length > 0) invalidAnswerReferenceCount++;
    if (q.answerRevision > 1) answerRevisedCount++;
    if (q.needsReview) needsReviewCount++;
  }
  const duplicateGroups = findDuplicateQuestions(questions);
  return {
    scannedCount: questions.length,
    truncated: questions.length >= scanLimit,
    byType,
    byDifficulty,
    missingExplanationCount,
    missingMetadataCount,
    invalidAnswerReferenceCount,
    duplicateGroupCount: duplicateGroups.length,
    duplicateQuestionCount: duplicateGroups.reduce((sum, group) => sum + group.questions.length, 0),
    answerRevisedCount,
    needsReviewCount,
  };
}
