import assert from "node:assert/strict";

// Positive targets prove that the hook observed the interaction, rather than
// allowing a broken/empty collector to satisfy every forbidden-render check.
// Counts deliberately have no exact totals: React can batch work differently.
export const LIMITS = {
  "pick a practice option": { expected: ["PracticeLive"], never: ["Shell", "ShellContent", "Sidebar", "ExamSelector"] },
  "check a practice answer": { expected: ["PracticeLive"], never: ["Shell", "ShellContent", "Sidebar", "ExamSelector"] },
  "type 20 characters of a note": { expected: ["NotesPanel"], never: ["Shell", "ShellContent", "Sidebar", "PracticeLive", "ExplanationPanel", "OptionRow"] },
  "mock countdown, 3 ticks": { expected: ["MockTimer"], never: ["Shell", "ShellContent", "Sidebar", "ExamSelector", "MockLive", "OptionRow", "QuestionContent"] },
};

export function assertRenderCounts(results) {
  for (const [label, { expected, never }] of Object.entries(LIMITS)) {
    const counts = results[label];
    assert.ok(counts, `Missing render measurement: ${label}`);
    for (const name of expected) {
      assert.ok(Number.isFinite(counts[name]) && counts[name] > 0,
        `${label} did not record ${name}; render collection may be inactive`);
    }
    const rendered = never.filter(name => counts[name]);
    assert.deepEqual(rendered, [], `${label} re-rendered ${rendered.join(", ")}`);
  }
}
