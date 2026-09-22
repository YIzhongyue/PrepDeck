import copy
import importlib.util
import itertools
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'skills/pdf-to-quiz/scripts'
sys.path.insert(0, str(SCRIPTS))
import build_quiz as builder
import extract_pdf as extractor
import validate_quiz as validator

FIXTURES = json.loads((ROOT / 'tests/fixtures/import-contract.json').read_text(encoding='utf-8'))


def contract_case(case):
    data = copy.deepcopy(FIXTURES['base'])
    for path, value in case['set'].items():
        keys = path.strip('/').split('/')
        parent = data
        for key in keys[:-1]:
            parent = parent[int(key)] if isinstance(parent, list) else parent[key]
        parent[int(keys[-1]) if isinstance(parent, list) else keys[-1]] = value
    for path in case['remove']:
        keys = path.strip('/').split('/')
        parent = data
        for key in keys[:-1]:
            parent = parent[int(key)] if isinstance(parent, list) else parent[key]
        del parent[keys[-1]]
    for path, spec in case.get('repeat', {}).items():
        keys = path.strip('/').split('/')
        parent = data
        for key in keys[:-1]:
            parent = parent[int(key)] if isinstance(parent, list) else parent[key]
        parent[int(keys[-1]) if isinstance(parent, list) else keys[-1]] = spec['value'] * spec['count'] if isinstance(spec['value'], str) else [copy.deepcopy(spec['value']) for _ in range(spec['count'])]
    return data


class ContractTests(unittest.TestCase):
    def test_shared_contract_fixtures(self):
        self.assertEqual(validator.IMPORT_LIMITS, FIXTURES['limits'])
        for case in FIXTURES['cases']:
            with self.subTest(case=case['name']):
                errors, _ = validator.validate(contract_case(case))
                self.assertEqual(not errors, case['valid'], errors)

    def test_timestamp_calendar_clock_and_offset_ranges(self):
        for value in [
            '2026-09-07T00:00:00Z', '2026-09-07T23:59:59Z',
            '2024-02-29t23:59:59.123456789z', '2026-09-07T23:59:59+23:59',
            '2026-09-07T00:00:00-23:59',
            '0001-01-01T00:00:00Z', '2000-02-29T00:00:00Z', '9999-12-31T23:59:59Z',
        ]:
            with self.subTest(value=value):
                self.assertTrue(validator.valid_timestamp(value))
        for value in [
            '2026-09-07T24:00:00Z', '2026-09-07T24:00:00.000+00:00',
            '2026-09-07T23:60:00Z', '2026-09-07T23:59:60Z',
            '2026-09-07T00:00:00+24:00', '2026-09-07T00:00:00-00:60',
            '2026-02-29T00:00:00Z', '2026-02-30T00:00:00Z', '1900-02-29T00:00:00Z',
            '0000-01-01T00:00:00Z', '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z',
            '2026-01-00T00:00:00Z', '2026-04-31T00:00:00Z',
        ]:
            with self.subTest(value=value):
                self.assertFalse(validator.valid_timestamp(value))

    def test_generated_timestamps_match_typescript(self):
        values = [f'{y:04}-{m:02}-{d:02}T23:59:59Z' for y, m, d in itertools.product(
            [0, 1, 1900, 2000, 2024, 2026, 9999], [0, 1, 2, 4, 12, 13], [0, 1, 28, 29, 30, 31, 32])]
        values += [f'2026-09-07T{h:02}:{m:02}:{s:02}Z' for h, m, s in itertools.product(
            [0, 23, 24, 99], [0, 59, 60, 99], [0, 59, 60, 99])]
        values += [f'2026-09-07T00:00:00{sign}{h:02}:{m:02}' for sign, h, m in itertools.product(
            ['+', '-'], [0, 23, 24, 99], [0, 59, 60, 99])]
        values += ['2024-02-29t23:59:59.123456789z', '2026-09-07T00:00:00Z',
                   '2026-09-07T00:00:00', '2026-09-07 00:00:00Z',
                   '２０２６-09-07T00:00:00Z', '2026-09-07T00:00:00.１Z']
        script = """
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const {outputFiles} = await build({entryPoints:['packages/shared/src/import-validate.ts'],bundle:true,write:false,format:'esm',platform:'neutral',mainFields:['module','main']}); const code=outputFiles[0].text;
const {validateImportFile} = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const {base, values} = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(values.map(extractedAt => validateImportFile({
  ...base, source: {...base.source, extractedAt},
}).issues.length === 0)));
"""
        result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
                                input=json.dumps({'base': FIXTURES['base'], 'values': values}),
                                capture_output=True, text=True, check=True)
        expected = json.loads(result.stdout)
        self.assertEqual(len(expected), len(values))
        for value, valid in zip(values, expected):
            with self.subTest(value=value):
                self.assertEqual(validator.valid_timestamp(value), valid)

    def test_cli_invalid_structures_do_not_crash(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bad.json'
            for value in [None, [], {'questions': None}, {'questions': 3},
                          contract_case({'set': {'/questions/0/type': []}, 'remove': []})]:
                path.write_text(json.dumps(value))
                result = subprocess.run([sys.executable, str(SCRIPTS / 'validate_quiz.py'), str(path)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertNotIn('Traceback', result.stderr)

    def test_transport_limits(self):
        self.assertEqual({'maxBytes': validator.IMPORT_BODY_MAX_BYTES, 'maxDepth': validator.IMPORT_JSON_MAX_DEPTH}, FIXTURES['transportLimits'])
        validator.check_transport(json.dumps({'stem': 'Brackets [ { and escaped quotes " are text.'}))
        with self.assertRaisesRegex(ValueError, 'nesting'):
            validator.check_transport('[' * 33 + ']' * 33)
        with patch.object(validator, 'IMPORT_BODY_MAX_BYTES', 8):
            with self.assertRaisesRegex(ValueError, 'bytes'):
                validator.check_transport('{"x":"字"}')

    def test_nonfinite_points(self):
        for points in [float('inf'), float('-inf'), float('nan')]:
            data = copy.deepcopy(FIXTURES['base'])
            data['questions'][0]['points'] = points
            self.assertTrue(validator.validate(data)[0])


@unittest.skipUnless(importlib.util.find_spec('jsonschema'), 'optional jsonschema is not installed')
class SchemaTests(unittest.TestCase):
    def test_schema_agrees_on_structural_contract(self):
        import jsonschema
        script = """
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const {outputFiles} = await build({entryPoints:['packages/shared/src/import-schema.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const code=outputFiles[0].text;
const module = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
console.log(JSON.stringify(module.questionImportJsonSchema));
"""
        result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT, capture_output=True, text=True, check=True)
        schema = json.loads(result.stdout)
        checker = jsonschema.FormatChecker()
        checker.checks('date-time')(validator.valid_timestamp)
        jsonschema.Draft7Validator.check_schema(schema)
        check = jsonschema.Draft7Validator(schema, format_checker=checker)
        # These require cross-field identity/reference checks outside JSON Schema draft 7.
        semantic_only = {'duplicate external IDs', 'duplicate option IDs', 'missing answer option'}
        for case in FIXTURES['cases']:
            with self.subTest(case=case['name']):
                expected = case.get('schemaValid', case['valid'] or case['name'] in semantic_only)
                self.assertEqual(check.is_valid(contract_case(case)), expected)


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.pdf = Path(self.tmp.name) / 'sample.pdf'
        self.pdf.write_bytes(b'%PDF test input')
        self.assets = Path(self.tmp.name) / 'assets'

    def extract(self, pages, count=None, **kwargs):
        with patch.object(extractor, 'extract_native', return_value=(pages, [])), patch.object(extractor, 'page_count', return_value=count):
            return extractor.extract(self.pdf, self.assets, **kwargs)

    def test_missing_page_and_missing_ocr_are_not_success(self):
        with patch.object(extractor, 'ocr_page', side_effect=RuntimeError('missing OCR')):
            document, report = self.extract([extractor.text_page('readable text ' * 10, 'test')], 2)
        self.assertEqual(document['status'], 'partial')
        self.assertEqual(len(document['pages']), 2)
        self.assertEqual(document['pages'][1]['status'], 'failed')
        self.assertIn('missing OCR', report['pages'][1]['errors'][0])
        self.assertTrue(report['issues'])

    def test_native_preserved_when_ocr_is_worse(self):
        page = extractor.text_page('A short correct line.', 'test')
        with patch.object(extractor, 'ocr_page', return_value=''):
            document, _ = self.extract([page], 1)
        self.assertEqual(document['pages'][0]['selectedText'], 'A short correct line.')
        self.assertEqual(len(document['pages'][0]['blocks']), 2)

    def test_ocr_can_recover_without_native_backend(self):
        with patch.object(extractor, 'ocr_page', return_value='Recovered question and answer ' * 4):
            document, _ = self.extract([], 1)
        self.assertEqual(document['status'], 'partial')
        self.assertIn('Recovered', document['pages'][0]['selectedText'])

    def test_blank_pages_do_not_require_ocr(self):
        page = {'blocks': [], 'blank': True, 'visualCoverage': 'native'}
        with patch.object(extractor, 'ocr_page') as ocr:
            document, _ = self.extract([page], 1)
        ocr.assert_not_called()
        self.assertEqual(document['status'], 'complete')
        self.assertEqual(document['pages'][0]['status'], 'blank')

    def test_native_backend_exception_falls_back(self):
        page = extractor.text_page('recovered', 'pypdf')
        with patch.object(extractor.importlib.util, 'find_spec', return_value=object()), patch.object(extractor, 'extract_backend', side_effect=[ValueError('broken PDF decoder'), [page]]):
            pages, attempts = extractor.extract_native(self.pdf, self.assets)
        self.assertEqual(pages, [page])
        self.assertEqual(attempts[0]['status'], 'failed')
        self.assertEqual(attempts[1]['backend'], 'pypdf')

    def test_cli_partial_exit_and_artifacts(self):
        output = Path(self.tmp.name) / 'source.txt'
        with patch.object(sys, 'argv', ['extract', str(self.pdf), '-o', str(output)]), patch.object(extractor, 'extract_native', return_value=([extractor.text_page('short', 'test')], [])), patch.object(extractor, 'page_count', return_value=1), patch.object(extractor, 'ocr_page', side_effect=RuntimeError('tesseract: language missing')):
            self.assertEqual(extractor.main(), 3)
        self.assertEqual(json.loads(output.with_suffix('.report.json').read_text())['status'], 'partial')
        self.assertEqual(json.loads(output.with_suffix('.document.json').read_text())['pages'][0]['blocks'][0]['text'], 'short')

    def test_pdftotext_retains_whitespace_last_page(self):
        def run(args):
            Path(args[-1]).write_text('first\f \n\f')
        with patch.object(extractor, 'command', side_effect=run):
            self.assertEqual(len(extractor.extract_backend(self.pdf, 'pdftotext', self.assets)), 2)


def evidence_fixture():
    doc = {'version': '1.0', 'documentId': 'sha256:fixture', 'pageCount': 2,
           'originalFileName': 'sample.pdf', 'extractedAt': '2026-09-07T00:00:00Z', 'issues': [], 'pages': []}
    for number in (1, 2):
        blocks = []
        for name, text in [('stem', 'Which value is even?'), ('options', 'A. 2 B. 3'), ('answer', 'Section A / 1: A')]:
            blocks.append({'id': f'p{number}-{name}', 'kind': 'text', 'text': text, 'documentId': doc['documentId'], 'page': number, 'method': 'fixture', 'bbox': None})
        doc['pages'].append({'page': number, 'blocks': blocks})
    inv = {'version': '1.0', 'documentId': doc['documentId'], 'exam': FIXTURES['base']['exam'],
           'coverage': {'questionCount': 1, 'answerEntryCount': 1},
           'pageReviews': [{'page': n, 'status': 'reviewed', 'reason': 'Compared with the original page.'} for n in (1, 2)],
           'questions': [{'externalId': 'Section-A-Q1', 'sourceQuestionId': 'Section A / 1', 'order': 1, 'status': 'ready',
                          'data': copy.deepcopy(FIXTURES['base']['questions'][0]),
                          'sources': {'stem': ['p1-stem'], 'options': {'A': ['p1-options'], 'B': ['p2-options']}, 'correctAnswers': {'A': ['p2-answer']}}}],
           'answerEntries': [{'id': 'a1', 'sourceQuestionId': 'Section A / 1', 'blockRefs': ['p2-answer'], 'correctAnswers': ['A'], 'questionId': 'Section-A-Q1'}],
           'ignoredBlocks': [{'blockId': bid, 'reason': 'Alternative extraction copy.'} for bid in ['p1-answer', 'p2-stem']]}
    return doc, inv


class InventoryTests(unittest.TestCase):
    def test_cross_page_evidence_exports_valid_import(self):
        doc, inv = evidence_fixture()
        output, report = builder.reconcile(doc, inv, Path('.'))
        self.assertFalse(validator.validate(output)[0])
        self.assertEqual(report['counts']['exported'], 1)
        self.assertNotIn('sources', output['questions'][0])

    def test_rejects_incomplete_or_conflicting_evidence(self):
        changes = [
            lambda d, i: i['questions'][0]['sources']['options'].pop('B'),
            lambda d, i: i['questions'][0]['sources']['correctAnswers'].update(A=['missing']),
            lambda d, i: i['questions'][0].update(status='pending'),
            lambda d, i: i['questions'].append(copy.deepcopy(i['questions'][0])),
            lambda d, i: i['coverage'].update(questionCount=2),
            lambda d, i: i['pageReviews'].pop(),
            lambda d, i: i['pageReviews'][1].update(status='excluded'),
            lambda d, i: i['ignoredBlocks'].pop(),
            lambda d, i: i['answerEntries'][0].update(questionId='Q99'),
            lambda d, i: i['answerEntries'][0].update(correctAnswers=['B']),
            lambda d, i: i['questions'][0].update(expectedAnswerCount=2),
            lambda d, i: i['answerEntries'][0].update(sourceQuestionId='Section B / 1'),
            lambda d, i: i['answerEntries'][0].update(blockRefs=['p1-stem']),
            lambda d, i: d.update(pageCount=3),
            lambda d, i: d.update(documentId='different'),
            lambda d, i: i['questions'][0].update(order=3),
        ]
        for index, change in enumerate(changes):
            with self.subTest(index=index):
                doc, inv = evidence_fixture()
                change(doc, inv)
                with self.assertRaises(builder.Invalid):
                    builder.reconcile(doc, inv, Path('.'))

    def test_missing_and_unsafe_assets_rejected(self):
        for path in ['missing.png', '../outside.png', '/tmp/absent.png']:
            doc, inv = evidence_fixture()
            doc['pages'][0]['blocks'][0].update(kind='image', asset=path)
            with self.assertRaisesRegex(builder.Invalid, 'image asset'):
                builder.reconcile(doc, inv, Path('.'))

    def test_all_unresolved_withheld_and_counted(self):
        doc, inv = evidence_fixture()
        inv['questions'][0].update(status='review', reason='Answer conflicts with another source entry.')
        output, report = builder.reconcile(doc, inv, Path('.'))
        self.assertEqual(output['questions'], [])
        self.assertEqual(report['counts']['review'], 1)

    def test_unmatched_answer_is_reported_with_reason(self):
        doc, inv = evidence_fixture()
        inv['coverage']['answerEntryCount'] += 1
        inv['answerEntries'].append({'id': 'a2', 'sourceQuestionId': 'Section A / 99', 'blockRefs': ['p2-answer'], 'questionId': None, 'reason': 'No corresponding question in the PDF.'})
        _, report = builder.reconcile(doc, inv, Path('.'))
        self.assertEqual(len(report['unmatchedAnswerEntries']), 1)

    def test_merge_refuses_overlap_and_changed_source_identity(self):
        doc, inv = evidence_fixture()
        row = copy.deepcopy(inv['questions'][0])
        inv['questions'][0] = {key: row[key] for key in ['externalId', 'sourceQuestionId', 'order']}
        inv['questions'][0]['status'] = 'pending'
        batch = {'documentId': doc['documentId'], 'questions': [row]}
        merged = builder.merge_batches(inv, [batch])
        self.assertEqual(builder.reconcile(doc, merged, Path('.'))[1]['counts']['exported'], 1)
        with self.assertRaises(builder.Invalid):
            builder.merge_batches(inv, [batch, batch])
        row['sourceQuestionId'] = 'Section B / 1'
        with self.assertRaises(builder.Invalid):
            builder.merge_batches(inv, [batch])

    def test_pending_validation_cannot_export(self):
        doc, inv = evidence_fixture()
        inv['questions'][0]['status'] = 'pending'
        output, report = builder.reconcile(doc, inv, Path('.'), allow_pending=True)
        self.assertEqual(report['counts']['pending'], 1)
        self.assertFalse(output['questions'])

    def test_batch_order_does_not_change_source_order(self):
        doc, inv = evidence_fixture()
        first = copy.deepcopy(inv['questions'][0])
        second = copy.deepcopy(first)
        second.update(externalId='Section-A-Q2', sourceQuestionId='Section A / 2', order=2)
        second['data']['externalId'] = second['externalId']
        inv['questions'] = [{key: row[key] for key in ('externalId', 'sourceQuestionId', 'order')} | {'status': 'pending'} for row in (first, second)]
        inv['coverage'].update(questionCount=2, answerEntryCount=2)
        inv['answerEntries'].append(dict(inv['answerEntries'][0], id='a2', questionId=second['externalId'], sourceQuestionId=second['sourceQuestionId']))
        batches = [{'documentId': doc['documentId'], 'questions': [row]} for row in (second, first)]
        output, _ = builder.reconcile(doc, builder.merge_batches(inv, batches), Path('.'))
        self.assertEqual([q['externalId'] for q in output['questions']], [first['externalId'], second['externalId']])

    def test_skill_archive_runs_without_repository(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / 'pdf-to-quiz.skill'
            skill = SCRIPTS.parent
            with zipfile.ZipFile(archive, 'w') as bundle:
                for path in skill.rglob('*'):
                    if path.is_file() and '__pycache__' not in path.parts:
                        bundle.write(path, path.relative_to(skill.parent))
            with zipfile.ZipFile(archive) as bundle:
                bundle.extractall(root)
            doc, inv = evidence_fixture()
            (root / 'document.json').write_text(json.dumps(doc))
            (root / 'inventory.json').write_text(json.dumps(inv))
            result = subprocess.run([sys.executable, '-I', str(root / 'pdf-to-quiz/scripts/validate_quiz.py'), '--help'], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([sys.executable, str(root / 'pdf-to-quiz/scripts/build_quiz.py'), 'document.json', 'inventory.json', '--output', 'quiz.json'], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(validator.validate(json.loads((root / 'quiz.json').read_text()))[0])

    def test_cli_export_and_all_unresolved_rerun(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            doc, inv = evidence_fixture()
            (root / 'document.json').write_text(json.dumps(doc))
            source = root / 'inventory.json'
            output = root / 'quiz.json'
            args = [sys.executable, str(SCRIPTS / 'build_quiz.py'), str(root / 'document.json'), str(source), '--output', str(output)]
            source.write_text(json.dumps(inv))
            result = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(output.is_file())
            self.assertTrue(output.with_suffix('.inventory.json').is_file())
            inv['questions'][0].update(status='review', reason='Answer cannot be confirmed.')
            source.write_text(json.dumps(inv))
            result = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(output.exists())
            self.assertEqual(json.loads(output.with_suffix('.review.json').read_text())['counts']['review'], 1)


@unittest.skipUnless(importlib.util.find_spec('fitz'), 'optional PyMuPDF is not installed')
class RealPdfTests(unittest.TestCase):
    def test_text_image_and_blank_pdf_pages(self):
        import fitz
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf = root / 'sample.pdf'
            with fitz.open() as doc:
                p = doc.new_page()
                p.insert_text((40, 40), 'Question 1: Which value is even? Select exactly one answer. A. 2 B. 3 Answer: A')
                p = doc.new_page()
                p.draw_rect(fitz.Rect(40, 40, 100, 100))
                doc.new_page()
                doc.save(pdf)
            with patch.object(extractor, 'ocr_page', side_effect=RuntimeError('OCR intentionally unavailable')):
                document, report = extractor.extract(pdf, root / 'assets')
            self.assertEqual(len(document['pages']), 3)
            self.assertEqual(document['pages'][0]['status'], 'extracted')
            self.assertEqual(document['pages'][2]['status'], 'blank')
            image = next(b for b in document['pages'][1]['blocks'] if b['kind'] == 'image')
            self.assertTrue((root / image['asset']).is_file())
            self.assertIsNotNone(document['pages'][0]['blocks'][0]['bbox'])
            self.assertEqual(report['status'], 'partial')


if __name__ == '__main__':
    unittest.main()
