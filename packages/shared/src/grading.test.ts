// Answer validation (issue #39): the rules the practice answer and mock draft
// endpoints hold a selection to before anything is written. The routes are
// covered end to end in apps/worker/scripts/attempts-lifecycle.test.mjs; these
// pin the rules themselves.

import assert from "node:assert/strict";
import test from "node:test";
import {
  answerProblem, answerSizeProblem, isAnswerCorrect, isValidTimeSpent,
  MAX_ANSWER_TEXT_LENGTH, MAX_ANSWER_VALUES, MAX_TIME_SPENT_SECONDS, type AnswerableQuestion,
} from "./grading.ts";

const options = (...ids: string[]) => ids.map((id) => ({ id }));
const single: AnswerableQuestion = { type: "single_choice", options: options("A", "B") };
const multiple: AnswerableQuestion = { type: "multiple_choice", options: options("A", "B", "C") };
const blank: AnswerableQuestion = { type: "fill_blank", options: null };
const ordering: AnswerableQuestion = {
  type: "ordering", options: options("x", "y", "z"),
  interaction: { id: "r", type: "order", options: options("x", "y", "z") },
};
const matching: AnswerableQuestion = {
  type: "matching", options: options("L1", "L2"),
  interaction: { id: "r", type: "match", left: options("L1", "L2"), right: options("R1", "R2") },
};

test("an empty selection is a cleared answer for every type", () => {
  for (const question of [single, multiple, blank, ordering, matching]) assert.equal(answerProblem(question, []), null, question.type);
  assert.equal(answerProblem(blank, [""]), null, "a cleared fill-in box");
});

test("fill-in: one value, whatever it is", () => {
  assert.equal(answerProblem(blank, ["green"]), null);
  assert.match(answerProblem(blank, ["red", "green"]) ?? "", /single value/);
});

test("choice: known option IDs only, once each, at most one for single choice", () => {
  assert.equal(answerProblem(single, ["A"]), null);
  assert.ok(answerProblem(single, ["A", "B"]));
  assert.ok(answerProblem(single, ["A", "A"]));
  assert.ok(answerProblem(single, ["Z"]));
  assert.equal(answerProblem(multiple, ["C", "A"]), null);
  assert.ok(answerProblem(multiple, ["A", "A"]));
  assert.ok(answerProblem(multiple, ["A", "Z"]));
  assert.ok(answerProblem({ type: "true_false", options: options("true", "false") }, ["true", "false"]));
});

test("ordering: one position per item, blanks and repeats allowed while arranging", () => {
  assert.equal(answerProblem(ordering, ["z", "x", "y"]), null);
  assert.equal(answerProblem(ordering, ["z", "", ""]), null);
  assert.equal(answerProblem(ordering, ["z", "z", "y"]), null);
  assert.ok(answerProblem(ordering, ["z", "x"]));
  assert.ok(answerProblem(ordering, ["z", "x", "y", "x"]));
  assert.ok(answerProblem(ordering, ["z", "x", "w"]));
});

test("matching: canonical [left, right] pairs of known items, one per left item", () => {
  assert.equal(answerProblem(matching, ['["L2","R1"]', '["L1","R2"]']), null);
  assert.equal(answerProblem(matching, ['["L1","R2"]']), null, "a partial match is a draft");
  for (const bad of [['["L1","R9"]'], ['["L9","R1"]'], ['["L1", "R2"]'], ['["L1","R1"]', '["L1","R2"]'], ["L1"], ['["L1","R1","x"]']]) {
    assert.ok(answerProblem(matching, bad), JSON.stringify(bad));
  }
  assert.ok(answerProblem({ type: "matching", options: options("L1") }, ['["L1","R1"]']), "no content, nothing to match against");
});

test("size limits apply before any question-specific rule", () => {
  assert.equal(answerSizeProblem(Array(MAX_ANSWER_VALUES).fill("A")), null);
  assert.ok(answerSizeProblem(Array(MAX_ANSWER_VALUES + 1).fill("A")));
  assert.equal(answerSizeProblem(["x".repeat(MAX_ANSWER_TEXT_LENGTH)]), null);
  assert.ok(answerProblem(blank, ["x".repeat(MAX_ANSWER_TEXT_LENGTH + 1)]));
});

test("time spent: absent, or whole seconds within a day", () => {
  for (const value of [undefined, null, 0, 42, MAX_TIME_SPENT_SECONDS]) assert.equal(isValidTimeSpent(value), true, String(value));
  for (const value of [-1, 1.5, MAX_TIME_SPENT_SECONDS + 1, 1e300, "42", true, Number.NaN]) assert.equal(isValidTimeSpent(value), false, String(value));
});

test("several fill-in values never grade correct, even when one matches", () => {
  assert.equal(isAnswerCorrect("fill_blank", ["Green "], ["green"]), true);
  assert.equal(isAnswerCorrect("fill_blank", ["red", "green"], ["green"]), false);
  assert.equal(isAnswerCorrect("fill_blank", [], ["green"]), false);
});
