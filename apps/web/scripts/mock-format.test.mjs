// The Mock setup's custom fields validate what was typed instead of clamping
// every keystroke (issue #55): clamping turned 120 minutes into 300 and 45
// into 55, because each intermediate digit was replaced before the next one.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/mockFormat.ts", import.meta.url))],
  bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"],
});
const { MAX_CUSTOM_MINUTES, MIN_CUSTOM_MINUTES, mockPlan, wholeNumberInRange } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

test("every intermediate value of an ordinary entry is kept, not clamped", () => {
  const minutes = text => wholeNumberInRange(text, MIN_CUSTOM_MINUTES, MAX_CUSTOM_MINUTES);
  // "1" and "12" are out of range on the way to 120; they must be reported as
  // invalid rather than rewritten, so the next digit lands on what was typed.
  assert.equal(minutes("1"), null);
  assert.equal(minutes("12"), 12);
  assert.equal(minutes("120"), 120);
  assert.equal(minutes("4"), null);
  assert.equal(minutes("45"), 45);
});

test("empty, fractional, signed, exponent and out-of-range text is invalid", () => {
  for (const text of ["", "   ", "2.5", "-5", "+5", "1e2", "abc", "301", "0"]) {
    assert.equal(wholeNumberInRange(text, 5, 300), null, JSON.stringify(text));
  }
  assert.equal(wholeNumberInRange(" 45 ", 5, 300), 45, "surrounding whitespace is ignored");
  assert.equal(wholeNumberInRange("045", 5, 300), 45);
  assert.equal(wholeNumberInRange("5", 5, 300), 5);
  assert.equal(wholeNumberInRange("300", 5, 300), 300);
});

test("the question count is bounded by the bank", () => {
  assert.equal(wholeNumberInRange("3", 1, 3), 3);
  assert.equal(wholeNumberInRange("4", 1, 3), null);
  assert.equal(wholeNumberInRange("0", 1, 3), null);
});

// Issue #94: skipping questions under review shrinks the bank the exam draws
// from, so the plan is capped by what is left, not by the whole catalog.
test("a mock that skips questions under review is capped by the questions left", () => {
  const catalog = [...Array.from({ length: 4 }, () => ({ needsReview: false })), ...Array.from({ length: 3 }, () => ({ needsReview: true }))];
  const plan = (mockSkipReview, mockCount = 10) =>
    mockPlan({ exams: [], examId: null, catalog, mockFormat: "custom", mockCount, mockMinutes: 30, mockSkipReview });
  assert.equal(plan(false).questionCount, 7, "included by default");
  assert.equal(plan(true).questionCount, 4);
  assert.equal(plan(true, 2).questionCount, 2, "a shorter request is unaffected");
  const all = mockPlan({ exams: [], examId: null, catalog: [{ needsReview: true }], mockFormat: "custom", mockCount: 5, mockMinutes: 30, mockSkipReview: true });
  assert.equal(all.questionCount, 0, "nothing left to start");
});
