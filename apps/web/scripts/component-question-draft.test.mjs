import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function bundle(path) {
  // Match the web build's ESM dependency entry points, including jsonc-parser.
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, platform: "node", format: "esm", mainFields: ["module", "main"] });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const { inspectComponentQuestionDraft } = await bundle("../src/lib/componentQuestionDraft.ts");
const { normalizeImportFile, validateImportFile } = await bundle("../../../packages/shared/src/index.ts");
const fixture = name => JSON.parse(readFileSync(new URL(`../../../tests/fixtures/components/${name}.json`, import.meta.url), "utf8"));

test("JSON syntax diagnostics locate tokens even when native errors omit positions", () => {
  const cases = [
    ["x", 1, 1, /Unexpected symbol/],
    ['{"a":x}', 1, 6, /Unexpected symbol/],
    ['{"a" 1}', 1, 6, /colon/],
    ['{"a": true false}', 1, 12, /comma/],
    ['{"a":1,}', 1, 8, /property name/],
    ["[1,]", 1, 4, /JSON value/],
    ['{"a":', 1, 6, /JSON value/],
    ["", 1, 1, /JSON value/],
    [" \r\n\t", 2, 2, /JSON value/],
    ['{\n "a": x\n}', 2, 7, /Unexpected symbol/],
    ['{\r\n  "a": x\r\n}', 2, 8, /Unexpected symbol/],
    ['{\r  "a": x\r}', 2, 8, /Unexpected symbol/],
    ['{ "🦊": x }', 1, 9, /Unexpected symbol/],
    ['{"a":1} false', 1, 9, /after the JSON value/],
    ["01", 1, 2, /after the JSON value/],
    ['{"a":1e}', 1, 6, /number is incomplete/],
    ['\ufeff{}', 1, 1, /Unexpected symbol/],
    ['\u00a0{}', 1, 1, /Unexpected symbol/]
  ];
  for (const [text, line, column, message] of cases) {
    assert.throws(() => JSON.parse(text), SyntaxError);
    const result = inspectComponentQuestionDraft(text);
    assert.equal(result.preview, undefined, text);
    assert.deepEqual(result.issues, [], text);
    assert.equal(result.syntaxError?.line, line, text);
    assert.equal(result.syntaxError?.column, column, text);
    assert.match(result.syntaxError.message, message, text);
  }
});

test("string syntax diagnostics identify the start of the invalid string token", () => {
  for (const [text, message] of [
    ['{"a":"bad\\q"}', /invalid escape/],
    ['{"a":"\\u12xz"}', /invalid Unicode/],
    ['{"a":"abc}', /closing double quote/],
    ['{"a":"abc\n"}', /closing double quote/],
    ['{"a":"abc\t"}', /control character/]
  ]) {
    assert.throws(() => JSON.parse(text), SyntaxError);
    const result = inspectComponentQuestionDraft(text);
    assert.equal(result.preview, undefined);
    assert.equal(result.syntaxError?.line, 1);
    assert.equal(result.syntaxError?.column, 6);
    assert.match(result.syntaxError.message, message);
  }
});

test("comments and trailing commas never become accepted component drafts", () => {
  const valid = JSON.stringify(fixture("code"));
  for (const text of [`/* comment */${valid}`, `// comment\n${valid}`, `${valid.slice(0, -1)},}`]) {
    assert.throws(() => JSON.parse(text), SyntaxError);
    const result = inspectComponentQuestionDraft(text);
    assert.equal(result.preview, undefined);
    assert.ok(result.syntaxError);
    assert.ok(result.syntaxError.line >= 1 && result.syntaxError.column >= 1);
  }
  assert.match(inspectComponentQuestionDraft(`/* comment */${valid}`).syntaxError.message, /Comments are not allowed/);
});

test("valid component drafts retain native JSON semantics and their existing preview data", () => {
  for (const name of ["reading", "code", "combination", "case-with-figure"]) {
    const data = fixture(name);
    data.questions = [data.questions[0]];
    assert.deepEqual(validateImportFile(data).issues, [], name);
    const source = JSON.stringify(data, null, 2);
    for (const text of [source, ` \n${source}\t`]) {
      const result = inspectComponentQuestionDraft(text);
      assert.deepEqual(result.issues, [], name);
      assert.equal(result.syntaxError, undefined, name);
      assert.deepEqual(result.preview, normalizeImportFile(JSON.parse(text)).questions[0], name);
    }
  }
});

test("duplicate raw keys reject saves with decoded identity, paths and both locations", () => {
  const valid = JSON.stringify(fixture("code"));
  const cases = [
    ['{\r\n "a":1,\r\n "\\u0061":2}', '$["a"]', 'line 3, column 2', 'line 2, column 2'],
    ['{"outer":[{"key":1,"key":2}]}', '$["outer"][0]["key"]', 'line 1, column 20', 'line 1, column 12'],
    ['{"__proto__":1,"__proto__":2}', '$["__proto__"]', 'line 1, column 16', 'line 1, column 2']
  ];
  for (const [text, path, repeated, first] of cases) {
    const result = inspectComponentQuestionDraft(text);
    assert.equal(result.preview, undefined);
    assert.equal(result.syntaxError, undefined);
    assert.equal(result.issues[0].path, path);
    assert.ok(result.issues[0].message.includes(repeated));
    assert.ok(result.issues[0].message.includes(first));
  }
  const duplicate = valid.replace('"schemaVersion":"2.0"', '"schemaVersion":"ignored","schemaVersion":"2.0"');
  assert.deepEqual(validateImportFile(JSON.parse(duplicate)).issues, [], "Other import/API parsed-object behavior is unchanged");
  assert.match(inspectComponentQuestionDraft(duplicate).issues[0].message, /Duplicate object key/);
  assert.ok(inspectComponentQuestionDraft(valid).preview, "Corrected source is saveable");
  const unknown = valid.replace(/}$/, ',"unknown":{"first":{"x":1},"second":{"x":2}}}');
  assert.ok(!inspectComponentQuestionDraft(unknown).issues.some(issue => /Duplicate object key/.test(issue.message)), "Same keys in separate objects are legal");
  const nested = unknown.replace('"x":2', '"x":2,"x":3');
  assert.equal(inspectComponentQuestionDraft(nested).issues[0].path, '$["unknown"]["second"]["x"]');
  const many = '{' + Array.from({length:100}, ()=>'"a":1').join(',') + '}';
  assert.equal(inspectComponentQuestionDraft(many).issues.length, 51);
  const deep = '['.repeat(20000) + '{}' + ']'.repeat(20000);
  assert.equal(inspectComponentQuestionDraft(deep).preview, undefined);
  assert.ok(inspectComponentQuestionDraft(deep).issues.length);
});

test("shared structural and semantic validation paths and messages stay verbatim", () => {
  const invalid = [];
  const missingInteraction = fixture("code"); delete missingInteraction.questions[0].interaction; invalid.push(missingInteraction);
  const duplicateBlock = fixture("code"); duplicateBlock.questions[0].body.push(structuredClone(duplicateBlock.questions[0].body[0])); invalid.push(duplicateBlock);
  const unknownStimulus = fixture("code"); unknownStimulus.questions[0].stimulusRefs = ["missing"]; invalid.push(unknownStimulus);
  const unknownAsset = fixture("case-with-figure"); unknownAsset.questions[0].body.find(block => block.type === "figure").assetId = "missing"; invalid.push(unknownAsset);
  const invalidScoring = fixture("code"); invalidScoring.questions[0].scoring.correctAnswers = ["missing"]; invalid.push(invalidScoring);
  let sawStructuralPath = false, sawSemanticPath = false;
  for (const data of invalid) {
    const expected = validateImportFile(data).issues;
    assert.ok(expected.length);
    sawStructuralPath ||= expected.some(issue => issue.path.startsWith("$/"));
    sawSemanticPath ||= expected.some(issue => issue.path.startsWith("$."));
    const result = inspectComponentQuestionDraft(JSON.stringify(data));
    assert.deepEqual(result.issues, expected);
    assert.equal(result.syntaxError, undefined);
    assert.equal(result.preview, undefined);
  }
  assert.ok(sawStructuralPath && sawSemanticPath);
});

test("component editor keeps its schema and single-question constraints", () => {
  const legacy = { schemaVersion: "1.0", exam: { id: "exam", name: "Legacy" }, questions: [
    { externalId: "legacy-1", type: "single_choice", stem: "Choose A.", options: [{ id: "A", text: "A" }, { id: "B", text: "B" }], correctAnswers: ["A"] }
  ] };
  assert.deepEqual(validateImportFile(legacy).issues, []);
  for (const version of ["1.0", "3.0", undefined]) {
    const data = { ...legacy, schemaVersion: version };
    const result = inspectComponentQuestionDraft(JSON.stringify(data));
    assert.equal(result.preview, undefined);
    assert.equal(result.syntaxError, undefined);
    assert.deepEqual(result.issues, [{ path: "$.schemaVersion", message: 'must be "2.0"' }]);
  }
  const twoQuestions = fixture("reading");
  assert.deepEqual(validateImportFile(twoQuestions).issues, []);
  const result = inspectComponentQuestionDraft(JSON.stringify(twoQuestions));
  assert.equal(result.preview, undefined);
  assert.deepEqual(result.issues, [{ path: "$.questions", message: "must contain exactly one question in this editor" }]);
  const empty = fixture("code"); empty.questions = [];
  assert.ok(inspectComponentQuestionDraft(JSON.stringify(empty)).issues.some(issue => issue.path === "$.questions" && /exactly one/.test(issue.message)));
  for (const data of [null, [], true, 3, "text"]) {
    const root = inspectComponentQuestionDraft(JSON.stringify(data));
    assert.equal(root.preview, undefined);
    assert.equal(root.syntaxError, undefined);
    assert.deepEqual(root.issues, [{ path: "$", message: "must be an object" }]);
  }
});

test("diagnostic parser limits cannot crash an invalid draft or fabricate a location", () => {
  const text = "[".repeat(20000) + "x" + "]".repeat(20000);
  assert.throws(() => JSON.parse(text), SyntaxError);
  const result = inspectComponentQuestionDraft(text);
  assert.equal(result.preview, undefined);
  assert.deepEqual(result.issues, []);
  assert.ok(result.syntaxError?.message);
  if (result.syntaxError.line === undefined) {
    assert.equal(result.syntaxError.column, undefined);
    assert.match(result.syntaxError.message, /location could not be determined/);
  } else {
    // This remains valid if a later diagnostic parser can handle this depth.
    assert.equal(result.syntaxError.line, 1);
    assert.equal(result.syntaxError.column, 20001);
  }
});
