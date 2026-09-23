import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { Hono } from 'hono';
import { build } from 'esbuild';
import { validateImportFile } from '../packages/shared/src/import-validate.ts';
const { outputFiles } = await build({ entryPoints: ['apps/worker/src/routes/importSchemas.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'] });
const { importSchemasRouter } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
test('discovery publishes provider-independent content and interaction schemas', async () => {
  const app=new Hono();app.route('/schemas',importSchemasRouter);
  const data=await (await app.request('/schemas')).json();
  assert.equal(data.componentImportSchema.properties.schemaVersion.const,'2.0');
  assert.deepEqual(data.capabilities.interactions,['choice','text','order','match']);
  assert.equal(data.acceptsPdfUpload,false);
  assert.ok(!JSON.stringify(data).includes('ja-sg'));
});
for (const name of ['reading','code','case-with-figure','combination']) test(`Python and Worker accept the same ${name} package and reject malformed references`, () => {
  const original=JSON.parse(readFileSync(`tests/fixtures/components/${name}.json`,'utf8'));
  for (const file of [original,{...original,questions:[{...original.questions[0],stimulusRefs:['absent']}]}]) {
    const py=spawnSync('python3',['-c',"import json,sys;sys.path.insert(0,'skills/pdf-to-quiz/scripts');from components import validate_components;print(json.dumps(validate_components(json.load(sys.stdin))))"],{input:JSON.stringify(file),encoding:'utf8'});
    assert.equal(py.status,0,py.stderr);
    assert.equal(JSON.parse(py.stdout).length===0,validateImportFile(file).issues.length===0);
  }
});
