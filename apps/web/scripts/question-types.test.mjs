// Practice, Mock, Learning and the Admin list each spelled the question type
// out themselves. Fill-in questions read "Single choice" in Practice and Mock,
// true/false read "Single choice" in all three study modes, and Admin printed a
// fourth casing of its own — so an author and a learner saw different words for
// the same question. One table, checked here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const { code } = transformSync(readFileSync(new URL('../src/lib/questionTypes.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
const { questionTypeLabel } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('every question type has its own label', () => {
  assert.equal(questionTypeLabel({ type: 'single_choice' }), 'Single choice');
  assert.equal(questionTypeLabel({ type: 'true_false' }), 'True / false');
  assert.equal(questionTypeLabel({ type: 'fill_blank' }), 'Fill in the blank');
  assert.equal(questionTypeLabel({ type: 'multiple_choice', chooseCount: 3 }), 'Choose 3');
});

test('a multiple choice with no stated count asks for one', () => {
  assert.equal(questionTypeLabel({ type: 'multiple_choice', chooseCount: null }), 'Choose 1');
  assert.equal(questionTypeLabel({ type: 'multiple_choice' }), 'Choose 1');
  assert.equal(questionTypeLabel({ type: 'multiple_choice', chooseCount: 0 }), 'Choose 1');
});

test('no two types share a label', () => {
  const labels = ['single_choice', 'true_false', 'fill_blank', 'multiple_choice'].map(type => questionTypeLabel({ type }));
  assert.equal(new Set(labels).size, labels.length);
});
