import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle dependencies so this test covers the actual shared validator.
async function loadTypeScript(path) {
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'] });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}
const { validateImportFile, IMPORT_LIMITS } = await loadTypeScript('../packages/shared/src/import-validate.ts');
const { IMPORT_BODY_MAX_BYTES, IMPORT_JSON_MAX_DEPTH } = await loadTypeScript('../apps/worker/src/lib/importSecurity.ts');
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/import-contract.json', import.meta.url), 'utf8'));
test('transport limit constants', () => assert.deepEqual({maxBytes: IMPORT_BODY_MAX_BYTES, maxDepth: IMPORT_JSON_MAX_DEPTH}, fixtures.transportLimits));
test('shared limit constants', () => assert.deepEqual(IMPORT_LIMITS, fixtures.limits));
for (const fixture of fixtures.cases) {
  test(fixture.name, () => {
    const data = structuredClone(fixtures.base);
    for (const [path, value] of Object.entries(fixture.set)) {
      const keys = path.slice(1).split('/');
      const last = keys.pop();
      const parent = keys.reduce((obj, key) => obj[key], data);
      parent[last] = value;
    }
    for (const path of fixture.remove) {
      const keys = path.slice(1).split('/');
      const last = keys.pop();
      delete keys.reduce((obj, key) => obj[key], data)[last];
    }
    for (const [path, spec] of Object.entries(fixture.repeat ?? {})) {
      const keys = path.slice(1).split('/');
      const last = keys.pop();
      keys.reduce((obj, key) => obj[key], data)[last] = typeof spec.value === 'string'
        ? spec.value.repeat(spec.count) : Array.from({length: spec.count}, () => structuredClone(spec.value));
    }
    const result = validateImportFile(data);
    assert.equal(result.issues.length === 0, fixture.valid, JSON.stringify(result.issues));
    if (fixture.name === 'duplicate external IDs') {
      assert.deepEqual(result.duplicateExternalIdsInFile, ['Section-A-Q1']);
    }
  });
}
for (const points of [NaN, Infinity, -Infinity]) {
  test(`non-JSON points ${points}`, () => {
    const data = structuredClone(fixtures.base);
    data.questions[0].points = points;
    assert.ok(validateImportFile(data).issues.some(issue => issue.path.endsWith('.points')));
  });
}
