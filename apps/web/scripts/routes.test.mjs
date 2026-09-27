// issue #41 — the address names the screen, the exam, the Learning position
// and the open Knowledge Point, and old email links still land.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/routes.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'neutral',
});
const { parseRoute, routePath, routeTitle, SPA_ROUTE_PREFIXES } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);

const route = (over) => ({ screen: 'dash', examSlug: 'cloud', learningSequence: null, knowledgePointId: null, ...over });

test('every screen has a path, and the path reads back as the same route', () => {
  const cases = [
    [route({}), '/exams/cloud'],
    [route({ screen: 'learning' }), '/exams/cloud/learning'],
    [route({ screen: 'learning', learningSequence: 57 }), '/exams/cloud/learning/57'],
    [route({ screen: 'practice' }), '/exams/cloud/practice'],
    [route({ screen: 'mock' }), '/exams/cloud/mock'],
    [route({ screen: 'bookmarks' }), '/exams/cloud/bookmarks'],
    [route({ screen: 'wrong' }), '/exams/cloud/wrong'],
    [route({ screen: 'notes' }), '/exams/cloud/annotations'],
    [route({ screen: 'knowledgePoints', examSlug: null }), '/knowledge-points'],
    [route({ screen: 'knowledgePoints', examSlug: null, knowledgePointId: 'kp-1' }), '/knowledge-points/kp-1'],
    [route({ screen: 'settings', examSlug: null }), '/settings'],
    [route({ screen: 'admin', examSlug: null }), '/admin'],
  ];
  for (const [r, path] of cases) {
    assert.equal(routePath(r), path);
    const parsed = parseRoute(path, '');
    assert.deepEqual(
      { screen: parsed.screen, examSlug: parsed.examSlug, learningSequence: parsed.learningSequence, knowledgePointId: parsed.knowledgePointId },
      r, path);
    assert.equal(parsed.legacy, false);
  }
});

test('account screens ignore the exam, and an exam screen without one is the root', () => {
  assert.equal(routePath(route({ screen: 'settings' })), '/settings');
  assert.equal(routePath(route({ screen: 'practice', examSlug: null })), '/');
});

test('slugs and ids are encoded, and a trailing slash is accepted', () => {
  assert.equal(routePath(route({ examSlug: 'a b/c' })), '/exams/a%20b%2Fc');
  assert.equal(parseRoute('/exams/a%20b%2Fc', '').examSlug, 'a b/c');
  assert.equal(parseRoute('/exams/cloud/practice/', '').screen, 'practice');
});

test('unknown or malformed paths open the default screen', () => {
  for (const path of ['/', '/nope', '/exams', '/exams/cloud/nope', '/exams/cloud/learning/0', '/exams/cloud/learning/x',
    '/exams/cloud/practice/3', '/exams/cloud/learning/5/extra', '/settings/x', '/knowledge-points/a/b', '/exams/%E0%A4%A']) {
    assert.equal(parseRoute(path, ''), null, path);
  }
});

test('email links written before routing still land, and are marked for replacement', () => {
  assert.deepEqual(parseRoute('/', '?screen=wrong'),
    { screen: 'wrong', examSlug: null, learningSequence: null, knowledgePointId: null, questionId: null, source: null, legacy: true });
  const practice = parseRoute('/', '?screen=practice&source=bm');
  assert.equal(practice.screen, 'practice');
  assert.equal(practice.source, 'bm');
  assert.equal(parseRoute('/', '?source=wrong').screen, 'practice');
  assert.equal(parseRoute('/', '?screen=bogus'), null);
  const question = parseRoute('/learning/exam', '?exam=cloud&question_id=q-42');
  assert.equal(question.screen, 'learning');
  assert.equal(question.examSlug, 'cloud');
  assert.equal(question.questionId, 'q-42');
  assert.equal(question.legacy, true);
  assert.equal(parseRoute('/learning/exam', '?exam=cloud'), null);
});

test('tab titles name the screen, the Learning position and the exam', () => {
  assert.equal(routeTitle(route({ screen: 'learning', learningSequence: 57 }), 'Cloud Pro'), 'Learning #57 · Cloud Pro · PrepDeck');
  assert.equal(routeTitle(route({}), 'Cloud Pro'), 'Statistics · Cloud Pro · PrepDeck');
  assert.equal(routeTitle(route({ screen: 'settings' }), 'Cloud Pro'), 'Settings · PrepDeck');
});

test('no SPA route is served by the Worker first', () => {
  const toml = readFileSync(new URL('../../worker/wrangler.toml', import.meta.url), 'utf8');
  const line = toml.split('\n').find((l) => l.trim().startsWith('run_worker_first'));
  const patterns = JSON.parse(line.slice(line.indexOf('=') + 1).trim());
  assert.ok(patterns.includes('/api/*'), 'read the real list');
  const matches = (pattern, path) => pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern;
  for (const prefix of SPA_ROUTE_PREFIXES) {
    for (const path of [`/${prefix}`, `/${prefix}/x`, `/${prefix}/x/y`]) {
      assert.ok(!patterns.some((p) => matches(p, path)), `${path} would be served by the Worker (${patterns.join(', ')})`);
    }
  }
});
