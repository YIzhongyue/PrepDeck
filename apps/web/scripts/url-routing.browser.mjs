// issue #41: the address follows the app. Back/Forward move between screens
// and never skip saving a draft, a reload restores the screen, exam and
// Learning position, and links open a Learning question or a Knowledge Point.
// Actual app shell/provider against an isolated API fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readBody } from './browser-fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import {Shell} from './src/App';
function Probe(){window.store=usePrepDeck();return null;}
createRoot(document.getElementById('root')).render(<React.StrictMode><PrepDeckProvider><Probe/><Shell/></PrepDeckProvider></React.StrictMode>);`, loader: 'tsx', resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, outfile: 'fixture.js', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });

const question = (exam, index) => ({ id: `${exam}${index}`, examId: exam, externalId: `${exam}-${index}`, sequenceNumber: index,
  type: 'single_choice', stem: `Question ${exam}${index}`, options: [{ id: 'A', text: 'Choice A' }, { id: 'B', text: 'Choice B' }], tags: [], difficulty: 'easy', chooseCount: 1, points: 1 });
const note = { id: 'note-A', questionId: 'A1', userId: 'u1', content: 'Original question note', visibility: 'private', isMine: true, author: { id: 'u1', displayName: 'u1', avatarUrl: null } };
const knowledgePoint = { id: 'kp-1', title: 'Linked note', bodyMarkdown: 'Body', revision: 1, groupId: null, tags: [], images: [], linkedQuestions: [], position: 0, createdAt: '2026-09-09', updatedAt: '2026-09-09' };
const errors = [], requests = [];
let failPath = null;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (!url.pathname.startsWith('/api/')) {
    if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') {
      res.setHeader('Content-Type', url.pathname.endsWith('css') ? 'text/css' : 'text/javascript');
      return res.end(outputFiles.find(f => f.path.endsWith(url.pathname.slice(1)))?.contents);
    }
    // The Worker's SPA fallback: every other path is the app.
    res.setHeader('Content-Type', 'text/html');
    return res.end('<!doctype html><html><head><title>PrepDeck</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
  const { payload } = await readBody(req);
  requests.push({ path: url.pathname, method: req.method });
  const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === failPath) return json({ error: 'Fixture save failed' }, 503);
  if (url.pathname === '/api/auth/me') return json({ user: { id: 'u1', email: 'u1@test', role: 'user', displayName: 'u1' } });
  if (url.pathname === '/api/exams') return json({ exams: ['A', 'B'].map(id => ({ id, name: `Exam ${id}`, slug: id.toLowerCase(), providers: [], questionCount: 3 })) });
  if (url.pathname === '/api/settings') return json({ showSharedNotes: true, theme: null });
  if (url.pathname === '/api/annotation-settings') return json({ hl1Alias: 'First', hl2Alias: 'Second', hl3Alias: 'Third' });
  if (url.pathname === '/api/annotations') return json({ annotations: [] });
  if (url.pathname === '/api/notes') return json({ notes: url.searchParams.get('examId') === 'A' ? [note] : [] });
  if (url.pathname === '/api/notes/note-A' && req.method === 'PATCH') { Object.assign(note, payload); return json({ note }); }
  if (url.pathname === '/api/knowledge-point-groups') return json({ groups: [], ungroupedCount: 1 });
  if (url.pathname === '/api/knowledge-point-tags') return json({ tags: [] });
  if (url.pathname === '/api/knowledge-points') return json({ knowledgePoints: [], total: 0, orderRevision: 0 });
  if (url.pathname === '/api/knowledge-points/kp-1') return json({ knowledgePoint });
  if (url.pathname.endsWith('/practice-catalog')) {
    const exam = url.pathname.split('/')[3];
    return json({ questions: [1, 2, 3].map(i => question(exam, i)), bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  }
  if (url.pathname.endsWith('/learning/progress')) return json({ progress: { lastSequenceNumber: 1 } });
  if (url.pathname.endsWith('/learning-detail')) return json({ question: { correctAnswers: ['A'], explanation: 'Explanation', answerRevision: 1 }, history: [] });
  if (url.pathname.endsWith('/ai-explanations')) return json({ explanations: [] });
  if (url.pathname === '/api/attempts/active') return json({ attempt: null });
  // Statistics and other optional panels degrade on their own.
  return json({ error: 'No fixture for this optional route' }, 503);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  const state = () => page.evaluate(() => window.store.state);
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => { window.store[method](...args); }, { method, args });
  const ready = exam => page.waitForFunction(exam => window.store?.state.workspaceStatus === 'ready' && window.store.state.examId === exam, exam);
  const at = path => page.waitForFunction(path => location.pathname === path, path);
  const learningAt = seq => page.waitForFunction(seq => {
    const s = window.store.state;
    return s.screen === 'learning' && s.lStage === 'live' && s.catalogBy[s.lQueue[s.lIdx]]?.sequenceNumber === seq;
  }, seq);
  const historyLength = () => page.evaluate(() => history.length);

  // --- The address names the screen, and each screen is a history entry ------
  await page.goto(`${base}/`); await ready('A');
  await at('/exams/a');
  assert.equal(await page.title(), 'Statistics · Exam A · PrepDeck');
  const startLength = await historyLength();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  assert.equal(await nav.getByRole('link', { name: 'Settings' }).getAttribute('href'), '/settings', 'navigation entries are links');
  await nav.getByRole('link', { name: 'Practice' }).click(); await at('/exams/a/practice');
  assert.equal(await nav.getByRole('link', { name: 'Practice' }).getAttribute('aria-current'), 'page');
  await nav.getByRole('link', { name: 'Learning' }).click(); await at('/exams/a/learning');
  await invoke('beginLearning', 2); await learningAt(2); await at('/exams/a/learning/2');
  assert.equal(await page.title(), 'Learning #2 · Exam A · PrepDeck');
  const beforeNext = await historyLength();
  await invoke('learningNext'); await learningAt(3); await at('/exams/a/learning/3');
  assert.equal(await historyLength(), beforeNext, 'question to question replaces the entry');
  assert.equal(await historyLength(), startLength + 3);
  console.log('PASS the address and tab title follow the screen, exam and Learning question; nav entries are links');

  // --- Back and Forward move between screens ----------------------------------
  await page.goBack(); await at('/exams/a/learning');
  await page.waitForFunction(() => window.store.state.screen === 'learning' && window.store.state.lStage === 'setup');
  await page.goBack(); await at('/exams/a/practice');
  await page.waitForFunction(() => window.store.state.screen === 'practice');
  await page.goForward(); await page.goForward(); await at('/exams/a/learning/3'); await learningAt(3);
  // Back across an exam switch switches back.
  await invoke('setExamId', 'B'); await ready('B'); await at('/exams/b/learning');
  await page.goBack(); await ready('A'); await learningAt(3);
  assert.equal(new URL(page.url()).pathname, '/exams/a/learning/3');
  console.log('PASS Back/Forward move between screens, restore the Learning question and switch exams back');

  // --- Reload restores the screen, exam and Learning position -----------------
  await page.reload(); await ready('A'); await learningAt(3);
  await nav.getByRole('link', { name: 'Wrong questions' }).click(); await at('/exams/a/wrong');
  await invoke('setExamId', 'B'); await ready('B'); await at('/exams/b/wrong');
  await page.reload(); await ready('B');
  assert.equal((await state()).screen, 'wrong');
  console.log('PASS reload keeps the screen, the exam and the Learning position');

  // --- Back never skips saving a draft ----------------------------------------
  await invoke('setExamId', 'A'); await ready('A');
  await nav.getByRole('link', { name: 'Annotations' }).click(); await at('/exams/a/annotations');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('textarea').fill('Unsaved question-note edit');
  failPath = '/api/notes/note-A';
  await page.goBack();
  await page.waitForFunction(() => window.store.state.actionError?.includes('could not be saved'));
  await at('/exams/a/annotations');
  assert.equal((await state()).screen, 'notes');
  assert.equal(await page.locator('textarea').inputValue(), 'Unsaved question-note edit', 'the draft is still there');
  failPath = null;
  await page.goBack(); await at('/exams/a/wrong');
  await page.waitForFunction(() => window.store.state.screen === 'wrong');
  assert.equal(note.content, 'Unsaved question-note edit', 'the draft was saved before leaving');
  console.log('PASS a Back the draft save refuses leaves the address and the draft where they were; the next Back saves it');

  // --- Links open a Learning question, a Knowledge Point, or fall back --------
  await page.goto(`${base}/exams/b/learning/2`); await ready('B'); await learningAt(2);
  await page.goto(`${base}/knowledge-points/kp-1`);
  await page.waitForFunction(() => window.store?.state.screen === 'knowledgePoints' && window.store.state.kpNoteId === 'kp-1');
  await page.waitForFunction(() => document.title === 'Knowledge points · PrepDeck');
  assert.ok(requests.some(r => r.path === '/api/knowledge-points/kp-1'), 'the note was loaded');
  await page.goto(`${base}/exams/a/learning/99`); await ready('A');
  await page.waitForFunction(() => window.store.state.actionError?.includes('no question 99'));
  assert.equal((await state()).lStage, 'setup');
  await at('/exams/a/learning');
  await page.goto(`${base}/exams/nope/practice`);
  await page.waitForFunction(() => window.store?.state.workspaceNotice?.includes('linked exam is not available'));
  await at('/exams/a/practice'); // the last exam used
  await page.goto(`${base}/not-a-screen`); await ready('A'); await at('/exams/a');
  console.log('PASS links open a Learning question and a Knowledge Point; a missing question, exam or path falls back');

  // --- Email links from before routing still land -----------------------------
  const lengthBefore = await historyLength();
  await page.goto(`${base}/learning/exam?exam=a&question_id=A3`); await ready('A'); await learningAt(3);
  await at('/exams/a/learning/3');
  await page.goto(`${base}/?screen=wrong`); await ready('A'); await at('/exams/a/wrong');
  assert.equal(await historyLength(), lengthBefore + 2, 'an old link is replaced by the new address, not added to it');
  console.log('PASS daily email links from before routing open their question and screen at the new address');

  assert.deepEqual(errors, [], 'no browser exceptions');
} finally {
  await browser?.close();
  server.close();
}
