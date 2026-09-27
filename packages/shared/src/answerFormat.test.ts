// Readable structured answers (issues #42 and #43).
import assert from "node:assert/strict";
import test from "node:test";
import type { QuestionContentModel } from "./question-components.ts";
import { answerParts, continueListItem, formatAnswerText, labelledListItem, matchingTargets, promptAnswerParts, promptOptions } from "./answerFormat.ts";

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

// Review of #69: code is valid option content, and a prompt that collapses its
// whitespace sends two different snippets to the model as the same text.
const FENCE = "```";
const code = (id: string, text: string) => [{ id: `c-${id}`, type: "code" as const, language: "python", text }];
const outside = "if enabled:\n    start()\nstop()", inside = "if enabled:\n    start()\n    stop()";
const codeMatching = {
  type: "matching",
  options: [{ id: "always", text: "stop() always runs" }, { id: "guarded", text: "stop() runs only when enabled" }],
  content: content({ id: "r", type: "match",
    left: [{ id: "always", body: paragraph("always", "stop() always runs") }, { id: "guarded", body: paragraph("guarded", "stop() runs only when enabled") }],
    right: [{ id: "outside", body: code("outside", outside) }, { id: "inside", body: code("inside", inside) }] }),
};

test("prompt text keeps a code option's line breaks and indentation, fenced", () => {
  const targets = matchingTargets(codeMatching);
  assert.deepEqual(targets, [
    { id: "outside", text: `${FENCE}python\n${outside}\n${FENCE}` },
    { id: "inside", text: `${FENCE}python\n${inside}\n${FENCE}` },
  ]);
  const right = promptAnswerParts(codeMatching, ['["always","outside"]', '["guarded","inside"]']);
  assert.equal(right[0], `stop() always runs\n→\n${FENCE}python\n${outside}\n${FENCE}`, "a fence starts its own line");
  assert.notDeepEqual(promptAnswerParts(codeMatching, ['["always","inside"]', '["guarded","outside"]']), right,
    "a wrong matching no longer reads like the right one");
});

test("the one-line UI summary of the same answer is unchanged", () => {
  assert.deepEqual(answerParts(codeMatching, ['["always","outside"]']), ["stop() always runs → if enabled: start() stop()"]);
});

test("prompt orderings keep an item's whitespace, and single-line parts read as before", () => {
  const codeOrdering = { type: "ordering", content: content({ id: "r", type: "order",
    options: [{ id: "a", body: code("a", "for x in xs:\n    total += x") }, { id: "b", body: paragraph("b", "Print") }] }) };
  // The fence follows the "1." marker, and its lines sit at the marker's content column.
  assert.deepEqual(promptAnswerParts(codeOrdering, ["a", "b"]), [`1. ${FENCE}python\n   for x in xs:\n       total += x\n   ${FENCE}`, "2. Print"]);
  assert.deepEqual(promptAnswerParts(matching, ['["L1","R2"]']), ["HTTPS → 443"]);
  assert.deepEqual(promptOptions(codeOrdering).map(o => o.text), [`${FENCE}python\nfor x in xs:\n    total += x\n${FENCE}`, "Print"]);
  assert.deepEqual(promptOptions({ type: "single_choice", options: [{ id: "A", text: "x" }] }), [{ id: "A", text: "x" }], "no content: the stored options");
});

test("a fence is longer than any backtick run inside the code", () => {
  const q = { type: "ordering", content: content({ id: "r", type: "order", options: [{ id: "a", body: code("a", 'print("```")') }] }) };
  assert.equal(promptAnswerParts(q, ["a"])[0], '1. ````python\n   print("```")\n   ````');
});

test("continueListItem keeps a multi-line entry inside its list item", () => {
  assert.equal(continueListItem(`${FENCE}python\nif x:\n    a()\n\nb()\n${FENCE}`), `${FENCE}python\n  if x:\n      a()\n\n  b()\n  ${FENCE}`);
  assert.equal(continueListItem("one line"), "one line");
});

test("labelledListItem puts multi-line text under its label, so a fence starts its own line", () => {
  assert.equal(labelledListItem("**R.**", "443"), "**R.** 443", "one line reads as before");
  assert.equal(labelledListItem("(R)", `${FENCE}python\nif x:\n    a()\n${FENCE}`), `(R)\n  ${FENCE}python\n  if x:\n      a()\n  ${FENCE}`);
  assert.equal(labelledListItem("(R)", "alpha\n\nbeta"), "(R)\n  alpha\n\n  beta", "two paragraphs stay two paragraphs");
});
