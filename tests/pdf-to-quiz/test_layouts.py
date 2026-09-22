import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'skills/pdf-to-quiz/scripts'))
import prepare_layout as parser
import extract_pdf as extractor
import build_quiz as builder
import boxed_ocr
from functools import partial
from pdf_layouts import load_profiles
load_profiles(Path(__file__).resolve().parents[2] / "skills/pdf-to-quiz/references/profiles/japanese-sg.json")
# This test suite exercises the optional Japanese document profile, not core exam logic.
recognize = partial(boxed_ocr.recognize, label_pattern=r"(問|設問)\s*([0-9０-９]{1,3})?")


EXAM = {'id': 'ipa-sg', 'name': 'SG', 'language': 'ja'}


def document(*texts):
    return {'version': '1.0', 'documentId': 'sha256:test', 'pageCount': len(texts), 'issues': [],
            'originalFileName': 'synthetic.pdf', 'extractedAt': '2026-09-22T00:00:00Z',
            'pages': [{'page': i, 'selectedText': text, 'blocks': [
                {'id': f'p{i}-b1', 'page': i, 'documentId': 'sha256:test', 'kind': 'text',
                 'text': text, 'method': 'test', 'bbox': None}]} for i, text in enumerate(texts, 1)]}


def native(era='令和7年度', answer='イ'):
    return f'{era}\n情報セキュリティマネジメント試験\n科目A　公開問題\n問1\n正しい数はどれか。\nア　1\nイ　2\n問1：正答 {answer}\n公式の解説。'


class LayoutTests(unittest.TestCase):
    def test_interleaved_cross_page_and_repeated_numbers(self):
        doc = document(native().replace('イ　2', 'イ　\n2'), native('令和6年度', 'ア'))
        inv = parser.prepare(doc, 'ja-sg-interleaved', 'book-2025', EXAM)
        self.assertEqual(inv['coverage'], {'questionCount': 2, 'answerEntryCount': 2})
        self.assertNotEqual(inv['questions'][0]['externalId'], inv['questions'][1]['externalId'])
        self.assertTrue(all(q['externalId'].endswith(':q1') for q in inv['questions']))
        self.assertEqual(inv['questions'][1]['data']['correctAnswers'], ['ア'])
        self.assertNotIn('令和6年度', inv['questions'][0]['data']['explanation'])
        self.assertTrue(all(q['status'] == 'review' for q in inv['questions']))
        self.assertEqual(inv['pageReviews'], [])

    def test_choice_combination_is_one_answer_and_cross_page_text_survives(self):
        doc = document(native().split('問1：')[0].replace('ア　1', 'ア　（一）、（三）'),
                       '問1：正答 ア\n組合せを選ぶ。')
        inv = parser.prepare(doc, 'ja-sg-interleaved', 'book', EXAM)
        q = inv['questions'][0]
        self.assertEqual(q['data']['type'], 'single_choice')
        self.assertEqual(q['data']['options'][0]['text'], '（一）、（三）')
        self.assertEqual(q['sources']['correctAnswers']['ア'], ['p2-b1'])
        self.assertEqual(q['reviewPages'], [1, 2])

    def test_sample_dates_disambiguate_subject_b(self):
        heading = '情報セキュリティマネジメント試験\n科目Bのサンプル問題\n※公開日：2022年{}月25日\n問1\n問い\nア　答え\n問1：正答 ア'
        inv = parser.prepare(document(heading.format(4), heading.format(12)), 'ja-sg-interleaved', 'book', EXAM)
        self.assertNotEqual(inv['questions'][0]['externalId'], inv['questions'][1]['externalId'])

    def test_duplicate_scope_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Repeated section'):
            parser.prepare(document(native(), native()), 'ja-sg-interleaved', 'book', EXAM)

    def test_ocr_requires_explicit_scopes(self):
        with self.assertRaisesRegex(ValueError, '--sections'):
            parser.prepare(document('問1 本文'), 'ja-sg-textbook-ocr', 'book', EXAM)

    def test_separate_answers_matched_by_scope_and_number_not_position(self):
        doc = document('問1 問い一\nア　1\nイ　2\n問2 問い二\nア　3\nイ　4',
                       '問2：イ\n二の解説\n問1：ア\n一の解説',
                       '問1 別の試験\nア　5\nイ　6', '問1：イ\n別の解説')
        plan = {'sections': [{'id': sid, 'role': role, 'startPage': n, 'endPage': n}
                            for sid, role, n in [('mock-a','questions',1), ('mock-a','answers',2),
                                                 ('sample-a','questions',3), ('sample-a','answers',4)]]}
        inv = parser.prepare(doc, 'ja-sg-textbook-ocr', 'book', EXAM, plan)
        self.assertEqual([q['data']['correctAnswers'] for q in inv['questions']], [['ア'], ['イ'], ['イ']])
        self.assertEqual(inv['questions'][0]['data']['explanation'], '一の解説')
        self.assertEqual(inv['questions'][0]['data']['stem'], '問い一')

    def test_missing_ocr_headers_fail_expected_inventory_count(self):
        doc = document('認識できない題番号\nア　1\nイ　2')
        plan = {'sections': [{'id': 'mock-a', 'role': 'questions', 'startPage': 1, 'endPage': 1, 'expectedQuestions': 2}]}
        inv = parser.prepare(doc, 'ja-sg-textbook-ocr', 'book', EXAM, plan)
        self.assertEqual(inv['coverage']['questionCount'], 0)
        self.assertTrue(inv['preparationReport']['warnings'])
        inv['pageReviews'] = [{'page': 1, 'status': 'reviewed', 'reason': 'Checked original'}]
        with self.assertRaisesRegex(builder.Invalid, 'expected 2'):
            builder.reconcile(doc, inv, Path('.'))

    def test_scanned_answer_separators_allow_noise_but_never_guess_kana(self):
        doc = document('問1 本文\nア　甲\nイ　乙\n問2 別問\nア　甲\nエ　乙',
                       '問1 | ・ イ\n解説\n問2：工\n誤認識された答え')
        plan = {'sections': [{'id': 'mock-a', 'role': role, 'startPage': n, 'endPage': n}
                             for role, n in [('questions', 1), ('answers', 2)]]}
        inv = parser.prepare(doc, 'ja-sg-textbook-ocr', 'book', EXAM, plan)
        self.assertEqual(inv['questions'][0]['data']['correctAnswers'], ['イ'])
        self.assertEqual(inv['questions'][1]['data']['correctAnswers'], [])
        self.assertNotIn('問2', inv['questions'][0]['data']['explanation'])
        self.assertTrue(any(e['correctAnswers'] is None and e['questionId'].endswith(':q2') for e in inv['answerEntries']))

    def test_reviewed_draft_exports_to_existing_import_contract(self):
        doc = document(native())
        inv = parser.prepare(doc, 'ja-sg-interleaved', 'book', EXAM)
        inv['questions'][0]['status'] = 'ready'
        inv['pageReviews'] = [{'page': 1, 'status': 'reviewed', 'reason': 'Checked original, including all options and answer.'}]
        output, report = builder.reconcile(doc, inv, Path('.'))
        self.assertEqual(output['schemaVersion'], '1.0')
        self.assertEqual(report['counts']['exported'], 1)
        self.assertEqual(output['questions'][0]['correctAnswers'], ['イ'])

    def test_conflicting_answer_entries_stay_in_review(self):
        doc = document('問1 本文\nア　甲\nイ　乙', '問1：ア\n解説', '問1：イ\n別解説')
        plan = {'sections': [{'id': 'sample-a', 'role': role, 'startPage': n, 'endPage': n}
                            for n, role in [(1, 'questions'), (2, 'answers'), (3, 'answers')]]}
        inv = parser.prepare(doc, 'ja-sg-textbook-ocr', 'book', EXAM, plan)
        self.assertIn('Conflicting', inv['questions'][0]['reason'])
        self.assertEqual(len(inv['answerEntries']), 2)

    def test_missing_ocr_policy_does_not_reocr_readable_diagrams(self):
        page = {'blank': False, 'visualCoverage': 'rendered', 'blocks': [
            {'kind': 'text', 'text': 'Readable native text ' * 20, 'method': 'pymupdf'},
            {'kind': 'image', 'text': '', 'method': 'render'}]}
        with tempfile.TemporaryDirectory() as temp:
            pdf = Path(temp) / 'source.pdf'; pdf.write_bytes(b'test')
            with patch.object(extractor, 'extract_native', return_value=([page], [])), patch.object(extractor, 'page_count', return_value=1), patch.object(extractor, 'ocr_page') as ocr:
                doc, _ = extractor.extract(pdf, Path(temp), ocr='missing')
            ocr.assert_not_called()
            self.assertEqual(doc['status'], 'partial')
            self.assertIn('visual_content', doc['pages'][0]['signals'])

    def test_ocr_cache_is_bound_to_document_and_settings(self):
        with tempfile.TemporaryDirectory() as temp:
            pdf = Path(temp) / 'source.pdf'; pdf.write_bytes(b'test')
            def pages(*_):
                return [extractor.text_page('', 'test')], []
            with patch.object(extractor, 'extract_native', side_effect=pages), patch.object(extractor, 'page_count', return_value=1), patch.object(extractor, 'ocr_page', return_value='日本語' * 40) as ocr:
                for language in ['jpn', 'jpn', 'jpn+eng']:
                    extractor.extract(pdf, Path(temp), ocr='always', language=language, cache=Path(temp) / 'cache')
                self.assertEqual(ocr.call_count, 2)


@unittest.skipUnless(importlib.util.find_spec('cv2'), 'optional OpenCV is not installed')
class BoxedOcrTests(unittest.TestCase):
    def image(self, root, shade=80):
        import cv2
        import numpy as np
        pixels = np.full((600, 700), 255, dtype='uint8')
        pixels[100:130, 60:135] = shade
        pixels[110:120, 80:100] = 255
        path = root / 'page.png'
        cv2.imwrite(str(path), pixels)
        return path

    def test_box_number_comes_from_ocr_and_original_pixels_are_preserved(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temp:
            path = self.image(Path(temp)); before = path.read_bytes()
            calls = []
            def command(args):
                calls.append(args)
                return SimpleNamespace(stdout='問２' if args[-1] == '7' else '本文\nア 甲\nイ 乙')
            text = recognize(path, 'jpn', 300, 6, command)
            self.assertIn('問2 本文', text)
            self.assertNotIn('問1', text)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(sum(args[-1] == '7' for args in calls), 2)

    def test_unreadable_box_uses_ordinary_ocr_without_inventing_header(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temp:
            path = self.image(Path(temp))
            text = recognize(path, 'jpn', 300, 6,
                lambda args: SimpleNamespace(stdout='不明' if args[-1] == '7' else 'Original OCR'))
            self.assertEqual(text, 'Original OCR')

    def test_wide_subject_b_bars_and_prompt_boxes_are_recognized_from_pixels(self):
        import cv2
        import numpy as np
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'page.png'
            pixels = np.full((600, 700), 255, dtype='uint8')
            pixels[100:130, 60:620] = 80
            pixels[300:330, 60:135] = 80
            cv2.imwrite(str(path), pixels)
            def command(args):
                if args[-1] == '7':
                    return SimpleNamespace(stdout='問49' if 'label-100-' in args[1] else '設問')
                return SimpleNamespace(stdout='背景' if 'band-1.' in args[1] else '何を選ぶか。')
            result = recognize(path, 'jpn', 300, 6, command)
            self.assertIn('問49 背景', result)
            self.assertIn('設問 何を選ぶか。', result)

    def test_gray_answer_labels_keep_white_background_after_inversion(self):
        import cv2
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temp:
            path = self.image(Path(temp), shade=140)
            def command(args):
                if args[-1] == '7' and args[1].endswith('-0.png'):
                    crop = cv2.imread(args[1], cv2.IMREAD_GRAYSCALE)
                    self.assertEqual(int(crop[22, 22]), 255)
                    self.assertEqual(int(crop.min()), 0)
                return SimpleNamespace(stdout='問2' if args[-1] == '7' else 'イ 解説')
            self.assertIn('問2 イ', recognize(path, 'jpn', 300, 6, command))


if __name__ == '__main__':
    unittest.main()
