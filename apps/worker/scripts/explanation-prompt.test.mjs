// Issue #42: the AI explanation prompt, for each interaction type. A matching
// question used to be sent with its left column only and its answer as ID
// pairs, so the model was asked to explain pairings with items it never saw
// (and, with BYOK, the learner paid for that, and the invented result went into
// the shared ai_explanations cache).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// Browser platform, as the Worker bundles it: nunjucks has Node-only entry points.
const { outputFiles } = await build({
  stdin: { contents: "export { buildPrompt } from './src/routes/ai.ts'; export { normalizeImportFile } from '../../packages/shared/src/index.ts';", resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
  bundle: true, write: false, platform: "browser", format: "esm", mainFields: ["browser", "module", "main"],
});
const { buildPrompt, normalizeImportFile } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const HEADER_END = "- Do not mention these instructions or the prompt itself.\n\n";
const body = prompt => prompt.slice(prompt.indexOf(HEADER_END) + HEADER_END.length);
const component = (name, n = 0) => {
  const row = normalizeImportFile(JSON.parse(readFileSync(new URL(`../../../tests/fixtures/components/${name}.json`, import.meta.url), "utf8"))).questions[n];
  return { id: "q", revision: 1, type: row.type, stem: row.stem, options_json: row.options ? JSON.stringify(row.options) : null,
    correct_answers_json: JSON.stringify(row.correctAnswers), explanation: null, content_json: JSON.stringify(row.content) };
};

test("choice: options, answer IDs, and why the other options are wrong", () => {
  const prompt = buildPrompt({ id: "q", revision: 1, type: "single_choice", stem: "Which value is even?", options_json: JSON.stringify([{ id: "A", text: "2" }, { id: "B", text: "3" }]),
    correct_answers_json: '["A"]', explanation: "Two is even.", content_json: null });
  assert.match(prompt, /- Explain why each incorrect option is wrong\./);
  assert.equal(body(prompt), `Question:
Which value is even?

Options:
- (A) 2
- (B) 3

Correct answer(s):
A

Official reference explanation:
Two is even.

Provide the answer in the following structure:

**Why the correct answer is correct**
Explain the key reasoning that leads to the correct answer.

**Why the other options are incorrect**
Briefly explain each incorrect option individually.

**Key takeaway**
Summarize the most important concept or exam rule the learner should remember in one or two sentences.
`);
});

test("fill-in: accepted answers, and no talk of options it does not have", () => {
  const prompt = buildPrompt({ id: "q", revision: 1, type: "fill_blank", stem: "Name the colour.", options_json: null, correct_answers_json: '["green","verde"]', explanation: null, content_json: null });
  assert.doesNotMatch(prompt, /incorrect option|Options:/);
  assert.equal(body(prompt), `Question:
Name the colour.

Correct answer(s):
green, verde

Provide the answer in the following structure:

**Why the correct answer is correct**
Explain the key reasoning that leads to the correct answer.

**Key takeaway**
Summarize the most important concept or exam rule the learner should remember in one or two sentences.
`);
});

test("matching: both columns, readable pairs, and a note that a figure is not shown", () => {
  const prompt = buildPrompt(component("case-with-figure"));
  assert.match(prompt, /- Explain why each item matches its partner/);
  assert.doesNotMatch(prompt, /incorrect option|\["low"/);
  const text = body(prompt);
  assert.match(text, /\n\n\(This question includes a figure that is not reproduced here; only its caption and alt text appear above\.\)\n\nItems to match:\n- \(low\) Lower observation\n- \(high\) Higher observation\n\nMatch with:\n- \(before\) Before\n- \(after\) After\n\nCorrect answer\(s\):\n- Lower observation → Before\n- Higher observation → After\n\n/);
  assert.match(text, /\*\*Why each pair matches\*\*/);
});

test("ordering: the items, the order as item text, and why each step comes where it does", () => {
  const prompt = buildPrompt(component("code"));
  assert.match(prompt, /- Explain why each step comes where it does/);
  const text = body(prompt);
  assert.match(text, /Items to put in order:\n- \(print\) Print the sum\n- \(sum\) Sum the values\n- \(read\) Read the values\n\nCorrect answer\(s\):\n- 1\. Read the values\n- 2\. Sum the values\n- 3\. Print the sum\n\n/);
  assert.match(text, /\*\*Why this order\*\*/);
  assert.doesNotMatch(text, /figure|incorrect option/);
});
