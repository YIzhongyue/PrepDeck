import assert from "node:assert/strict";
import test from "node:test";
import type { Question } from "@prepdeck/shared";
import {
  buildQuestionSetStatistics,
  findAnswerReferenceIssues,
  findDuplicateQuestions,
  hasMissingMetadata,
  isMissingExplanation,
  missingMetadataFlags,
  normalizeStemForDuplicateCheck,
  stemPreview,
} from "./questionQuality.ts";

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "q1", examId: "e1", externalId: null, sequenceNumber: 1,
    type: "single_choice", stem: "What is 2+2?",
    options: [{ id: "a", text: "3" }, { id: "b", text: "4" }],
    correctAnswers: ["b"], explanation: "Because 2+2=4.", difficulty: "easy", tags: ["math"],
    points: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    revision: 1, answerRevision: 1, answerRevisedAt: null,
    ...overrides,
  };
}

test("normalizeStemForDuplicateCheck collapses whitespace and case", () => {
  assert.equal(normalizeStemForDuplicateCheck("  What   is\n2+2?  "), "what is 2+2?");
});

test("findDuplicateQuestions groups questions with the same normalized stem", () => {
  const groups = findDuplicateQuestions([
    question({ id: "q1", stem: "What is 2+2?" }),
    question({ id: "q2", stem: "what   is 2+2?" }),
    question({ id: "q3", stem: "A totally different question" }),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.questions.map((q) => q.id), ["q1", "q2"]);
});

test("findDuplicateQuestions ignores empty stems and unique stems", () => {
  const groups = findDuplicateQuestions([question({ id: "q1", stem: "Unique" })]);
  assert.deepEqual(groups, []);
});

test("isMissingExplanation treats null and whitespace-only as missing", () => {
  assert.equal(isMissingExplanation(question({ explanation: null })), true);
  assert.equal(isMissingExplanation(question({ explanation: "   " })), true);
  assert.equal(isMissingExplanation(question({ explanation: "Because..." })), false);
});

test("findAnswerReferenceIssues flags a correctAnswers id with no matching option", () => {
  const issues = findAnswerReferenceIssues(question({
    type: "single_choice",
    options: [{ id: "a", text: "3" }, { id: "b", text: "4" }],
    correctAnswers: ["c"],
  }));
  assert.deepEqual(issues, ['correctAnswers references unknown option id "c"']);
});

test("findAnswerReferenceIssues flags a true_false question missing the true/false option ids", () => {
  const issues = findAnswerReferenceIssues(question({
    type: "true_false",
    options: [{ id: "yes", text: "Yes" }, { id: "no", text: "No" }],
    correctAnswers: ["yes"],
  }));
  assert.ok(issues.some((issue) => issue.includes("true_false must have exactly options")));
});

test("findAnswerReferenceIssues is a no-op for fill_blank questions", () => {
  assert.deepEqual(findAnswerReferenceIssues(question({ type: "fill_blank", options: null, correctAnswers: ["anything"] })), []);
});

test("findAnswerReferenceIssues accepts a valid choice-based question", () => {
  assert.deepEqual(findAnswerReferenceIssues(question()), []);
});

test("missingMetadataFlags / hasMissingMetadata detect absent difficulty or tags", () => {
  assert.equal(hasMissingMetadata(missingMetadataFlags(question({ difficulty: null }))), true);
  assert.equal(hasMissingMetadata(missingMetadataFlags(question({ tags: [] }))), true);
  assert.equal(hasMissingMetadata(missingMetadataFlags(question())), false);
});

test("stemPreview truncates long stems with an ellipsis and collapses whitespace", () => {
  const long = "a".repeat(200);
  const preview = stemPreview(long, 160);
  assert.equal(preview.length, 161);
  assert.ok(preview.endsWith("…"));
  assert.equal(stemPreview("short  stem"), "short stem");
});

test("buildQuestionSetStatistics aggregates counts across the scanned set", () => {
  const stats = buildQuestionSetStatistics([
    question({ id: "q1", stem: "Dup", type: "single_choice", difficulty: "easy" }),
    question({ id: "q2", stem: "Dup", type: "single_choice", difficulty: null, explanation: null }),
    question({ id: "q3", stem: "Unique", type: "fill_blank", options: null, correctAnswers: ["x"], difficulty: "hard", tags: [], answerRevision: 2 }),
  ], 100);
  assert.equal(stats.scannedCount, 3);
  assert.equal(stats.truncated, false);
  assert.equal(stats.byType.single_choice, 2);
  assert.equal(stats.byType.fill_blank, 1);
  assert.equal(stats.byDifficulty.unset, 1);
  assert.equal(stats.missingExplanationCount, 1);
  assert.equal(stats.missingMetadataCount, 2);
  assert.equal(stats.duplicateGroupCount, 1);
  assert.equal(stats.duplicateQuestionCount, 2);
  assert.equal(stats.answerRevisedCount, 1);
});

test("buildQuestionSetStatistics flags truncated when the scan hit its bound", () => {
  const stats = buildQuestionSetStatistics([question(), question({ id: "q2" })], 2);
  assert.equal(stats.truncated, true);
});
