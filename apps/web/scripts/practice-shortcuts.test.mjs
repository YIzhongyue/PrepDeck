// Live practice's keyboard shortcuts (issue #50). Enter must follow the Check
// answer button's rule, letter keys must never collide with the bookmark
// shortcut, and the panel must list exactly what the handler implements.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/practiceShortcuts.ts", import.meta.url))],
  bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"],
});
const { canCheckAnswer, practiceKeyAction, practiceShortcutHints, requiredSelections } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const options = ids => ids.map(id => ({ id, text: `Option ${id}` }));
const single = { id: "s", type: "single_choice", chooseCount: null, options: options(["A", "B", "C", "D"]) };
const multi = { id: "m", type: "multiple_choice", chooseCount: 2, options: options(["A", "B", "C", "D"]) };
const trueFalse = { id: "tf", type: "true_false", chooseCount: null, options: options(["true", "false"]) };
const blank = { id: "f", type: "fill_blank", chooseCount: null, options: null };
const order = {
  id: "o", type: "ordering", chooseCount: null, hasContent: true, options: options(["x", "y", "z"]),
  content: { interaction: { type: "order", options: options(["x", "y", "z"]) } },
};
const match = {
  id: "t", type: "matching", chooseCount: null, hasContent: true, options: options(["L1", "L2"]),
  content: { interaction: { type: "match", left: options(["L1", "L2"]), right: options(["R1", "R2"]) } },
};
const key = (k, shiftKey = false) => ({ key: k, shiftKey });
const live = chosen => ({ graded: false, chosen });

test("a complete answer is required before checking", () => {
  assert.equal(requiredSelections(multi), 2);
  assert.equal(canCheckAnswer(multi, ["A"]), false, "1 of 2 is partial");
  assert.equal(canCheckAnswer(multi, ["A", "C"]), true);
  assert.equal(canCheckAnswer(single, []), false);
  assert.equal(canCheckAnswer(single, ["B"]), true);
  assert.equal(canCheckAnswer(blank, [""]), false);
  assert.equal(canCheckAnswer(blank, ["   "]), false);
  assert.equal(canCheckAnswer(blank, ["green"]), true);
  assert.equal(canCheckAnswer(order, ["x", "", "z"]), false);
  assert.equal(canCheckAnswer(order, ["x", "x", "z"]), false);
  assert.equal(canCheckAnswer(order, ["z", "x", "y"]), true);
  assert.equal(canCheckAnswer(match, ['["L1","R2"]']), false);
  assert.equal(canCheckAnswer(match, ['["L1","R2"]', '["L2","R1"]']), true);
  assert.equal(canCheckAnswer({ ...single, hasContent: true }, ["A"]), false, "content still loading");
});

test("Enter checks only a complete answer, and moves on once graded", () => {
  assert.equal(practiceKeyAction(key("Enter"), multi, live(["A"])), null);
  assert.equal(practiceKeyAction(key("Enter"), multi, live([])), null);
  assert.deepEqual(practiceKeyAction(key("Enter"), multi, live(["A", "B"])), { kind: "check" });
  assert.deepEqual(practiceKeyAction(key("Enter"), multi, { graded: true, chosen: ["A"] }), { kind: "next" });
  assert.deepEqual(practiceKeyAction(key("Enter"), blank, live(["green"])), { kind: "check" });
  assert.deepEqual(practiceKeyAction(key("Enter"), order, live(["z", "x", "y"])), { kind: "check" });
});

test("letters and numbers pick options; Shift+B bookmarks", () => {
  assert.deepEqual(practiceKeyAction(key("b"), single, live([])), { kind: "pick", optionId: "B" });
  assert.deepEqual(practiceKeyAction(key("B"), single, live([])), { kind: "pick", optionId: "B" }, "Caps Lock");
  assert.deepEqual(practiceKeyAction(key("3"), single, live([])), { kind: "pick", optionId: "C" });
  assert.deepEqual(practiceKeyAction(key("B", true), single, live([])), { kind: "bookmark" });
  assert.deepEqual(practiceKeyAction(key("B", true), blank, { graded: true, chosen: [] }), { kind: "bookmark" });
  assert.equal(practiceKeyAction(key("A", true), single, live([])), null, "Shift is reserved for commands");
  assert.equal(practiceKeyAction(key("5"), single, live([])), null, "no fifth option");
  assert.equal(practiceKeyAction(key("E"), single, live([])), null);
  assert.equal(practiceKeyAction(key("Escape"), single, live([])), null);
  assert.deepEqual(practiceKeyAction(key("2"), trueFalse, live([])), { kind: "pick", optionId: "false" });
});

test("picks never apply to graded, loading, fill-in or structured questions", () => {
  assert.equal(practiceKeyAction(key("a"), single, { graded: true, chosen: ["A"] }), null);
  assert.equal(practiceKeyAction(key("a"), { ...single, hasContent: true }, live([])), null);
  assert.equal(practiceKeyAction(key("1"), blank, live([])), null);
  assert.equal(practiceKeyAction(key("1"), order, live(["x", "y", "z"])), null);
  assert.equal(practiceKeyAction(key("1"), match, live([])), null);
});

test("the panel lists exactly the implemented shortcuts", () => {
  const keys = question => practiceShortcutHints(question).map(h => h.keys);
  assert.deepEqual(keys(single), ["1 – 4", "A – D", "Enter", "Shift + B"]);
  assert.deepEqual(keys(trueFalse), ["1 – 2", "Enter", "Shift + B"]);
  assert.deepEqual(keys(blank), ["Enter", "Shift + B"]);
  assert.deepEqual(keys(order), ["Enter", "Shift + B"]);
  assert.deepEqual(keys({ ...single, options: options(["A", "C"]) }), ["1 – 2", "A, C", "Enter", "Shift + B"]);
  const many = { ...single, options: options("ABCDEFGHIJKL".split("")) };
  assert.deepEqual(keys(many).slice(0, 2), ["1 – 9", "A – L"]);
  for (const hint of practiceShortcutHints(single)) assert.notEqual(hint.keys, "B", "B is an option letter");
});
