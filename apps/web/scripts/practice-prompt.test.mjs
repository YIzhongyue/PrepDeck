import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/practicePrompt.ts", import.meta.url), "utf8");
const { code } = transformSync(source, {
  loader: "ts", format: "esm", target: "es2022"
});
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
