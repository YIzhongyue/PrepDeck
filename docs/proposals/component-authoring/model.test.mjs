import assert from "node:assert/strict";
import test from "node:test";
import { findNodeAtLocation, parseTree } from "jsonc-parser";
import { exportComponentPackage, normalizeImportFile, validateComponentPackage } from "../../../packages/shared/src/question-components.ts";
import { formatAnswerText } from "../../../packages/shared/src/answerFormat.ts";
import { fixtures, matchPackage, orderPackage } from "./fixtures.mjs";
import { inspect, moveAnswer, setMatch } from "./model.mjs";

const withoutAnswers = raw => {
  const tree = parseTree(raw);
  const answers = findNodeAtLocation(tree, ["questions", 0, "scoring", "correctAnswers"]);
  return raw.slice(0, answers.offset) + "<ANSWER ARRAY>" + raw.slice(answers.offset + answers.length);
};

test("rich synthetic fixtures validate and resolve actual renderer/answer-summary inputs", () => {
  for (const raw of [fixtures.ordering, fixtures.matching]) {
    assert.deepEqual(validateComponentPackage(JSON.parse(raw)), []);
    const state = inspect(raw);
    assert.equal(state.raw, raw);
    assert.equal(state.preview.content.stimuli[0].revision, 7);
    assert.equal(state.preview.content.assets[0].data, orderPackage.assets[0].data);
    assert.ok(formatAnswerText(state.preview, state.preview.correctAnswers).length);
  }
});

test("order edits swap only answer tokens; inverse move restores source byte for byte", () => {
  const after = moveAnswer(fixtures.ordering, "act", -1);
  assert.deepEqual(inspect(after).preview.correctAnswers, ["act", "read", "check"]);
  assert.equal(withoutAnswers(after), withoutAnswers(fixtures.ordering));
  const beforeData = JSON.parse(fixtures.ordering), afterData = JSON.parse(after);
  afterData.questions[0].scoring.correctAnswers = beforeData.questions[0].scoring.correctAnswers;
  assert.deepEqual(afterData, beforeData, "IDs, content, metadata, scoring method, assets, and every reference remain equal");
  assert.equal(moveAnswer(after, "act", 1), fixtures.ordering);
  assert.equal(moveAnswer(fixtures.ordering, "read", -1), fixtures.ordering);
  assert.ok(after.includes('"points": 1.0000'));
  assert.ok(after.includes("\r\n"));
});

test("order token swaps retain original escaped spelling", () => {
  const token = findNodeAtLocation(parseTree(fixtures.ordering), ["questions", 0, "scoring", "correctAnswers", 0]);
  const raw = fixtures.ordering.slice(0, token.offset) + '"\\u0072ead"' + fixtures.ordering.slice(token.offset + token.length);
  assert.notEqual(raw, fixtures.ordering);
  const after = moveAnswer(raw, "read", 1);
  assert.ok(after.includes('"\\u0072ead"'));
  assert.equal(moveAnswer(after, "read", -1), raw);
});

test("matching preserves answer-array order, other tokens, side identity and many-to-one mappings", () => {
  assert.equal(setMatch(fixtures.matching, "same", "same"), fixtures.matching, "No-op never normalizes JSON");
  const after = setMatch(fixtures.matching, "same", "other");
  assert.deepEqual(inspect(after).preview.correctAnswers, ['["second","same"]', '["same","other"]']);
  assert.equal(withoutAnswers(after), withoutAnswers(fixtures.matching));
  const previous = JSON.parse(fixtures.matching), next = JSON.parse(after);
  next.questions[0].scoring.correctAnswers = previous.questions[0].scoring.correctAnswers;
  assert.deepEqual(next, previous);
  const repeated = setMatch(after, "same", "same");
  assert.equal(repeated, fixtures.matching);
  assert.equal(formatAnswerText(inspect(repeated).preview, inspect(repeated).preview.correctAnswers), "Second entry → Shared category; First entry → Shared category");
});

test("matching no-op preserves outer token escapes; noncanonical inner pairs stay JSON-only", () => {
  const node = findNodeAtLocation(parseTree(fixtures.matching), ["questions", 0, "scoring", "correctAnswers", 1]);
  const before = fixtures.matching.slice(0, node.offset), after = fixtures.matching.slice(node.offset + node.length);
  const token = fixtures.matching.slice(node.offset, node.offset + node.length).replaceAll("same", "\\u0073ame");
  const escaped = before + token + after;
  assert.equal(setMatch(escaped, "same", "same"), escaped);
  assert.ok(inspect(escaped).preview);
  const changed = setMatch(escaped, "same", "other");
  assert.equal(withoutAnswers(changed), withoutAnswers(escaped));
  // The target token intentionally changes spelling; Undo keeps the prior raw
  // draft, rather than trying to synthesize its original spelling from values.
  assert.notEqual(setMatch(changed, "same", "same"), escaped);
  for (const pair of ['[ "same", "same" ]', '["\\u0073ame","same"]']) {
    const raw = before + JSON.stringify(pair) + after;
    assert.equal(inspect(raw).preview, undefined);
    assert.equal(inspect(raw).raw, raw);
    assert.throws(() => setMatch(raw, "same", "same"));
  }
});

test("edited answer semantics survive existing normalization/export/re-import with resolved content", () => {
  for (const raw of [moveAnswer(fixtures.ordering, "check", -1), setMatch(fixtures.matching, "second", "other")]) {
    const source = JSON.parse(raw), normalized = normalizeImportFile(source);
    const exported = exportComponentPackage(source.exam, normalized.questions);
    assert.deepEqual(validateComponentPackage(exported), []);
    assert.deepEqual(normalizeImportFile(exported).questions, normalized.questions);
    assert.deepEqual(exported.assets, source.assets);
    assert.deepEqual(exported.stimuli, source.stimuli);
    assert.deepEqual(exported.questions[0].scoring, source.questions[0].scoring);
    // Existing export is a normalized package, not a source-file serializer.
    assert.equal(exported.source, undefined);
    assert.notEqual(JSON.stringify(exported), raw);
  }
});

test("unsupported, invalid, duplicate-key and malformed input stays exactly available in JSON", () => {
  const inputs = [fixtures.unsupported, fixtures.invalid, fixtures.duplicate, '{"a":',
    fixtures.ordering.replace('"points": 1.0000', '"future": 9007199254740993, "points": 1.0000'),
    fixtures.ordering.replace('"name": "Synthetic authoring discovery"', '"name": "first", "name": "second"'),
    JSON.stringify({ ...orderPackage, questions: [...orderPackage.questions, { ...orderPackage.questions[0], externalId: "another" }] }),
    JSON.stringify({ ...orderPackage, questions: [{ ...orderPackage.questions[0], interaction: { ...orderPackage.questions[0].interaction, type: "choice", multiple: true } }] })
  ];
  for (const raw of inputs) {
    const state = inspect(raw);
    assert.equal(state.preview, undefined);
    assert.equal(state.raw, raw);
    assert.ok(state.reason);
    assert.throws(() => moveAnswer(raw, "read", 1));
    assert.throws(() => setMatch(raw, "same", "other"));
  }
  assert.match(inspect(fixtures.duplicate).reason, /Duplicate object keys/);
});

test("missing references and incomplete/duplicate answers cannot enter the form", () => {
  const variants = [
    data => { data.questions[0].stimulusRefs = ["missing"]; },
    data => { data.questions[0].interaction.options[0].memberRefs = ["missing"]; },
    data => { data.questions[0].scoring.correctAnswers = ["read", "read", "check"]; },
    data => { data.questions[0].scoring.correctAnswers = ["read"]; },
    data => { data.assets = []; }
  ];
  for (const alter of variants) {
    const data = structuredClone(orderPackage); alter(data);
    assert.equal(inspect(JSON.stringify(data)).preview, undefined);
  }
  const match = structuredClone(matchPackage);
  match.questions[0].scoring.correctAnswers = ['["same","other"]'];
  assert.equal(inspect(JSON.stringify(match)).preview, undefined);
});

test("unknown action IDs and invalid moves are refused without accepting a new draft", () => {
  assert.throws(() => moveAnswer(fixtures.ordering, "missing", 1));
  assert.throws(() => moveAnswer(fixtures.ordering, "read", 2));
  assert.throws(() => moveAnswer(fixtures.matching, "same", 1));
  assert.throws(() => setMatch(fixtures.matching, "same", "missing"));
  assert.throws(() => setMatch(fixtures.ordering, "read", "act"));
});
