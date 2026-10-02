// Issue #106: Learning, Practice and Mock fetch a small window of upcoming
// questions, and Learning reuses a detail it already holds instead of asking
// for it again when the user reaches that question.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/questionPrefetch.ts', import.meta.url))],
  bundle: true, write: false, platform: 'neutral', format: 'esm', mainFields: ['module', 'main'],
});
const { QUESTION_PREFETCH_AHEAD, prefetchWindow, learningDetailReusable } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

const queue = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];

test('the window is the next few questions after the open one', () => {
  assert.equal(QUESTION_PREFETCH_AHEAD, 3);
  assert.deepEqual(prefetchWindow(queue, 0), ['q2', 'q3', 'q4']);
  assert.deepEqual(prefetchWindow(queue, 1), ['q3', 'q4', 'q5']);
});

test('the window stops at the end of the session and never reaches back', () => {
  assert.deepEqual(prefetchWindow(queue, 4), ['q6']);
  assert.deepEqual(prefetchWindow(queue, 5), []);
  assert.deepEqual(prefetchWindow(queue, -1), []);
  assert.deepEqual(prefetchWindow(queue, 0, 0), []);
  assert.deepEqual(prefetchWindow(queue, 0, 10), ['q2', 'q3', 'q4', 'q5', 'q6']);
});

const question = { id: 'q1', revision: 2, hasContent: false };
const ready = { status: 'ready', correctAnswers: ['A'], history: [], questionRevision: 2, activityRevision: 5 };

test('a ready detail for the same revision and history is reused', () => {
  assert.equal(learningDetailReusable(ready, question, 5), true);
  assert.equal(learningDetailReusable(ready, { ...question, hasContent: true, content: { version: '1.0' } }, 5), true);
});

test('a detail still loading, failed or missing is not reused', () => {
  assert.equal(learningDetailReusable(undefined, question, 5), false);
  assert.equal(learningDetailReusable({ status: 'loading' }, question, 5), false);
  assert.equal(learningDetailReusable({ status: 'error', error: 'x' }, question, 5), false);
});

test('an edited question, newer answers or missing content fetch it again', () => {
  assert.equal(learningDetailReusable(ready, { ...question, revision: 3 }, 5), false);
  assert.equal(learningDetailReusable(ready, question, 6), false);
  assert.equal(learningDetailReusable(ready, { ...question, hasContent: true }, 5), false);
});
