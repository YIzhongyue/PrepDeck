// Real Markdown rendering/capture after legacy export and component re-import.
// PLAYWRIGHT_MODULE/BROWSER_EXECUTABLE may reuse installed browser tooling.
import './question-prose.browser.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { exportComponentPackage, normalizeImportFile } from '../../../packages/shared/src/question-components.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const legacy = {
  externalId: 'legacy', type: 'single_choice', stem: '# **Legacy**\n\nRead the **marked\nstem** and `code`.\n\n- Final choice.',
  options: [{ id: 'A', text: 'Use **markedオプ\nション** safely.' }, { id: 'B', text: 'An alternative.' }], correctAnswers: ['A'],
};
const exported = exportComponentPackage({ id: 'exam', name: 'Exam' }, [legacy]);
const row = normalizeImportFile(exported).questions[0];
assert.equal(row.stem, legacy.stem); assert.deepEqual(row.options, legacy.options);
const complex = normalizeImportFile(JSON.parse(readFileSync(new URL('../../../tests/fixtures/components/case-with-figure.json', import.meta.url), 'utf8'))).questions[0];
const stemStart = legacy.stem.indexOf('marked'), optionStart = legacy.options[0].text.indexOf('marked');
const optionLength = 'markedオプ\nション'.length;
let annotations = [
  { id: 'stem-mark', questionId: 'legacy', targetType: 'stem', targetRef: null, rangeStart: stemStart, rangeEnd: stemStart + 11, style: 'hl1', note: 'Stem note' },
  { id: 'option-mark', questionId: 'legacy', targetType: 'option', targetRef: 'A', rangeStart: optionStart, rangeEnd: optionStart + optionLength, style: 'underline', note: 'Option note' },
];
const deleted = [], errors = [];
const { outputFiles } = await build({ stdin: { contents: `
  import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
  import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext';
  import QuestionContent from './src/components/QuestionContent';
  import './src/styles/tokens.css'; import './src/styles/app.css';
  const row = ${JSON.stringify(row)}, complex = ${JSON.stringify(complex)};
  const mismatch = structuredClone(row.content); mismatch.body[0].text = 'Replacement content.';
  mismatch.interaction.options[0].body[0].text = 'Replacement option.';
  const stimulus = structuredClone(row.content);
  stimulus.stimuli.push({id:'shared',revision:1,body:[{id:'context',type:'paragraph',text:'Additional context.'}]});
  const multiple = structuredClone(row.content);
  multiple.body.push({id:'extra',type:'paragraph',format:'markdown',text:'Additional body.'});
  function Fixture() {
    const store = usePrepDeck(); window.store = store;
    const [show, setShow] = useState(false);
    const props = {annotations:store.state.anns,qid:'legacy',show,onRemoveMark:store.removeMark};
    return <>
      <button onClick={() => setShow(value => !value)}>{show ? 'Hide review annotations' : 'Show review annotations'}</button>
      <section aria-label="Round-tripped stem"><QuestionContent src={row.stem} content={row.content} target="stem" {...props} onMouseUp={() => {if(show) store.capture('legacy','stem');}}/></section>
      <section aria-label="Round-tripped option"><QuestionContent src={row.options[0].text} content={row.content} optionId="A" target="opt:A" {...props} onMouseUp={() => {if(show) store.capture('legacy','opt:A');}}/></section>
      <section aria-label="Original stem"><QuestionContent src={row.stem} target="stem" {...props}/></section>
      <section aria-label="Mismatched stem"><QuestionContent src={row.stem} content={mismatch} target="stem" {...props}/></section>
      <section aria-label="Mismatched option"><QuestionContent src={row.options[0].text} content={mismatch} optionId="A" target="opt:A" {...props}/></section>
      <section aria-label="Shared stimulus"><QuestionContent src={row.stem} content={stimulus} target="stem" {...props}/></section>
      <section aria-label="Multiple blocks"><QuestionContent src={row.stem} content={multiple} target="stem" {...props}/></section>
      <section aria-label="Complex figure"><QuestionContent src={complex.stem} content={complex.content} target="stem" {...props}/></section>
      <section aria-label="Complex option"><QuestionContent src={complex.options[0].text} content={complex.content} optionId="low" target="opt:A" {...props}/></section>
    </>;
  }
  createRoot(document.getElementById('root')).render(<PrepDeckProvider><Fixture/></PrepDeckProvider>);`,
  loader: 'tsx', resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, loader: { ".woff": "dataurl", ".woff2": "dataurl" },
  outfile: 'fixture.js', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/auth/me') return json({ user: { id: 'user', email: 'fixture@example.test', displayName: 'Fixture', role: 'user' } });
  if (url.pathname === '/api/exams') return json({ exams: [{ id: 'exam', name: 'Exam', slug: 'exam', providers: [], questionCount: 1 }] });
  if (url.pathname === '/api/exams/exam/practice-catalog') return json({ questions: [{ ...row, id: 'legacy', examId: 'exam', sequenceNumber: 1, tags: [], points: 1 }], bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  if (url.pathname === '/api/exams/exam/learning/progress') return json({ progress: { lastSequenceNumber: 1 } });
  if (url.pathname === '/api/attempts/active') return json({ attempt: null });
  if (url.pathname === '/api/settings') return json({ showSharedNotes: true });
  if (url.pathname === '/api/annotation-settings') return json({ hl1Alias: 'First', hl2Alias: 'Second', hl3Alias: 'Third' });
  if (url.pathname === '/api/annotations') return json({ annotations });
  if (url.pathname === '/api/notes') return json({ notes: [] });
  if (url.pathname.startsWith('/api/annotations/') && req.method === 'DELETE') {
    const id = url.pathname.split('/').at(-1); deleted.push(id); annotations = annotations.filter(a => a.id !== id);
    return json({ deleted: true });
  }
  if (url.pathname.startsWith('/api/')) return json({ error: 'Optional fixture route' }, 503);
  if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') {
    res.setHeader('Content-Type', url.pathname.endsWith('css') ? 'text/css' : 'text/javascript');
    return res.end(outputFiles.find(file => file.path.endsWith(url.pathname.slice(1)))?.contents);
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body data-pd-theme="light"><main id="root" style="padding:24px;max-width:720px;margin:auto"></main><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.store?.state.workspaceStatus === 'ready' && window.store.state.anns.length === 2);
  const stem = page.getByRole('region', { name: 'Round-tripped stem', exact: true });
  const option = page.getByRole('region', { name: 'Round-tripped option', exact: true });
  const checkOffsets = async (region, source) => {
    assert.equal(await region.locator('[data-off]').evaluateAll((spans, source) => spans.length > 0 && spans.every(span => {
      const text = span.firstChild?.textContent ?? '', offset = Number(span.dataset.off);
      const raw = source.slice(offset, offset + text.length);
      return raw === text || raw.replace(/\n/g, ' ') === text;
    }), source), true, 'Rendered leaves keep raw Markdown source coordinates');
  };
  assert.equal(await stem.getByRole('button', { name: 'Delete mark' }).count(), 0);
  assert.equal(await option.getByRole('button', { name: 'Delete mark' }).count(), 0);
  assert.equal(await stem.locator('[title="Stem note"]').count(), 0);
  await checkOffsets(stem, legacy.stem); await checkOffsets(option, legacy.options[0].text);
  await page.getByRole('button', { name: 'Show review annotations', exact: true }).click();
  const stemMark = stem.locator('[title="Stem note"]'), optionMark = option.locator('[title="Option note"]');
  assert.equal((await stemMark.allTextContents()).join(''), 'marked stem'); assert.equal((await optionMark.allTextContents()).join(''), 'markedオプション');
  assert.equal(await stemMark.getAttribute('data-off'), String(stemStart));
  assert.equal(await optionMark.first().getAttribute('data-off'), String(optionStart));
  assert.equal(await stemMark.evaluate(el => el.style.background), 'var(--color-mark-1)');
  assert.equal(await optionMark.first().evaluate(el => el.style.textDecorationLine), 'underline');
  assert.equal(await stem.innerHTML(), await page.getByRole('region', { name: 'Original stem', exact: true }).innerHTML());
  for (const [mark, target, start, length] of [[stemMark, 'stem', stemStart, 11], [optionMark, 'opt:A', optionStart, optionLength]]) {
    await mark.evaluateAll(elements => {
      const el = elements[0], last = elements.at(-1);
      const range = document.createRange(); range.setStart(el.firstChild, 0); range.setEnd(last.firstChild, last.firstChild.textContent.length);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const captured = await page.evaluate(() => window.store.state.tsel);
    assert.deepEqual({ qid: captured.qid, target: captured.target, start: captured.start, end: captured.end }, { qid: 'legacy', target, start, end: start + length });
  }
  await page.getByRole('button', { name: 'Hide review annotations', exact: true }).click();
  assert.equal(await stem.getByRole('button', { name: 'Delete mark' }).count(), 0);
  await page.getByRole('button', { name: 'Show review annotations', exact: true }).click();
  for (const name of ['Mismatched stem', 'Mismatched option', 'Shared stimulus', 'Multiple blocks', 'Complex figure', 'Complex option']) {
    assert.equal(await page.getByRole('region', { name, exact: true }).getByRole('button', { name: 'Delete mark' }).count(), 0, `${name} must not apply unrelated source offsets`);
  }
  await page.getByRole('region', { name: 'Mismatched stem', exact: true }).getByText('Replacement content.', { exact: true }).waitFor();
  await page.getByRole('region', { name: 'Mismatched option', exact: true }).getByText('Replacement option.', { exact: true }).waitFor();
  await page.getByRole('region', { name: 'Shared stimulus', exact: true }).getByText('Additional context.', { exact: true }).waitFor();
  await page.getByRole('region', { name: 'Multiple blocks', exact: true }).getByText('Additional body.', { exact: true }).waitFor();
  const figure = page.getByRole('region', { name: 'Complex figure', exact: true }).getByRole('img', { name: 'After is twice as high as Before.' });
  assert.equal(await figure.evaluate(img => img.complete && img.naturalWidth > 0), true);
  await page.getByRole('region', { name: 'Complex option', exact: true }).getByText('Lower observation', { exact: true }).waitFor();
  for (const [region, mark, id] of [[option, optionMark, 'option-mark'], [stem, stemMark, 'stem-mark']]) {
    await mark.first().hover(); await region.getByRole('button', { name: 'Delete mark', exact: true }).click();
    await page.waitForFunction(id => !window.store.state.anns.some(a => a.id === id), id);
  }
  assert.deepEqual(deleted, ['option-mark', 'stem-mark']);
  await page.reload(); await page.waitForFunction(() => window.store?.state.workspaceStatus === 'ready');
  await page.getByRole('button', { name: 'Show review annotations', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Delete mark' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Passed: legacy component export/import preserves stem/option marks, source-offset capture, hidden/revealed state, deletion and complex block rendering.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
