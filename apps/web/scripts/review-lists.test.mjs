import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
const { code } = transformSync(readFileSync(new URL('../src/lib/reviewLists.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
const { reviewIds, catalogQuestionIds } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const state = { catalogBy: { A1: {}, A2: {} }, bookmarks: { A1: true, A2: false, B1: true }, wrong: { A1: {}, A2: {}, B1: {} }, mastered: { A2: true } };
test('badges, cards and practice share catalog-scoped IDs with inactive entries removed', () => {
  assert.deepEqual(reviewIds(state, 'bm'), ['A1']);
  assert.deepEqual(reviewIds(state, 'wrong'), ['A1']);
  assert.deepEqual(catalogQuestionIds(['A1', 'B1', 'A1'], state.catalogBy), ['A1']);
});
test('clearing catalog during a switch hides old counts and prevents stale practice input', () => {
  assert.deepEqual(reviewIds({ ...state, catalogBy: {} }, 'bm'), []);
  assert.deepEqual(reviewIds({ ...state, catalogBy: {} }, 'wrong'), []);
  assert.deepEqual(catalogQuestionIds(['A1'], {}), []);
});
test('a newly incorrect answer becomes visible when mastery is cleared', () => {
  assert.deepEqual(reviewIds({ ...state, mastered: { A2: false } }, 'wrong'), ['A1', 'A2']);
});
