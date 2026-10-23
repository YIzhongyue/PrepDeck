import assert from "node:assert/strict";
import test from "node:test";
import { assertRenderCounts, LIMITS } from "./render-counts.assertions.mjs";

const validMeasurements = () => Object.fromEntries(Object.entries(LIMITS).map(([label, { expected }]) =>
  [label, Object.fromEntries(expected.map(name => [name, 1]))]));

test("render assertions accept live target components without requiring exact totals", () => {
  const results = validMeasurements();
  results["type 20 characters of a note"].NotesPanel = 20;
  results["mock countdown, 3 ticks"].MockTimer = 4;
  assert.doesNotThrow(() => assertRenderCounts(results));
});

test("a disabled render collector cannot pass with empty measurements", () => {
  const results = Object.fromEntries(Object.keys(LIMITS).map(label => [label, {}]));
  assert.throws(() => assertRenderCounts(results), /did not record PracticeLive/);
  assert.throws(() => assertRenderCounts({}), /Missing render measurement/);
});

for (const [label, { expected, never }] of Object.entries(LIMITS)) {
  test(`${label}: each target must be observed during this measurement`, () => {
    for (const name of expected) {
      for (const value of [undefined, 0, -1, NaN]) {
        const results = validMeasurements();
        results[label][name] = value;
        assert.throws(() => assertRenderCounts(results), /did not record/);
      }
    }
  });
  test(`${label}: layout subscriptions and all existing forbidden renders fail`, () => {
    assert.ok(never.includes("ShellContent"));
    for (const name of never) {
      const results = validMeasurements();
      results[label][name] = 1;
      assert.throws(() => assertRenderCounts(results), /re-rendered/);
    }
  });
}
