// Actual app shell/provider with an isolated API fixture and controllable delayed responses.
// PLAYWRIGHT_MODULE/BROWSER_EXECUTABLE can reuse locally installed browser tooling.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import {Shell} from './src/App';
import {KnowledgePointsProvider,useKnowledgePoints} from './src/store/useKnowledgePoints';
import MarkdownEditor from './src/components/knowledgePoints/MarkdownEditor';
import {beforeWorkspaceNavigation} from './src/lib/examWorkspace';
function KPHarness(){const kp=useKnowledgePoints();window.kp=kp;window.navigate=beforeWorkspaceNavigation;
return <MarkdownEditor value={kp.state.bodyMarkdown} onChange={kp.setBodyMarkdown} onUploadImage={kp.uploadImage}/>;}
function Probe(){window.store=usePrepDeck();return null;}
createRoot(document.getElementById('root')).render(<React.StrictMode>{location.search.includes('kp') ? <KnowledgePointsProvider><KPHarness/></KnowledgePointsProvider> : <PrepDeckProvider><Probe/><Shell/></PrepDeckProvider>}</React.StrictMode>);`, loader: 'tsx', resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, outfile: 'fixture.js', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const question = (exam, index) => ({ id: `${exam}${index}`, examId: exam, externalId: `${exam}-${index}`, sequenceNumber: index,
  type: 'single_choice', stem: `Question ${exam}${index}`, options: [{ id: 'A', text: 'Choice A' }, { id: 'B', text: 'Choice B' }], tags: [exam], difficulty: 'easy', chooseCount: 1, points: 1 });
let user = 'u1', exams = ['A', 'B', 'empty'], serial = 0;
const attempts = new Map(), bookmarks = new Map([['u1:A', ['A1', 'A2']], ['u1:B', ['B1', 'B2', 'B3']], ['u2:A', ['A3']]]);
const errors = [], requests = [], holds = new Map(), held = new Map();
let failPath = null;
const note = { id: 'note-A', questionId: 'A1', userId: 'u1', content: 'Original question note', visibility: 'private', isMine: true, author: { id: 'u1', displayName: 'u1', avatarUrl: null } };
let knowledgePoint = { id: 'kp-1', title: 'Knowledge', bodyMarkdown: '', revision: 1, groupId: null, tags: [], images: [], linkedQuestions: [], position: 0, createdAt: '2026-09-09', updatedAt: '2026-09-09' };
function hold(path) { holds.set(path, true); }
function release(path, transform = x => x) { const item = held.get(path); assert.ok(item, `no held ${path}`); held.delete(path); item.finish(transform(item.body)); }
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (!url.pathname.startsWith('/api/')) {
    if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') {
      res.setHeader('Content-Type', url.pathname.endsWith('css') ? 'text/css' : 'text/javascript');
      return res.end(outputFiles.find(f => f.path.endsWith(url.pathname.slice(1)))?.contents);
    }
    res.setHeader('Content-Type', 'text/html');
    return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
  let raw = ''; for await (const part of req) raw += part; const payload = req.headers['content-type']?.includes('application/json') ? JSON.parse(raw || '{}') : {};
  requests.push({ path: url.pathname, query: url.search, method: req.method, payload });
  const json = (body, status = 200) => {
    const finish = result => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); };
    if (holds.has(url.pathname)) { holds.delete(url.pathname); held.set(url.pathname, { body, finish }); } else finish(body);
  };
  if (url.pathname === failPath) return json({ error: 'Fixture save failed' }, 503);
  if (url.pathname === '/api/auth/me') return json({ user: { id: user, email: `${user}@test`, role: 'user', displayName: user } });
  if (url.pathname === '/api/exams') return json({ exams: exams.map(id => ({ id, name: `Exam ${id}`, slug: id, providers: [], questionCount: id === 'empty' ? 0 : 3 })) });
  if (url.pathname === '/api/settings') return json({ showSharedNotes: true });
  if (url.pathname === '/api/annotation-settings') return json({ hl1Alias: 'First', hl2Alias: 'Second', hl3Alias: 'Third' });
  if (url.pathname === '/api/annotations') return json({ annotations: [] });
  if (url.pathname === '/api/notes') return json({ notes: url.searchParams.get('examId') === 'A' ? [note] : [] });
  if (url.pathname === '/api/notes/note-A' && req.method === 'PATCH') { Object.assign(note, payload); return json({ note }); }
  if (url.pathname === '/api/knowledge-point-groups') return json({ groups: [], ungroupedCount: 1 });
  if (url.pathname === '/api/knowledge-point-tags') return json({ tags: [] });
  if (url.pathname === '/api/knowledge-points') return json({ knowledgePoints: [], total: 0 });
  if (url.pathname === '/api/knowledge-points/kp-1') {
    if (req.method === 'PUT') {
      if (payload.baseRevision !== knowledgePoint.revision) return json({ error: 'revision_conflict', latest: knowledgePoint }, 409);
      knowledgePoint = { ...knowledgePoint, title: payload.title, bodyMarkdown: payload.bodyMarkdown, revision: knowledgePoint.revision + 1 };
    }
    return json({ knowledgePoint });
  }
  if (url.pathname === '/api/kp-images/kp-1') return json({ image: { id: 'img-1', url: '/api/kp-images/img-1', status: 'pending' } });
  if (url.pathname.endsWith('/practice-catalog')) {
    const exam = url.pathname.split('/')[3];
    return json({ questions: exam === 'empty' ? [] : [1, 2, 3].map(i => question(exam, i)), bookmarkedIds: bookmarks.get(`${user}:${exam}`) ?? [], wrongEntries: [], attemptedIds: [] });
  }
  if (url.pathname.endsWith('/learning/progress')) return json({ progress: { lastSequenceNumber: 1 } });
  if (url.pathname.endsWith('/learning-detail')) return json({ question: { correctAnswers: ['A'], explanation: 'Fresh explanation', answerRevision: 1 }, history: [] });
  if (url.pathname.endsWith('/ai-explanations')) return json({ explanations: [] });
  if (url.pathname === '/api/attempts/active') return json({ attempt: [...attempts.values()].find(a => a.examId === url.searchParams.get('examId') && a.user === user && a.mode === 'mock' && !a.completed) ?? null });
  if (url.pathname.endsWith('/attempts') && req.method === 'POST') {
    const examId = url.pathname.split('/')[3];
    const attempt = { attemptId: `attempt-${++serial}`, examId, user, ...payload, selectedAnswers: {}, flagged: {}, startedAt: new Date(Date.now() - 10000).toISOString() };
    attempts.set(attempt.attemptId, attempt); return json(attempt, 201);
  }
  if (url.pathname.startsWith('/api/attempts/')) {
    const [, , , id, action, qid] = url.pathname.split('/'); const attempt = attempts.get(id);
    if (!attempt) return json({ error: 'Missing attempt' }, 404);
    if (action === 'answers' && req.method === 'PUT') { attempt.selectedAnswers[qid] = payload.selectedAnswer; return json({ saved: true }); }
    if (action === 'flags') { attempt.flagged[qid] = payload.flagged; return json({ saved: true }); }
    if (action === 'answers') { attempt.selectedAnswers[payload.questionId] = payload.selectedAnswer; return json({ isCorrect: false, correctAnswers: ['A'], explanation: 'Answer explanation', answerRevision: 1 }); }
    if (action === 'complete') { attempt.completed = true; return json({ attemptId: id, mode: attempt.mode, score: 0, passed: false, correctCount: 0, totalQuestions: attempt.questionIds.length, durationSeconds: 10, breakdown: [] }); }
  }
  if (url.pathname.endsWith('/bookmark')) {
    const qid = url.pathname.split('/')[3], key = `${user}:${qid[0]}`;
    const ids = new Set(bookmarks.get(key) ?? []);
    if (req.method === 'PUT') ids.add(qid); else ids.delete(qid);
    bookmarks.set(key, [...ids]); return json({ bookmarked: req.method === 'PUT' });
  }
  if (url.pathname.endsWith('/notes') && req.method === 'POST') return json({ note: { id: 'note-1', questionId: url.pathname.split('/')[3], content: payload.content, visibility: payload.visibility, isMine: true, author: { displayName: user } } });
  // Dashboard errors are contained and don't affect workspace readiness.
  return json({ error: 'No fixture for this optional route' }, 503);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  const ready = exam => page.waitForFunction(exam => window.store?.state.workspaceStatus === 'ready' && window.store.state.examId === exam, exam);
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.store[method](...args), { method, args });
  const switchTo = async exam => { await invoke('setExamId', exam); await ready(exam); };
  const state = () => page.evaluate(() => window.store.state);
  const waitHeld = async path => { for (let i = 0; i < 100 && !held.has(path); i++) await new Promise(r => setTimeout(r, 20)); assert.ok(held.has(path), `request not held: ${path}`); };
  await page.goto(`http://127.0.0.1:${server.address().port}`); await ready('A');
  await invoke('go', 'bookmarks'); await page.getByRole('button', { name: 'Practice these 2' }).waitFor();
  await switchTo('B'); await page.getByRole('button', { name: 'Practice these 3' }).waitFor();
  assert.equal((await state()).screen, 'bookmarks');
  const generation = (await state()).workspaceGeneration; await switchTo('B'); assert.equal((await state()).workspaceGeneration, generation);
  await page.reload(); await ready('B');
  user = 'u2'; await page.reload(); await ready('A'); assert.equal(Object.keys((await state()).bookmarks).length, 1);
  user = 'u1'; await page.reload(); await ready('B');
  console.log('Passed: counts, page preservation, same-exam no-op, refresh and account-specific selection.');

  hold('/api/exams/A/practice-catalog'); await invoke('setExamId', 'A'); await waitHeld('/api/exams/A/practice-catalog');
  assert.equal((await state()).workspaceStatus, 'loading'); assert.deepEqual((await state()).bookmarks, {});
  const starts = serial; await invoke('begin', ['A1']); assert.equal(serial, starts);
  await switchTo('B'); await switchTo('A');
  release('/api/exams/A/practice-catalog', body => ({ ...body, bookmarkedIds: ['A3'] }));
  await page.waitForTimeout(60); assert.deepEqual(Object.keys((await state()).bookmarks), ['A1', 'A2']);
  await invoke('goToQuestionForReview', 'A', 'A1'); await page.waitForFunction(() => window.store.state.lStage === 'live');
  hold('/api/questions/A2/learning-detail'); await invoke('learningNext'); await waitHeld('/api/questions/A2/learning-detail');
  await switchTo('B'); await switchTo('A');
  release('/api/questions/A2/learning-detail'); await page.waitForTimeout(60); assert.deepEqual((await state()).lDetail, {});
  console.log('Passed: A → B → A catalog/detail races and loading-state practice guard.');

  failPath = '/api/exams/B/practice-catalog'; await invoke('setExamId', 'B'); await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  failPath = null; await invoke('retryWorkspace'); await ready('B');
  await switchTo('empty'); assert.equal((await state()).catalog.length, 0); const emptyStarts = serial; await invoke('beginMock'); assert.equal(serial, emptyStarts);
  await invoke('goToQuestionForReview', 'A', 'missing'); await ready('A'); await page.waitForFunction(() => window.store.state.actionError?.includes('no longer available'));
  assert.equal((await state()).pendingQuestionJump, null);
  await invoke('dismissActionError');

  await invoke('begin', ['A1']); await page.waitForFunction(() => !!window.store.state.attemptId);
  const practiceId = (await state()).attemptId;
  await page.evaluate(() => window.store.pick(window.store.state.catalogBy.A1, 'B'));
  page.once('dialog', d => d.dismiss()); assert.equal(await invoke('setExamId', 'B'), false); assert.equal((await state()).examId, 'A');
  failPath = `/api/attempts/${practiceId}/answers`;
  page.once('dialog', d => d.accept()); assert.equal(await invoke('setExamId', 'B'), false); assert.deepEqual((await state()).sel.A1, ['B']);
  failPath = null;
  hold(`/api/attempts/${practiceId}/answers`); await invoke('submit'); await waitHeld(`/api/attempts/${practiceId}/answers`);
  page.once('dialog', d => d.accept());
  await page.evaluate(() => { window.switchResult = null; window.store.setExamId('B').then(result => { window.switchResult = result; }); });
  assert.equal((await state()).examId, 'A'); // pending answer must finish before changing context
  release(`/api/attempts/${practiceId}/answers`); await ready('B');
  assert.equal(await page.evaluate(() => window.switchResult), true);
  assert.equal(attempts.get(practiceId).completed, true); assert.deepEqual(attempts.get(practiceId).selectedAnswers.A1, ['B']);
  assert.deepEqual((await state()).wrong, {});
  console.log('Passed: failed-load retry, empty exam, bad links, practice cancellation and failed-save retention.');
  await switchTo('A'); await invoke('go', 'notes');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('textarea').fill('Retained question-note edit');
  failPath = '/api/notes/note-A'; assert.equal(await invoke('setExamId', 'B'), false);
  assert.equal(await page.locator('textarea').inputValue(), 'Retained question-note edit');
  // Removing the active exam during a background catalog refresh must not
  // unmount its dirty editor when the automatic fallback cannot save.
  exams = ['B', 'empty']; await page.evaluate(() => window.dispatchEvent(new Event('prepdeck:question-bank-changed')));
  await page.waitForFunction(() => window.store.state.actionError?.includes('This exam is unavailable'));
  assert.equal(await page.locator('textarea').inputValue(), 'Retained question-note edit');
  assert.equal((await state()).examId, 'A');
  failPath = null; await switchTo('B'); exams = ['A', 'B', 'empty']; await invoke('retryWorkspace');
  await page.waitForFunction(() => window.store.state.exams.some(e => e.id === 'A'));
 assert.equal(note.content, 'Retained question-note edit');
  console.log('Passed: question-note editor saves on switching and retains drafts on failure.');


  await invoke('go', 'mock'); await invoke('beginMock'); await page.waitForFunction(() => !!window.store.state.mockAttemptId);
  const mockId = (await state()).mockAttemptId;
  const qid = (await state()).mQueue[0];
  failPath = `/api/attempts/${mockId}/answers/${qid}`;
  await page.evaluate(qid => window.store.mockPick(window.store.state.catalogBy[qid], 'B'), qid);
  await page.waitForFunction(() => window.store.state.actionError?.includes('Mock answer'));
  page.once('dialog', d => d.accept()); assert.equal(await invoke('setExamId', 'A'), false);
  assert.deepEqual((await state()).mSel[qid], ['B']);
  failPath = null; page.once('dialog', d => d.accept()); await switchTo('A'); assert.equal(attempts.get(mockId).completed, undefined);
  await switchTo('B'); await invoke('beginMock');
  assert.equal((await state()).mockAttemptId, mockId); assert.deepEqual((await state()).mSel[qid], ['B']);
  assert.ok((await state()).mLeft < attempts.get(mockId).timeLimitSeconds, 'original timer must continue');
  page.once('dialog', d => d.accept()); await switchTo('A');
  failPath = '/api/questions/A1/bookmark'; await invoke('removeBookmark', 'A1');
  await page.waitForFunction(() => window.store.state.actionError?.includes('bookmark')); assert.equal((await state()).bookmarks.A1, true); failPath = null;
  await invoke('dismissActionError');

  hold('/api/exams/A/attempts'); await invoke('begin', ['A1']); await waitHeld('/api/exams/A/attempts');
  await invoke('go', 'bookmarks'); release('/api/exams/A/attempts'); await page.waitForTimeout(60);
  assert.equal((await state()).screen, 'bookmarks'); assert.equal((await state()).attemptId, null);
  console.log('Passed: resumable mock/timer, bookmark rollback, and stale start response after navigation.');

  // Exercise real desktop, collapsed-rail and mobile selectors with keyboard navigation.
  for (const width of [1280, 1000, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: /Select exam/ }).click();
    await page.getByRole('option', { name: 'Exam B' }).focus(); await page.keyboard.press('Enter'); await ready('B');
    assert.equal((await state()).screen, 'bookmarks');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await switchTo('A');
  }
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/exam-workspace-mobile.png`, fullPage: true });
  exams = ['B']; await page.reload(); await ready('B'); assert.ok((await state()).workspaceNotice);
  exams = []; await page.reload(); await page.waitForFunction(() => window.store?.state.workspaceStatus === 'empty');
  assert.equal((await state()).examId, null);
  // Real Markdown editor + knowledge-point autosave provider: delayed upload,
  // final image reference, failed save retention, and revision conflict.
  await page.goto(`http://127.0.0.1:${server.address().port}/?kp=1`);
  await page.waitForFunction(() => !!window.kp);
  await page.evaluate(() => window.kp.openNote('kp-1'));
  await page.waitForFunction(() => !!window.kp.state.editing);
  // The body is a Tiptap contenteditable, not a textarea — the visual editor is
  // the default mode and the only <textarea> belongs to Markdown source. fill()
  // works on contenteditable; inputValue() does not, so retention is asserted
  // against the provider state these checks are actually about.
  const body = page.getByRole('textbox', { name: 'Knowledge point body', exact: true });
  const draftBody = () => page.evaluate(() => window.kp.state.bodyMarkdown);
  await body.fill('Chinese 中文 / Japanese 日本語 draft');
  failPath = '/api/knowledge-points/kp-1';
  assert.equal(await page.evaluate(() => window.navigate().then(() => true, () => false)), false);
  assert.equal(await draftBody(), 'Chinese 中文 / Japanese 日本語 draft');
  failPath = null;
  await page.evaluate(() => window.navigate());
  assert.equal(knowledgePoint.bodyMarkdown, 'Chinese 中文 / Japanese 日本語 draft');
  hold('/api/kp-images/kp-1');
  await page.locator('input[type=file]').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('fixture-image') });
  await waitHeld('/api/kp-images/kp-1');
  await page.evaluate(() => { window.navFinished = false; window.navError = null; window.navigate().then(() => {window.navFinished = true;}, e => {window.navError = e.message;}); });
  assert.equal(await page.evaluate(() => window.navFinished), false);
  release('/api/kp-images/kp-1');
  await page.waitForFunction(() => window.navFinished || window.navError);
  assert.equal(await page.evaluate(() => window.navError), null);
  assert.ok(knowledgePoint.bodyMarkdown.includes('/api/kp-images/img-1'), 'navigation must await the body containing the uploaded image reference');
  assert.ok(!knowledgePoint.bodyMarkdown.includes('uploading'));
  knowledgePoint.revision++;
  await body.fill('Conflicting edit');
  assert.equal(await page.evaluate(() => window.navigate().then(() => true, () => false)), false);
  assert.equal(await draftBody(), 'Conflicting edit');
  console.log('Passed: knowledge-point save failures, pending upload/reference persistence, and revision-conflict retention.');
  assert.deepEqual(errors, []);
  console.log('Passed: desktop/rail/mobile keyboard selectors, unavailable restored exam, no exams, and no browser exceptions.');
} finally {
  for (const [path] of held) release(path);
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
