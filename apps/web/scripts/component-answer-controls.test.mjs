import assert from "node:assert/strict";
import test from "node:test";
import { findNodeAtLocation, parseTree } from "jsonc-parser";
import { exportComponentPackage, normalizeImportFile, validateComponentPackage } from "../../../packages/shared/src/question-components.ts";
import { formatAnswerText } from "../../../packages/shared/src/answerFormat.ts";
import { fixtures, matchPackage, orderPackage } from "../../../docs/proposals/component-authoring/fixtures.mjs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL("../src/lib/componentAnswerControls.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm", mainFields: ["module", "main"] });
const { inspectAnswerControls: inspect, moveAnswer, setMatch } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const withoutAnswers = raw => {
  const tree = parseTree(raw);
  const answers = findNodeAtLocation(tree, ["questions", 0, "scoring", "correctAnswers"]);
  return raw.slice(0, answers.offset) + "<ANSWER ARRAY>" + raw.slice(answers.offset + answers.length);
};

test("rich synthetic fixtures validate and resolve actual renderer/answer-summary inputs", () => {
  for (const raw of [fixtures.ordering, fixtures.matching]) {
    assert.deepEqual(validateComponentPackage(JSON.parse(raw)), []);
    const state = inspect(raw);
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
    assert.ok(state.reason);
    assert.throws(() => moveAnswer(raw, "read", 1));
    assert.throws(() => setMatch(raw, "same", "other"));
  }
  assert.match(inspect(fixtures.duplicate).reason, /duplicate keys/);
  assert.match(inspect(fixtures.duplicate, { issues: [{ path: "$", message: "Duplicate object key" }] }).reason, /duplicate keys/,
    "The independent raw-save validator may already reject duplicates before the controls gate runs");
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

test("count boundaries, expensive sources and unsupported keys remain safe", () => {
  for (const count of [2,20]) {
    const data=structuredClone(orderPackage), item=data.questions[0];
    item.interaction.options=Array.from({length:count},(_,i)=>({id:`id-${i}`,body:[{id:`block-${i}`,type:"paragraph",text:`Option ${i}`}]}));
    item.scoring.correctAnswers=item.interaction.options.map(o=>o.id);
    const raw=JSON.stringify(data), after=moveAnswer(raw,"id-0",1);
    assert.equal(withoutAnswers(after),withoutAnswers(raw));
    assert.equal(inspect(after).preview.correctAnswers.length,count);
  }
  const match=structuredClone(matchPackage); match.questions[0].interaction.left=match.questions[0].interaction.left.slice(0,1);
  match.questions[0].scoring.correctAnswers=['["same","same"]']; assert.ok(inspect(JSON.stringify(match)).preview);
  for (const count of [1,20]) {
    const data=structuredClone(matchPackage), item=data.questions[0];
    item.interaction.left=Array.from({length:count},(_,i)=>({id:`left-${i}`,body:[{id:`left-body-${i}`,type:"paragraph",text:`Left ${i}`}]}));
    item.interaction.right=Array.from({length:20},(_,i)=>({id:`right-${i}`,body:[{id:`right-body-${i}`,type:"paragraph",text:`Right ${i}`}]}));
    item.scoring.correctAnswers=item.interaction.left.map(o=>JSON.stringify([o.id,"right-0"]));
    const raw=JSON.stringify(data);assert.equal(withoutAnswers(setMatch(raw,"left-0","right-19")),withoutAnswers(raw));
  }
  const overLimit=' '.repeat(5*1024*1024)+fixtures.ordering;
  assert.match(inspect(overLimit).reason,/5 MiB/);
  const deep='['.repeat(20000)+'{}'+']'.repeat(20000); assert.ok(inspect(deep).reason);
  const large=structuredClone(orderPackage); large.questions[0].body[0].text='x'.repeat(19000); large.assets[0].data=Buffer.concat([Buffer.from(large.assets[0].data,'base64'),Buffer.alloc(262144-Buffer.from(large.assets[0].data,'base64').length)]).toString('base64');
  const raw=JSON.stringify(large); const state=inspect(raw);
  assert.ok(state.preview,"Maximum-size asset and long valid content remain editable");
  if (state.preview) assert.equal(withoutAnswers(moveAnswer(raw,"read",1)),withoutAnswers(raw));
  else assert.ok(state.reason);
  large.assets[0].data=Buffer.concat([Buffer.from(large.assets[0].data,'base64'),Buffer.alloc(1)]).toString('base64');
  assert.ok(inspect(JSON.stringify(large)).reason,"Asset beyond shared limit stays JSON-only");
  const unknown=fixtures.ordering.replace('"points": 1.0000','"unknown": 9007199254740993123456789, "points": 1.0000');
  assert.ok(inspect(unknown).reason); assert.throws(()=>moveAnswer(unknown,"read",1));
});
