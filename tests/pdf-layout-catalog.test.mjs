import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { Hono } from 'hono';
import { spawnSync } from 'node:child_process';

const { outputFiles } = await build({
  entryPoints: ['apps/worker/src/routes/importSchemas.ts'], bundle: true,
  write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'],
});

test('compiled Subject B cases pass the existing Worker import preview contract', async () => {
  const prepared = spawnSync('python3', ['-c', `
import json, sys
from pathlib import Path
sys.path.insert(0, 'tests/pdf-to-quiz')
from test_subject_b import fixture
import build_quiz
doc, inventory = fixture()
output, report = build_quiz.reconcile(doc, inventory, Path('.'))
print(json.dumps(output, ensure_ascii=False))
`], { encoding: 'utf8' });
  assert.equal(prepared.status, 0, prepared.stderr);
  const file = JSON.parse(prepared.stdout);
  const { outputFiles } = await build({ entryPoints: ['apps/worker/src/routes/imports.ts'],
    bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'] });
  const { importsRouter } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('user', { id: 'admin', role: 'admin' }); await next(); });
  app.route('/exams/:examId/import', importsRouter);
  const statement = { bind() { return this; }, first: async () => ({ id: 'ipa-sg' }), all: async () => ({ results: [] }) };
  const response = await app.request('/exams/ipa-sg/import/validate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(file),
  }, { DB: { prepare: () => statement }, IMPORT_VALIDATE_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  const preview = await response.json();
  assert.equal(response.status, 200);
  assert.equal(preview.valid, true);
  assert.equal(preview.questionCount, 2);
  assert.ok(file.questions.every(q => q.stem.includes('A社の共通事例。') && q.stem.includes('- 値: 0')));
  assert.deepEqual(file.questions.map(q => q.correctAnswers), [['ア'], ['イ']]);
});
const { importSchemasRouter } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const catalog = JSON.parse(readFileSync('skills/pdf-to-quiz/references/pdf-layouts.json', 'utf8'));

test('REST discovery serves the same standalone PDF layouts and output schema', async () => {
  const app = new Hono();
  app.route('/import-schemas', importSchemasRouter);
  const response = await app.request('/import-schemas');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.layouts, catalog.layouts);
  assert.equal(body.importSchema.properties.schemaVersion.const, catalog.outputSchemaVersion);
  assert.equal(body.acceptsPdfUpload, false);
  assert.equal(new Set(body.layouts.map(l => l.id)).size, 3);
  assert.deepEqual(body.caseSchemas['ja-sg-subject-b'], JSON.parse(readFileSync('skills/pdf-to-quiz/references/subject-b-case.schema.json', 'utf8')));
  for (const layout of body.layouts) {
    const answer = new RegExp(layout.answerPattern, 'm').exec(layout.answerPlacement === 'interleaved' ? '問12：正答 エ' : '問12：エ');
    assert.equal(answer[1], '12');
    assert.equal(answer[2], 'エ');
  }
});
