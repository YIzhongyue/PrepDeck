import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'skills/pdf-to-quiz/scripts'))
import build_quiz as builder
import prepare_layout as preparer
from subject_b import compile_cases, render_material
from test_layouts import document, EXAM


def fixture():
    doc = document('Synthetic case, table, two prompts, options and both answer keys.')
    bid = 'p1-b1'
    case = {'id': 'book:mock-b:q49', 'sourceQuestionId': 'mock-b / 49',
            'expectedSubquestions': 2, 'reviewed': True, 'materials': [
                {'id': 'passage', 'kind': 'text', 'text': 'A社の共通事例。', 'blockRefs': [bid]},
                {'id': 'table-1', 'kind': 'table', 'caption': '表1　監視記録',
                 'columns': ['項目', '値'], 'rows': [['a1', '0'], ['a2', '1']], 'blockRefs': [bid]}]}
    inv = {'version': '1.0', 'documentId': doc['documentId'], 'exam': EXAM,
           'caseSchemaVersion': '1.0', 'cases': [case], 'coverage': {'questionCount': 2, 'answerEntryCount': 2},
           'questions': [], 'answerEntries': [], 'ignoredBlocks': [],
           'pageReviews': [{'page': 1, 'status': 'reviewed', 'reason': 'Checked the synthetic source.'}],
           'sourceExpectations': [{'section': 'mock-b', 'questionCount': 1, 'unit': 'cases'}]}
    for n, answer in [(1, 'ア'), (2, 'イ')]:
        qid = case['id'] + f':s{n}'
        source = case['sourceQuestionId'] + f' / {n}'
        inv['questions'].append({'externalId': qid, 'sourceQuestionId': source, 'order': n,
            'status': 'ready', 'caseId': case['id'], 'subquestionId': str(n),
            'data': {'type': 'single_choice', 'stem': f'子問{n}を選べ。',
                     'options': [{'id': 'ア', 'text': '（一）、（三）'}, {'id': 'イ', 'text': '（二）、（四）'}],
                     'correctAnswers': [answer]},
            'sources': {'stem': [bid], 'options': {'ア': [bid], 'イ': [bid]}, 'correctAnswers': {answer: [bid]}}})
        inv['answerEntries'].append({'id': f'answer-{n}', 'sourceQuestionId': source, 'blockRefs': [bid],
                                    'correctAnswers': [answer], 'questionId': qid})
    return doc, inv


class SubjectBTests(unittest.TestCase):
    def test_shared_case_and_table_are_in_each_exported_stem_without_mutating_inventory(self):
        doc, inv = fixture(); original = copy.deepcopy(inv)
        first, report = builder.reconcile(doc, inv, Path('.'))
        again, _ = builder.reconcile(doc, inv, Path('.'))
        self.assertEqual(first, again)
        self.assertEqual(inv, original)
        self.assertEqual(report['counts']['exported'], 2)
        for n, q in enumerate(first['questions'], 1):
            self.assertIn('A社の共通事例。', q['stem'])
            self.assertIn('- 項目: a1\n- 値: 0', q['stem'])
            self.assertIn(f'子問{n}', q['stem'])
            self.assertNotIn(f'子問{3-n}', q['stem'])
            self.assertNotIn('caseId', q)
            self.assertEqual(q['type'], 'single_choice')
        self.assertEqual(first['schemaVersion'], '1.0')

    def test_missing_subquestion_and_unknown_case_are_rejected(self):
        for change, message in [
            (lambda inv: inv['questions'].pop(), 'missing or extra'),
            (lambda inv: inv['questions'][0].update(caseId='unknown'), 'unknown case'),
            (lambda inv: inv['questions'][1].update(subquestionId='1'), 'unique within'),
            (lambda inv: inv['questions'][0].update(sourceQuestionId='other / 1'), 'scope disagrees'),
        ]:
            doc, inv = fixture(); change(inv)
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                builder.reconcile(doc, inv, Path('.'))

    def test_shared_material_review_and_page_reviews_are_enforced(self):
        doc, inv = fixture(); inv['cases'][0]['reviewed'] = False
        with self.assertRaisesRegex(ValueError, 'must be reviewed'):
            builder.reconcile(doc, inv, Path('.'))
        doc, inv = fixture()
        more = document('Shared material on another page')['pages'][0]
        more.update(page=2)
        more['blocks'][0].update(id='p2-b1', page=2)
        doc['pages'].append(more); doc['pageCount'] = 2
        inv['cases'][0]['materials'][0]['blockRefs'] = ['p2-b1']
        inv['pageReviews'].append({'page': 2, 'status': 'excluded', 'reason': 'Not yet checked'})
        with self.assertRaisesRegex(ValueError, 'excluded page'):
            builder.reconcile(doc, inv, Path('.'))

    def test_table_cells_preserve_literal_values_and_missing_cells_are_not_invented(self):
        _, inv = fixture(); table = inv['cases'][0]['materials'][1]
        table['rows'] = [['A|B', '<script>\nnext'], ['', '0']]
        rendered = render_material(table)
        self.assertIn('- 項目: A|B', rendered)
        self.assertIn('- 値: <script>\nnext', rendered)
        self.assertIn('- 項目: \n- 値: 0', rendered)
        table['rows'] = [['only one cell']]
        with self.assertRaisesRegex(ValueError, 'row width'):
            render_material(table)

    def test_combination_option_table_retains_headers_labels_and_answer_mapping(self):
        doc, inv = fixture()
        for q in inv['questions']:
            q['data'].pop('options')
            q['optionTable'] = {'columns': ['a1', 'a2'], 'blockRefs': ['p1-b1'], 'rows': [
                {'id': 'ア', 'values': ['0', '1'], 'blockRefs': ['p1-b1']},
                {'id': 'イ', 'values': ['1', '0'], 'blockRefs': ['p1-b1']}]}
        output, _ = builder.reconcile(doc, inv, Path('.'))
        first = output['questions'][0]
        self.assertEqual(first['correctAnswers'], ['ア'])
        self.assertEqual(first['type'], 'single_choice')
        self.assertIn('- a1: 0\n- a2: 1', first['options'][0]['text'])
        inv['questions'][0]['optionTable']['rows'][0]['values'].pop()
        with self.assertRaisesRegex(ValueError, 'row width'):
            builder.reconcile(doc, inv, Path('.'))

    def test_prepare_recognizes_explicit_variable_headers_in_combination_tables(self):
        text = ('令和7年度\n情報セキュリティマネジメント試験\n科目B　公開問題\n問13\n'
                '背景\n設問\n組合せを選べ。\naに関する解答群\na1\na2\nア\n0\n1\nイ\n1\n0\n問13：正答 イ\n説明。')
        inv = preparer.prepare(document(text), 'ja-sg-subject-b', 'book', EXAM)
        row = inv['questions'][0]
        self.assertEqual(row['optionTable']['columns'], ['a1', 'a2'])
        self.assertEqual(row['optionTable']['rows'][1]['values'], ['1', '0'])
        self.assertNotIn('options', row['data'])
        self.assertNotIn('validationIssues', row)

    def test_unresolved_figures_block_ready_questions_but_allow_review_inventory(self):
        doc, inv = fixture()
        blocks = {'p1-b1': doc['pages'][0]['blocks'][0], 'figure': {'kind': 'image'}}
        inv['cases'][0]['materials'].append({'id': 'diagram', 'kind': 'figure', 'description': None,
                                           'textSufficient': False, 'blockRefs': ['figure']})
        with self.assertRaisesRegex(ValueError, 'sufficient text description'):
            compile_cases(inv, blocks)
        for q in inv['questions']: q['status'] = 'review'
        compile_cases(inv, blocks)
        for q in inv['questions']: q['status'] = 'ready'
        inv['cases'][0]['materials'][-1].update(description='A → B の経路。', textSufficient=True)
        compiled = compile_cases(inv, blocks)
        self.assertTrue(all('A → B の経路。' in q['data']['stem'] for q in compiled['questions']))

    def test_expanded_case_must_still_fit_existing_import_limits(self):
        doc, inv = fixture(); inv['cases'][0]['materials'][0]['text'] = 'あ' * 20000
        with self.assertRaisesRegex(ValueError, '20000'):
            builder.reconcile(doc, inv, Path('.'))

    def test_parent_answer_is_not_copied_to_multiple_subquestions(self):
        text = ('令和7年度\n情報セキュリティマネジメント試験\n科目B　公開問題\n問13\n'
                '共通の背景。\n設問1\naに入る値はどれか。\nア　0\nイ　1\n'
                '設問2\nbに入る値はどれか。\nア　2\nイ　3\n問13：正答 ア\n解説。')
        doc = document(text)
        inv = preparer.prepare(doc, 'ja-sg-subject-b', 'book', EXAM)
        self.assertEqual(len(inv['cases']), 1)
        self.assertEqual(len(inv['questions']), 2)
        self.assertEqual(inv['cases'][0]['expectedSubquestions'], 2)
        self.assertEqual(inv['cases'][0]['materials'][0]['text'], '共通の背景。')
        self.assertEqual([q['externalId'] for q in inv['questions']], ['book:2025-b:q13:s1', 'book:2025-b:q13:s2'])
        self.assertTrue(all(q['data']['correctAnswers'] == [] for q in inv['questions']))
        self.assertIsNone(inv['answerEntries'][0]['questionId'])

    def test_native_B_scope_and_standalone_table_option_labels(self):
        a = '令和7年度\n情報セキュリティマネジメント試験\n科目A　公開問題\n問1\nA問題\nア　甲\nイ　乙\n問1：正答 ア\n説明。'
        b = '令和7年度\n情報セキュリティマネジメント試験\n科目B　公開問題\n問13\n背景\n設問\n組合せを選べ。\na1\na2\nア\n0\n1\nイ\n1\n0\n問13：正答 イ\n説明。'
        inv = preparer.prepare(document(a, b), 'ja-sg-subject-b', 'book', EXAM)
        self.assertEqual(len(inv['questions']), 1)
        row = inv['questions'][0]
        self.assertEqual(row['externalId'], 'book:2025-b:q13')
        self.assertEqual(row['data']['options'], [{'id': 'ア', 'text': '0\n1'}, {'id': 'イ', 'text': '1\n0'}])
        self.assertEqual(row['data']['correctAnswers'], ['イ'])
        self.assertEqual(row['data']['type'], 'single_choice')

    def test_separate_B_sections_match_answers_and_preserve_independent_case_counts(self):
        doc = document('問49 長い背景\n設問 適切なのはどれか。\nア　甲\nイ　乙', '問49：イ\n説明。', '問1 Aの問題')
        plan = {'sourceLayout': 'ja-sg-textbook-ocr', 'sections': [
            {'id': 'sample-b', 'subject': 'B', 'role': 'questions', 'startPage': 1, 'endPage': 1, 'expectedQuestions': 1},
            {'id': 'sample-b', 'subject': 'B', 'role': 'answers', 'startPage': 2, 'endPage': 2},
            {'id': 'sample-a', 'role': 'questions', 'startPage': 3, 'endPage': 3}]}
        inv = preparer.prepare(doc, 'ja-sg-subject-b', 'book', EXAM, plan)
        self.assertEqual(inv['questions'][0]['data']['correctAnswers'], ['イ'])
        self.assertEqual(inv['sourceExpectations'], [{'section': 'sample-b', 'questionCount': 1, 'unit': 'cases'}])
        self.assertEqual(inv['questions'][0]['data']['stem'], '適切なのはどれか。')

    @unittest.skipUnless(importlib.util.find_spec('jsonschema'), 'optional jsonschema is not installed')
    def test_published_schema_accepts_generated_and_reviewed_case_inventories(self):
        import jsonschema
        schema = json.loads((ROOT / 'skills/pdf-to-quiz/references/subject-b-case.schema.json').read_text())
        jsonschema.Draft7Validator.check_schema(schema)
        _, inv = fixture()
        jsonschema.validate(inv, schema)
        bad = copy.deepcopy(inv); bad['cases'][0]['expectedSubquestions'] = 0
        with self.assertRaises(jsonschema.ValidationError): jsonschema.validate(bad, schema)
        bad = copy.deepcopy(inv); bad['cases'][0]['materials'][0]['unknown'] = True
        with self.assertRaises(jsonschema.ValidationError): jsonschema.validate(bad, schema)


if __name__ == '__main__':
    unittest.main()
