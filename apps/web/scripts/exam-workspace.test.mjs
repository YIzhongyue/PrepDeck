import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
const { code } = transformSync(readFileSync(new URL('../src/lib/examWorkspace.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
const { WorkspaceRequests, storedExam, storeExam } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('A → B → A never revives an old visit; repeated detail reads reject older completions', () => {
  const requests = new WorkspaceRequests(); const firstA = requests.capture();
  requests.invalidate(); const b = requests.capture(); requests.invalidate(); const secondA = requests.capture();
  assert.equal(firstA(), false); assert.equal(b(), false); assert.equal(secondA(), true);
  const old = requests.capture('detail:A1'); const latest = requests.capture('detail:A1');
  assert.equal(old(), false); assert.equal(latest(), true);
  requests.invalidate(); assert.equal(latest(), false);
});
test('write order is preserved and drain waits for the latest queued draft after a failure', async () => {
  const requests = new WorkspaceRequests(), writes = [];
  let release; const gate = new Promise(resolve => { release = resolve; });
  const first = requests.write('mock:A', async () => { await gate; writes.push('first'); throw new Error('offline'); });
  const rejected = assert.rejects(first, /offline/);
  const second = requests.write('mock:A', async () => { writes.push('latest'); });
  let drained = false; const drain = requests.drain().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false); release();
  await Promise.all([rejected, second, drain]); assert.deepEqual(writes, ['first', 'latest']); assert.equal(drained, true);
});
test('last selected exam is private to each account and storage denial is harmless', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  storeExam('u1', 'A'); storeExam('u2', 'B'); assert.equal(storedExam('u1'), 'A'); assert.equal(storedExam('u2'), 'B');
  storeExam('u1', null); assert.equal(storedExam('u1'), null);
  globalThis.localStorage = { getItem() { throw Error('disabled'); }, setItem() { throw Error('disabled'); } };
  assert.equal(storedExam('u1'), null); assert.doesNotThrow(() => storeExam('u1', 'A'));
  delete globalThis.localStorage;
});
