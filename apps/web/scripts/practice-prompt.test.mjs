import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundled: the prompt builder formats structured answers with @prepdeck/shared.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/practicePrompt.ts", import.meta.url))],
  bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"], target: "es2022",
});
const code = outputFiles[0].text;
const { buildLearningPrompt, buildPracticePrompt, copyText } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

const question = {
  id: "q1", externalId: "EX-1", sequenceNumber: 1, type: "single_choice",
  chooseCount: null, tags: [], diff: null, stem: "Which service stores objects?",
  options: [{ id: "A", text: "Object storage" }, { id: "B", text: "Compute" }]
};
const answerKey = { correctAnswers: ["A"], explanation: "  Objects belong in object storage.  " };

test("Learning prompt contains the complete question and official answer without an attempt", () => {
  assert.equal(buildLearningPrompt(question, "Cloud fundamentals", answerKey), `# Learning question review

**Exam:** Cloud fundamentals
**Question ID:** EX-1
**Question type:** single choice

## Question

Which service stores objects?

## Options

- **A.** Object storage
- **B.** Compute

## Correct answer

- **A.** Object storage

## Official explanation

Objects belong in object storage.

---
Please explain why the correct answer is right, why the other options are wrong when applicable, and clarify the underlying concepts needed to solve this question.`);
});

test("Learning multiple choice includes every option and all correct answers", () => {
  const prompt = buildLearningPrompt({ ...question, type: "multiple_choice", chooseCount: 2 }, "Cloud", {
    correctAnswers: ["A", "B"], explanation: null
  });
  assert.match(prompt, /\*\*Question type:\*\* multiple choice/);
  assert.match(prompt, /## Options\n\n- \*\*A\.\*\* Object storage\n- \*\*B\.\*\* Compute/);
  assert.match(prompt, /## Correct answer\n\n- \*\*A\.\*\* Object storage\n- \*\*B\.\*\* Compute/);
  assert.doesNotMatch(prompt, /## My answer|## Result|## Official explanation/);
});

for (const options of [null, []]) {
  test(`Learning free response with ${options === null ? "null" : "empty"} options includes answer format and accepted variants`, () => {
    const prompt = buildLearningPrompt({ ...question, type: "fill_blank", externalId: null, options, stem: "Name the protocol." }, "Networking", {
      correctAnswers: ["HTTPS", "Hypertext Transfer Protocol Secure"], explanation: " \n "
    });
    assert.match(prompt, /## Answer format\n\nFree text \(fill in the blank\)/);
    assert.match(prompt, /## Correct answer\n\n- HTTPS\n- Hypertext Transfer Protocol Secure/);
    assert.doesNotMatch(prompt, /## Options|## My answer|## Result|## Official explanation|Question ID|undefined|null/);
  });
}

test("Learning true/false preserves the available choices", () => {
  const prompt = buildLearningPrompt({ ...question, type: "true_false", options: [{ id: "T", text: "True" }, { id: "F", text: "False" }] }, "Cloud", {
    correctAnswers: ["F"], explanation: null
  });
  assert.match(prompt, /\*\*Question type:\*\* true false/);
  assert.match(prompt, /## Correct answer\n\n- \*\*F\.\*\* False/);
});

test("Practice prompt remains unchanged, including the user's answer and result", () => {
  assert.equal(buildPracticePrompt(question, ["B"], { ...answerKey, isCorrect: false }), `# Practice question review

**Question ID:** EX-1
**Question type:** single choice

## Question

Which service stores objects?

## Options

- **A.** Object storage
- **B.** Compute

## My answer

- **B.** Compute

## Correct answer

- **A.** Object storage

## Result

Incorrect

## Official explanation

Objects belong in object storage.

---
Please explain why the correct answer is right and why my answer is right or wrong. Clarify the underlying concepts and address each relevant option.`);
});

test("Practice retains correct, unanswered and free-response behavior", () => {
  const prompt = buildPracticePrompt({ ...question, type: "fill_blank", options: null }, [], {
    correctAnswers: ["HTTPS"], explanation: null, isCorrect: true
  });
  assert.match(prompt, /## Options\n\n- No options \(free-response question\)/);
  assert.match(prompt, /## My answer\n\n- No answer provided/);
  assert.match(prompt, /## Correct answer\n\n- HTTPS/);
  assert.match(prompt, /## Result\n\nCorrect/);
  assert.doesNotMatch(prompt, /## Official explanation/);
});

function mockGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

test("copyText writes the complete prompt with the Clipboard API", async (t) => {
  let copied;
  mockGlobal(t, "navigator", { clipboard: { writeText: async (text) => { copied = text; } } });
  const prompt = buildLearningPrompt(question, "Cloud", answerKey);
  await copyText(prompt);
  assert.equal(copied, prompt);
});

test("copyText surfaces Clipboard API rejection for UI failure feedback", async (t) => {
  mockGlobal(t, "navigator", { clipboard: { writeText: async () => { throw new Error("Permission denied"); } } });
  await assert.rejects(copyText("prompt"), /Permission denied/);
});

for (const succeeds of [true, false]) {
  test(`copyText fallback ${succeeds ? "copies" : "reports failure"} and removes its textarea`, async (t) => {
    const calls = [];
    const textarea = {
      value: "", style: {},
      setAttribute: (name, value) => calls.push([name, value]),
      select: () => calls.push("select"),
      remove: () => calls.push("remove")
    };
    mockGlobal(t, "navigator", {});
    mockGlobal(t, "document", {
      createElement: (tag) => { assert.equal(tag, "textarea"); return textarea; },
      body: { appendChild: (element) => { assert.equal(element, textarea); calls.push("append"); } },
      execCommand: (command) => { calls.push(command); return succeeds; }
    });
    if (succeeds) await copyText("Markdown prompt");
    else await assert.rejects(copyText("Markdown prompt"), /Clipboard copy failed/);
    assert.equal(textarea.value, "Markdown prompt");
    assert.deepEqual(calls, [["readonly", ""], "append", "select", "copy", "remove"]);
  });
}

test("copyText discards its hidden textarea when the legacy clipboard API throws", async (t) => {
  let removed = false;
  const textarea = { value: "", style: {}, setAttribute() {}, select() {}, remove() { removed = true; } };
  mockGlobal(t, "navigator", {});
  mockGlobal(t, "document", {
    createElement: () => textarea,
    body: { appendChild() {} },
    execCommand() { throw new Error("Legacy clipboard unavailable"); }
  });
  await assert.rejects(copyText("sensitive fixture"), /Legacy clipboard unavailable/);
  assert.equal(removed, true);
});

// Issue #42: a matching question's options are its left column only, and its
// answer key is stored as ["left","right"] ID pairs, so the prompt used to name
// right-hand items it never showed. Ordering answers were bare IDs too.
const shared = await (async () => {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url))], bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"] });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
})();
const { readFileSync } = await import("node:fs");
const component = name => {
  const row = shared.normalizeImportFile(JSON.parse(readFileSync(new URL(`../../../tests/fixtures/components/${name}.json`, import.meta.url), "utf8"))).questions[0];
  return { row, question: { id: name, externalId: row.externalId, sequenceNumber: 1, type: row.type, chooseCount: null, tags: [], diff: null, stem: row.stem, hasContent: true, content: row.content, options: row.options ?? null } };
};

test("a matching prompt lists both columns and the answer as readable pairs", () => {
  const { row, question } = component("case-with-figure");
  const prompt = buildLearningPrompt(question, "Evidence", { correctAnswers: row.correctAnswers, explanation: null });
  assert.match(prompt, /## Items to match\n\n- \*\*low\.\*\* Lower observation\n- \*\*high\.\*\* Higher observation/);
  assert.match(prompt, /## Match with\n\n- \*\*before\.\*\* Before\n- \*\*after\.\*\* After/);
  assert.match(prompt, /## Correct answer\n\n- Lower observation → Before\n- Higher observation → After/);
  assert.match(prompt, /includes a figure that is not reproduced here/);
  assert.match(prompt, /why each pair matches/);
  assert.doesNotMatch(prompt, /\["low"|why the other options are wrong/);
  const practice = buildPracticePrompt(question, ['["low","after"]', '["high","before"]'], { correctAnswers: row.correctAnswers, explanation: null, isCorrect: false });
  assert.match(practice, /## My answer\n\n- Lower observation → After\n- Higher observation → Before/);
});

test("an ordering prompt shows the order as item text", () => {
  const { row, question } = component("code");
  const prompt = buildLearningPrompt(question, "Code", { correctAnswers: row.correctAnswers, explanation: null });
  assert.match(prompt, /## Items to put in order/);
  assert.match(prompt, /## Correct answer\n\n- 1\. Read the values\n- 2\. Sum the values\n- 3\. Print the sum/);
  assert.match(prompt, /why this order is correct/);
  assert.doesNotMatch(prompt, /figure/);
});

// Review of #69 and #72: a matching target that is code keeps its line breaks
// and indentation, and reaches a Markdown reader as a code block. A fence right
// after a "**R.**" label is paragraph text, not a code block, so these checks
// parse the prompt the way a chat app renders it rather than compare strings.
test("a matching prompt keeps code targets intact, as code blocks a Markdown reader sees", async () => {
  const { marked } = await import("marked");
  const outside = "if enabled:\n    start()\nstop()", inside = "if enabled:\n    start()\n    stop()";
  const snippet = (id, text) => ({ id, body: [{ id: `code-${id}`, type: "code", language: "python", text }] });
  const item = (id, text) => ({ id, body: [{ id: `p-${id}`, type: "paragraph", text }] });
  const row = shared.normalizeImportFile({
    schemaVersion: "2.0", exam: { id: "exam", name: "code" }, assets: [],
    questions: [{ externalId: "m1", body: [{ id: "prompt", type: "paragraph", text: "Match each behaviour to its code." }],
      interaction: { id: "response", type: "match",
        left: [item("always", "stop() always runs"), item("guarded", "stop() runs only when enabled")],
        right: [snippet("outside", outside), snippet("inside", inside)] },
      scoring: { method: "exact", correctAnswers: ['["always","outside"]', '["guarded","inside"]'] } }],
  }).questions[0];
  const question = { id: "m1", externalId: "m1", sequenceNumber: 1, type: row.type, chooseCount: null, tags: [], diff: null, stem: row.stem, hasContent: true, content: row.content, options: row.options };
  const prompt = buildPracticePrompt(question, ['["always","inside"]', '["guarded","outside"]'], { correctAnswers: row.correctAnswers, explanation: null, isCorrect: false });

  // Each section's list, as Markdown sees it: every item's leading text and its code blocks.
  const tokens = marked.lexer(prompt);
  const listAfter = heading => {
    const at = tokens.findIndex(t => t.type === "heading" && t.text === heading);
    const list = tokens.slice(at + 1).find(t => t.type === "list" || t.type === "heading");
    assert.equal(list?.type, "list", `${heading} is followed by a list`);
    return list.items.map(entry => {
      const code = [];
      marked.walkTokens(entry.tokens, t => { if (t.type === "code") code.push({ lang: t.lang, text: t.text }); });
      return { lead: entry.tokens.find(t => t.type === "text" || t.type === "paragraph")?.text.split("\n")[0], code };
    });
  };
  assert.deepEqual(listAfter("Match with"), [
    { lead: "**outside.**", code: [{ lang: "python", text: outside }] },
    { lead: "**inside.**", code: [{ lang: "python", text: inside }] },
  ]);
  assert.deepEqual(listAfter("My answer").map(entry => entry.code.map(c => c.text)), [[inside], [outside]]);
  assert.deepEqual(listAfter("Correct answer").map(entry => entry.code.map(c => c.text)), [[outside], [inside]]);
  const empty = []; marked.walkTokens(tokens, t => { if (t.type === "code" && !t.text) empty.push(t.raw); });
  assert.deepEqual(empty, [], "no stray fence opens an empty code block");
  assert.doesNotMatch(prompt, /if enabled: start\(\) stop\(\)/);
});

test("an ordering prompt keeps a code step as a code block under its number", async () => {
  const { marked } = await import("marked");
  const step = "for x in xs:\n    total += x";
  const row = shared.normalizeImportFile({
    schemaVersion: "2.0", exam: { id: "exam", name: "code" }, assets: [],
    questions: [{ externalId: "o1", body: [{ id: "prompt", type: "paragraph", text: "Order the steps." }],
      interaction: { id: "response", type: "order", options: [
        { id: "sum", body: [{ id: "c-sum", type: "code", language: "python", text: step }] },
        { id: "print", body: [{ id: "p-print", type: "paragraph", text: "Print the total" }] }] },
      scoring: { method: "exact", correctAnswers: ["sum", "print"] } }],
  }).questions[0];
  const question = { id: "o1", externalId: "o1", sequenceNumber: 1, type: row.type, chooseCount: null, tags: [], diff: null, stem: row.stem, hasContent: true, content: row.content, options: row.options };
  const prompt = buildLearningPrompt(question, "Evidence", { correctAnswers: row.correctAnswers, explanation: null });
  const code = []; marked.walkTokens(marked.lexer(prompt), t => { if (t.type === "code") code.push(t.text); });
  assert.deepEqual(code, [step, step], "the step, once among the items and once in the correct order");
  assert.match(prompt, /## Correct answer\n\n- 1\. ```python\n     for x in xs:\n         total \+= x\n     ```\n- 2\. Print the total/);
});
