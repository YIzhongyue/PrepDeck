// The mock screen's "Answered N of M" used to count keys in the selection map,
// so deselecting every option on a multiple choice — or clearing a fill-in,
// which leaves [""] behind — still counted as answered, while the question
// palette beside it did not. Both now ask the shared `hasAnswer` predicate,
// which is also what the Worker grades and files wrong answers with.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/mockAnswers.ts', import.meta.url))],
  bundle: true, write: false, platform: 'neutral', format: 'esm', mainFields: ['module', 'main'],
});
const { isMockAnswered, mockAnsweredCount } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

const catalogBy = {
  single: { type: 'single_choice' },
  multi: { type: 'multiple_choice' },
  blank: { type: 'fill_blank' },
  tf: { type: 'true_false' },
};
const state = (mSel) => ({ mQueue: ['single', 'multi', 'blank', 'tf'], mSel, catalogBy });

test('a question with a real selection is answered', () => {
  const s = state({ single: ['A'], multi: ['A', 'B'], blank: ['green'], tf: ['true'] });
  assert.equal(mockAnsweredCount(s), 4);
  assert.ok(['single', 'multi', 'blank', 'tf'].every(id => isMockAnswered(s, id)));
});

test('deselecting every option leaves the question unanswered', () => {
  const s = state({ single: ['A'], multi: [] });
  assert.equal(mockAnsweredCount(s), 1);
  assert.equal(isMockAnswered(s, 'multi'), false);
});

test('a fill-in that was typed into and cleared is unanswered, whitespace included', () => {
  assert.equal(isMockAnswered(state({ blank: [''] }), 'blank'), false);
  assert.equal(isMockAnswered(state({ blank: ['   '] }), 'blank'), false);
  assert.equal(isMockAnswered(state({ blank: ['\n\t'] }), 'blank'), false);
  assert.equal(isMockAnswered(state({ blank: [' g '] }), 'blank'), true);
});

test('an empty string is a legitimate option id for choice types, so it still counts', () => {
  // Only fill_blank answers are free text; a choice type stores option ids and
  // must not be trimmed into non-existence.
  assert.equal(isMockAnswered(state({ single: [''] }), 'single'), true);
});

test('a question never touched is unanswered', () => {
  assert.equal(mockAnsweredCount(state({})), 0);
  assert.equal(isMockAnswered(state({}), 'single'), false);
});

test('the count follows the queue, not the map: a stale selection is not counted', () => {
  // Restoring a draft can carry entries for questions that are no longer in
  // this attempt; the header must agree with the palette, which walks the queue.
  const s = { ...state({ single: ['A'], retired: ['A'] }), mQueue: ['single'] };
  assert.equal(mockAnsweredCount(s), 1);
});

test('a question missing from the catalog falls back to the choice rule', () => {
  const s = { mQueue: ['ghost'], mSel: { ghost: ['A'] }, catalogBy: {} };
  assert.equal(mockAnsweredCount(s), 1);
  assert.equal(mockAnsweredCount({ ...s, mSel: { ghost: [] } }), 0);
});
