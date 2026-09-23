import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { componentProjection, exportComponentPackage, MissingExportExternalIdError, normalizeImportFile, validateComponentPackage } from './question-components.ts';
import { validateImportFile, validateQuestionRow } from './import-validate.ts';
import { isAnswerCorrect } from './grading.ts';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../tests/fixtures/components/${name}.json`, import.meta.url), 'utf8'));
for (const name of ['reading','code','case-with-figure','combination']) test(`component package round-trips ${name} without flattening`, () => {
  const file = fixture(name);
  assert.deepEqual(validateImportFile(file).issues, []);
  const normalized = normalizeImportFile(file);
  for (const row of normalized.questions) assert.deepEqual(validateQuestionRow(row, '$'), []);
  const output = exportComponentPackage(file.exam, normalized.questions);
  assert.deepEqual(validateComponentPackage(output), []);
  assert.deepEqual(normalizeImportFile(output), normalized);
  assert.equal(output.questions[0].interaction.type, file.questions[0].interaction.type);
});
test('invalid references, unsupported interactions, missing cells and inconsistent projections are rejected', () => {
  for (const mutate of [
    (f: any) => f.questions[0].interaction.type = 'execute-code',
    (f: any) => f.questions[0].interaction.options[0].memberRefs = ['unknown'],
    (f: any) => f.questions[0].body[2].rows[0].pop(),
    (f: any) => f.questions[0].scoring.correctAnswers = ['not-an-option'],
    (f: any) => f.questions[0].body[0].id = f.questions[0].body[1].id,
  ]) { const file = fixture('combination'); mutate(file); assert.ok(validateImportFile(file).issues.length); }
  const row = normalizeImportFile(fixture('combination')).questions[0]!;
  row.stem = 'edited only the projection'; assert.ok(validateQuestionRow(row, '$').length);
});
test('ordering preserves sequence; matching compares pairs; combinations remain single-choice', () => {
  assert.equal(isAnswerCorrect('ordering',['B','A'],['A','B']),false);
  assert.equal(isAnswerCorrect('ordering',['A','B'],['A','B']),true);
  assert.equal(isAnswerCorrect('matching',['["B","2"]','["A","1"]'],['["A","1"]','["B","2"]']),true);
  const file=fixture('code'); file.questions[0].scoring.correctAnswers=['read','sum','sum']; assert.ok(validateImportFile(file).issues.length);
  const row=normalizeImportFile(fixture('combination')).questions[0]!;
  assert.equal(row.type,'single_choice'); assert.deepEqual(row.correctAnswers,['A']);
  assert.match(row.options![0]!.text,/Isolate/);
});
test('assets and stimuli cannot be silently omitted, overwritten, or leaked into another question', () => {
  const file=fixture('reading'); file.questions[0].stimulusRefs=['missing']; assert.ok(validateImportFile(file).issues.length);
  const image=fixture('case-with-figure'); image.assets[0].mediaType='image/svg+xml'; assert.ok(validateImportFile(image).issues.length);
  const rows=normalizeImportFile(fixture('reading')).questions;
  rows[1]!.content=structuredClone(rows[1]!.content!); rows[1]!.content.stimuli[0]!.revision=2;
  assert.throws(()=>exportComponentPackage({id:'exam',name:'Exam'},rows),/Conflicting stimulus/);
  assert.ok(!JSON.stringify(rows[0]!.content).includes('correctAnswers'));
  assert.deepEqual(componentProjection(rows[0]!.content!).type,'single_choice');
});
test('legacy export preserves true/false and rejects malformed snapshots without throwing during validation', () => {
  const file = exportComponentPackage({ id: 'exam', name: 'Exam' }, [{ externalId: 'binary', type: 'true_false', stem: 'Two is even.', options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }], correctAnswers: ['true'] }]);
  assert.deepEqual(validateImportFile(file).issues, []);
  assert.equal(normalizeImportFile(file).questions[0]!.type, 'true_false');
  for (const content of [null, [], {}, { version: '1.0', stimuli: [null], assets: [] }]) {
    const row = { ...normalizeImportFile(fixture('code')).questions[0]!, content };
    assert.ok(validateQuestionRow(row, '$').length);
  }
  assert.ok(validateImportFile(normalizeImportFile(fixture('code'))).issues.some(i => /schemaVersion 2.0/.test(i.message)));
});
test('storage budget includes both structured content and the persisted import baseline', () => {
  const file = fixture('case-with-figure');
  const pixels = Buffer.from(file.assets[0].data, 'base64');
  const data = Buffer.concat([pixels, Buffer.alloc(225000 - pixels.length)]).toString('base64');
  file.assets = [0, 1, 2].map(n => ({ id: `chart-${n}`, mediaType: 'image/png', data }));
  file.questions[0].body = [file.questions[0].body[0], ...file.assets.map((a: any) => ({ id: a.id, type: 'figure', assetId: a.id, alt: 'Synthetic chart' }))];
  assert.ok(validateComponentPackage(file).some(i => /storage budget/.test(i.message)));
});

test('export requires stored external IDs instead of inventing round-trip identities', () => {
  const legacy = { externalId: 'stable', type: 'fill_blank' as const, stem: 'Complete this.', correctAnswers: ['answer'] };
  const structured = normalizeImportFile(fixture('reading')).questions[0]!;
  for (const row of [legacy, structured]) {
    for (const externalId of [undefined, '', ' \t']) {
      assert.throws(() => exportComponentPackage({ id: 'exam', name: 'Exam' }, [legacy, { ...row, externalId }]), MissingExportExternalIdError);
    }
  }
  assert.equal(exportComponentPackage({ id: 'exam', name: 'Exam' }, [legacy]).questions[0]!.externalId, 'stable');
});

test('component import, content validation and export preserve explicit review state', () => {
  for (const needsReview of [true, false]) {
    const file = fixture('reading');
    file.questions[0].needsReview = needsReview;
    assert.deepEqual(validateImportFile(file).issues, []);
    const normalized = normalizeImportFile(file);
    assert.equal(normalized.questions[0]!.needsReview, needsReview);
    assert.deepEqual(validateQuestionRow(normalized.questions[0], '$'), []);
    const exported = exportComponentPackage(file.exam, normalized.questions);
    assert.equal(exported.questions[0]!.needsReview, needsReview);
    assert.deepEqual(normalizeImportFile(exported), normalized);
    const legacy = { externalId: 'legacy', type: 'fill_blank' as const, stem: 'Complete this.', correctAnswers: ['answer'], needsReview };
    assert.equal(exportComponentPackage(file.exam, [legacy]).questions[0]!.needsReview, needsReview);
  }
  const invalid = fixture('reading'); invalid.questions[0].needsReview = 'true';
  assert.ok(validateImportFile(invalid).issues.length);
  const omitted = normalizeImportFile(fixture('code')).questions[0]!;
  for (const field of ['needsReview', 'explanation', 'tags', 'difficulty', 'points']) assert.equal(Object.hasOwn(omitted, field), false);
});
