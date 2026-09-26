// Readable structured answers (issues #42 and #43).
import assert from "node:assert/strict";
import test from "node:test";
import type { QuestionContentModel } from "./question-components.ts";
import { answerParts, formatAnswerText, matchingTargets } from "./answerFormat.ts";

const paragraph = (id: string, text: string) => [{ id: `b-${id}`, type: "paragraph" as const, text }];
const content = (interaction: QuestionContentModel["interaction"]): QuestionContentModel =>
  ({ version: "1.0", body: paragraph("stem", "Stem"), stimuli: [], assets: [], interaction });
const matching = {
  type: "matching",
  options: [{ id: "L1", text: "HTTPS" }, { id: "L2", text: "SSH" }],
  content: content({ id: "r", type: "match", left: [{ id: "L1", body: paragraph("l1", "HTTPS") }, { id: "L2", body: paragraph("l2", "SSH") }], right: [{ id: "R1", body: paragraph("r1", "22") }, { id: "R2", body: paragraph("r2", "443") }] }),
};
const ordering = {
  type: "ordering",
  options: [{ id: "a", text: "Plan" }, { id: "b", text: "Do" }],
  content: content({ id: "r", type: "order", options: [{ id: "a", body: paragraph("a", "Plan") }, { id: "b", body: paragraph("b", "Do\n\nit") }] }),
};

test("matching pairs read as left → right item text", () => {
  assert.deepEqual(answerParts(matching, ['["L1","R2"]', '["L2","R1"]']), ["HTTPS → 443", "SSH → 22"]);
  assert.equal(formatAnswerText(matching, ['["L1","R2"]', '["L2","R1"]']), "HTTPS → 443; SSH → 22");
  assert.deepEqual(matchingTargets(matching), [{ id: "R1", text: "22" }, { id: "R2", text: "443" }]);
});

test("unknown IDs and malformed values fall back to what was stored", () => {
  assert.deepEqual(answerParts(matching, ['["L9","R9"]', "not json", '["L1"]']), ["L9 → R9", "not json", '["L1"]']);
  assert.deepEqual(answerParts({ type: "matching" }, ['["L1","R2"]']), ["L1 → R2"], "no content at all");
});

test("orderings read as numbered item text on one line each", () => {
  assert.deepEqual(answerParts(ordering, ["b", "a"]), ["1. Do it", "2. Plan"]);
  assert.equal(formatAnswerText(ordering, ["b", ""]), "1. Do it  2. —", "a blank position in a draft");
});

test("choice and fill-in answers are unchanged", () => {
  assert.equal(formatAnswerText({ type: "multiple_choice", options: [{ id: "A", text: "x" }] }, ["A", "C"]), "A, C");
  assert.equal(formatAnswerText({ type: "fill_blank" }, ["green", "verde"]), "green, verde");
  assert.deepEqual(matchingTargets({ type: "single_choice" }), []);
});
