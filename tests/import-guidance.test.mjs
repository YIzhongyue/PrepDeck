import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { importTs } from './support/bundle.mjs';

const { getImportSchemas, QUESTION_IMPORT_GUIDANCE } = await importTs(new URL('../packages/shared/src/pdf-layouts.ts', import.meta.url));
const { validateImportFile } = await importTs(new URL('../packages/shared/src/import-validate.ts', import.meta.url));
const { adminMcpTools, userMcpTools } = await importTs([
  new URL('../apps/worker/src/mcp/admin/server.ts', import.meta.url),
  new URL('../apps/worker/src/mcp/user/server.ts', import.meta.url),
], { platform: 'workerd' });
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function assertGuidance(text) {
  for (const pattern of [
    /plain-text/, /single_choice/, /multiple_choice/, /no tables, charts, diagrams or images/,
    /prefer.*Markdown/, /1\.0/, /JSON envelope/, /raw .*\.md/,
    /answer structure faithfully/, /option IDs\/labels\/order/, /correct-answer mappings/,
    /other question types/, /2\.0 components/, /never discard content/,
    /validation, preview, approval, conflict handling, revision checks and replay safeguards/,
  ]) assert.match(text, pattern);
}

test('discovery and question-add/import entry points share conditional advice', () => {
  assertGuidance(QUESTION_IMPORT_GUIDANCE);
  assert.ok(getImportSchemas().workflow.includes(QUESTION_IMPORT_GUIDANCE));
  const tools = [...adminMcpTools({ audience: 'admin', userId: 'synthetic-admin' }, {}), ...userMcpTools({ audience: 'user', userId: 'synthetic-user' }, {})];
  for (const name of [
    'admin_get_import_schemas', 'user_get_import_schemas', 'admin_validate_question_payload',
    'admin_preview_component_question', 'admin_create_question', 'admin_batch_create_questions', 'admin_validate_import',
    'admin_preview_import', 'admin_execute_import',
  ]) {
    const tool = tools.find(tool => tool.definition.name === name);
    assert.ok(tool, name);
    assert.ok(tool.definition.description.includes(QUESTION_IMPORT_GUIDANCE), name);
  }
  assert.equal(getImportSchemas().version, '2.0');
  assert.equal(getImportSchemas().importPermission, 'admin');
  assert.equal(getImportSchemas().acceptsPdfUpload, false);
});

test('standalone Skills retain the same eligibility, transport, fidelity and fallback rules', () => {
  for (const path of [
    'skills/prepdeck-admin/SKILL.md', 'skills/prepdeck-admin/references/workflows.md',
    'skills/pdf-to-quiz/SKILL.md', 'skills/pdf-to-quiz/references/import-format.md',
  ]) assertGuidance(read(path).replaceAll('`', ''));
  const imports = read('skills/prepdeck-admin/references/workflows.md').split('## Imports')[1].split('## Exams')[0];
  assert.match(imports, /Markdown-first/);
  assert.match(imports, /JSON envelope/);
  assert.match(imports, /2\.0 components/);
});

test('documented synthetic examples validate without changing their content or answer mappings', () => {
  const doc = read('skills/pdf-to-quiz/references/import-format.md');
  const file = JSON.parse(doc.match(/```json\n([\s\S]*?)\n```/)[1]);
  const original = structuredClone(file);
  assert.deepEqual(file.questions.map(q => q.type), ['single_choice', 'multiple_choice', 'fill_blank']);
  assert.deepEqual(file.questions.map(q => q.correctAnswers), [['A'], ['A', 'C'], ['3']]);
  assert.deepEqual(file.questions.slice(0, 2).map(q => q.options.map(o => o.id)), [['A', 'B', 'C'], ['A', 'B', 'C']]);
  assert.deepEqual(validateImportFile(file).issues, []);
  assert.deepEqual(file, original);
  const py = spawnSync('python3', ['-c', "import json,sys;sys.path.insert(0,'skills/pdf-to-quiz/scripts');from validate_quiz import validate;errors,warnings=validate(json.load(sys.stdin));print(json.dumps(errors))"], { input: JSON.stringify(file), encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), []);
  // The preference must not narrow the accepted contract or convert components.
  for (const name of ['reading', 'code', 'case-with-figure', 'combination']) {
    const component = JSON.parse(read(`tests/fixtures/components/${name}.json`));
    const before = structuredClone(component);
    assert.deepEqual(validateImportFile(component).issues, [], name);
    assert.deepEqual(component, before, name);
  }
});
