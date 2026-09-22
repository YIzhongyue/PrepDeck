"""Answer reconciliation, evidence geometry and conservative component recovery."""

import copy
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "skills/pdf-to-quiz/scripts"))
from answer_evidence import collect, select_refinement
from pdf_layouts import get_layout
from prepare_layout import prepare, stream, evidence
from prepare_components import prepare_components
from composition import compact_sources, plan_components
from review_components import render
from test_components import document

EXAM = {"id": "lab", "name": "Lab"}


def separate(answer):
    doc = document("Question 1\nPick one\nA. Yes\nB. No")
    page = copy.deepcopy(doc["pages"][0])
    page.update(page=2, selectedText=answer)
    page["blocks"][0].update(id="p2-b1", page=2, text=answer, method="tesseract")
    doc["pages"].append(page)
    doc["pageCount"] = 2
    plan = {
        "sections": [
            {"id": "paper", "role": role, "startPage": n, "endPage": n}
            for n, role in [(1, "questions"), (2, "answers")]
        ]
    }
    return doc, plan


class AnswerRecoveryTests(unittest.TestCase):
    def test_configured_sequence_gap_withholds_region_but_default_allows_reordering(
        self,
    ):
        doc, plan = separate("Answer 1: A\nThe correct answer is A.\nAnswer 3: B")
        plan["sections"][1]["answerSequence"] = "ascending-consecutive"
        inv = prepare_components(doc, "scanned-separate", "book", EXAM, plan)
        self.assertEqual(
            inv["package"]["questions"][0]["scoring"]["correctAnswers"], []
        )
        self.assertEqual(
            inv["report"]["quality"]["uncertainAnswerBoundaries"], ["paper / 1"]
        )
        plan["sections"][1].pop("answerSequence")
        self.assertEqual(
            prepare_components(doc, "scanned-separate", "book", EXAM, plan)["package"][
                "questions"
            ][0]["scoring"]["correctAnswers"],
            ["A"],
        )

    def test_independent_source_conflicts_clear_scoring_and_keep_both_keys(self):
        doc, plan = separate("Answer 1: B")
        reference = {
            "documentId": doc["documentId"],
            "review": {"status": "reviewed", "reason": "Compared original key"},
            "entries": [
                {
                    "sourceQuestionId": "paper / 1",
                    "correctAnswers": ["A"],
                    "blockRefs": ["p2-b1"],
                }
            ],
        }
        inv = prepare_components(doc, "scanned-separate", "book", EXAM, plan, reference)
        self.assertEqual(
            inv["package"]["questions"][0]["scoring"]["correctAnswers"], []
        )
        self.assertEqual(inv["report"]["answerCrosscheck"]["compared"], 1)
        self.assertEqual(len(inv["report"]["answerCrosscheck"]["conflicts"]), 1)
        self.assertEqual(len(inv["reviews"][0]["answerEntries"]), 2)
        reference["entries"][0]["blockRefs"] = ["missing"]
        with self.assertRaisesRegex(ValueError, "retained source blocks"):
            prepare_components(doc, "scanned-separate", "book", EXAM, plan, reference)

    def test_reference_does_not_fill_missing_keys_or_accept_unreviewed_input(self):
        doc, plan = separate("Answer 1: ?")
        reference = {
            "documentId": doc["documentId"],
            "review": {"status": "reviewed", "reason": "Compared original key"},
            "entries": [
                {
                    "sourceQuestionId": "paper / 1",
                    "correctAnswers": ["A"],
                    "blockRefs": ["p2-b1"],
                }
            ],
        }
        inv = prepare_components(doc, "scanned-separate", "book", EXAM, plan, reference)
        self.assertEqual(
            inv["package"]["questions"][0]["scoring"]["correctAnswers"], []
        )
        self.assertEqual(inv["report"]["answerCrosscheck"]["compared"], 0)
        reference["review"]["status"] = "pending"
        with self.assertRaisesRegex(ValueError, "source review"):
            prepare_components(doc, "scanned-separate", "book", EXAM, plan, reference)

    def test_conclusion_recovers_unreadable_header_without_guessing(self):
        doc, plan = separate("Answer 1: ?\nThe correct answer is B.")
        inv = prepare_components(doc, "scanned-separate", "book", EXAM, plan)
        self.assertEqual(
            inv["package"]["questions"][0]["scoring"]["correctAnswers"], ["B"]
        )
        self.assertEqual(
            inv["answerEntries"][0]["observations"][0]["method"], "conclusion"
        )
        self.assertEqual(inv["report"]["quality"]["questionsWithAnswers"], 1)
        self.assertEqual(inv["reviews"][0]["status"], "review")

    def test_conflicting_header_conclusion_withholds_answer(self):
        doc, plan = separate("Answer 1: A\nThe correct answer is B.")
        inv = prepare_components(doc, "scanned-separate", "book", EXAM, plan)
        self.assertEqual(
            inv["package"]["questions"][0]["scoring"]["correctAnswers"], []
        )
        self.assertEqual(
            inv["report"]["quality"]["conflictingSourceQuestions"], ["paper / 1"]
        )
        self.assertEqual(len(inv["answerEntries"]), 2)
        self.assertEqual(inv["reviews"][0]["answerEvidence"], ["p2-b1"])

    def test_prior_ocr_recovers_key_and_retains_failed_observation(self):
        doc, plan = separate("Answer 1: ?\nExplanation")
        previous = copy.deepcopy(doc["pages"][1]["blocks"][0])
        previous.update(id="p2-b2", text="Answer 1: B\nEarlier OCR")
        doc["pages"][1]["blocks"].append(previous)
        inv = prepare(doc, "scanned-separate", "book", EXAM, plan)
        self.assertEqual(inv["questions"][0]["data"]["correctAnswers"], ["B"])
        self.assertEqual(
            inv["questions"][0]["sources"]["correctAnswers"], {"B": ["p2-b2"]}
        )
        self.assertTrue(inv["answerEntries"][0]["unreadableObservations"])
        self.assertEqual(inv["preparationReport"]["sections"][1]["detectedAnswers"], 1)

    def test_prior_ocr_conflict_is_not_silently_overwritten(self):
        doc, plan = separate("Answer 1: B")
        previous = copy.deepcopy(doc["pages"][1]["blocks"][0])
        previous.update(id="p2-b2", text="Answer 1: A")
        doc["pages"][1]["blocks"].append(previous)
        inv = prepare(doc, "scanned-separate", "book", EXAM, plan)
        self.assertEqual(inv["questions"][0]["data"]["correctAnswers"], [])
        self.assertIn("Conflicting", inv["questions"][0]["reason"])

    def test_prior_readable_key_does_not_hide_uncertain_selected_boundary(self):
        doc, plan = separate("Answer 1: ?\nAnswer 3: B")
        plan["sections"][1]["answerSequence"] = "ascending-consecutive"
        previous = copy.deepcopy(doc["pages"][1]["blocks"][0])
        previous.update(id="p2-b2", text="Answer 1: B")
        doc["pages"][1]["blocks"].append(previous)
        inv = prepare_components(doc, "scanned-separate", "book", EXAM, plan)
        self.assertEqual(
            inv["package"]["questions"][0]["scoring"]["correctAnswers"], []
        )
        self.assertEqual(
            inv["report"]["quality"]["uncertainAnswerBoundaries"], ["paper / 1"]
        )

    def test_header_boundaries_and_orphan_conclusions(self):
        profile = get_layout("scanned-separate")
        self.assertEqual(collect("The correct answer is B.", profile), [])
        rows = collect(
            "Answer 1: ?\nUnknown\nAnswer 2: ?\nThe correct answer is B.", profile
        )
        self.assertFalse(rows[0]["observations"])
        self.assertEqual(rows[1]["observations"][0]["correctAnswers"], ["B"])

    def test_unreadable_candidates_are_not_reported_as_answers(self):
        doc, plan = separate("Answer 1: ?")
        inv = prepare_components(doc, "scanned-separate", "book", EXAM, plan)
        quality = inv["report"]["quality"]
        self.assertEqual(quality["answerCandidates"], 1)
        self.assertEqual(quality["readableAnswerEntries"], 0)
        self.assertEqual(quality["questionsWithAnswers"], 0)
        self.assertEqual(
            inv["report"]["preparation"]["sections"][1]["detectedAnswers"], 0
        )

    def test_same_numbers_in_another_section_do_not_supply_answers(self):
        doc, plan = separate("Answer 1: B")
        plan["sections"][1]["id"] = "other-paper"
        inv = prepare(doc, "scanned-separate", "book", EXAM, plan)
        self.assertEqual(inv["questions"][0]["data"]["correctAnswers"], [])
        self.assertIsNone(inv["answerEntries"][0]["questionId"])

    def test_refinement_preserves_lost_or_changed_evidence(self):
        profile = get_layout("scanned-separate")
        old = "Answer 1: B\nExplanation"
        for new in ["", "Answer 1: ?\nExplanation", "Answer 1: A\nExplanation"]:
            self.assertEqual(select_refinement(old, new, profile)[0], old)
        new = old + "\nAdditional readable explanation"
        self.assertEqual(select_refinement(old, new, profile)[0], new)


class CompositionRecoveryTests(unittest.TestCase):
    def table(self):
        doc = document("Before\nLabel | Value\npH | 7\nAfter")
        block = copy.deepcopy(doc["pages"][0]["blocks"][0])
        block.update(
            id="table-1",
            kind="table",
            text="Label | Value\npH | 7",
            bbox=[1, 2, 30, 40],
            table={
                "num_rows": 2,
                "num_cols": 2,
                "table_cells": [
                    {
                        "start_row_offset_idx": r,
                        "start_col_offset_idx": c,
                        "text": v,
                        "column_header": r == 0,
                        "row_span": 1,
                        "col_span": 1,
                    }
                    for r, row in enumerate([["Label", "Value"], ["pH", "7"]])
                    for c, v in enumerate(row)
                ],
            },
        )
        doc["pages"][0]["blocks"].append(block)
        item = {
            "body": [
                {
                    "id": "prompt",
                    "type": "paragraph",
                    "text": doc["pages"][0]["selectedText"],
                }
            ],
            "interaction": {"type": "choice", "options": []},
        }
        return doc, block, item

    def test_exact_table_span_dispatches_handler_and_preserves_surroundings(self):
        doc, block, item = self.table()
        result = plan_components(doc, item, [], [block])
        self.assertEqual(result[0]["status"], "assembled")
        self.assertEqual(
            [b["type"] for b in item["body"]], ["paragraph", "table", "paragraph"]
        )
        self.assertEqual(item["body"][1]["rows"], [["pH", "7"]])
        self.assertEqual(item["body"][1]["sources"][0]["bbox"], [1, 2, 30, 40])
        self.assertEqual(item["body"][2]["text"], "After")

    def test_preparation_dispatches_structured_table_without_manual_plan(self):
        doc, block, _ = self.table()
        text = (
            "Question 1\nResult:\n"
            + block["text"]
            + "\nPick one\nA. Yes\nB. No\nAnswer 1: B"
        )
        doc["pages"][0]["selectedText"] = text
        doc["pages"][0]["blocks"][0]["text"] = text
        plan = {
            "sections": [
                {"id": "lab", "role": "interleaved", "startPage": 1, "endPage": 1}
            ]
        }
        inv = prepare_components(doc, "native-interleaved", "book", EXAM, plan)
        self.assertEqual(inv["report"]["quality"]["assembledTables"], 1)
        self.assertEqual(inv["reviews"][0]["status"], "review")
        self.assertIn(
            "table", [b["type"] for b in inv["package"]["questions"][0]["body"]]
        )

    def test_ambiguous_tables_and_figures_remain_review_candidates(self):
        for mutate in [
            lambda b, q: q["body"].append(copy.deepcopy(q["body"][0])),
            lambda b, q: b["table"]["table_cells"][0].update(column_header=False),
            lambda b, q: b["table"]["table_cells"][0].update(col_span=2),
        ]:
            doc, block, item = self.table()
            mutate(block, item)
            self.assertEqual(
                plan_components(doc, item, [], [block])[0]["status"], "review"
            )
            self.assertTrue(all(b["type"] == "paragraph" for b in item["body"]))
        doc, block, item = self.table()
        block.update(kind="image", asset="page.png")
        self.assertEqual(plan_components(doc, item, [], [block])[0]["type"], "figure")
        self.assertEqual(len(item["body"]), 1)

    def test_native_spans_do_not_attach_neighbour_question_blocks(self):
        doc = document("First question\nSecond question")
        original = doc["pages"][0]["blocks"][0]
        original.update(text="First question", bbox=[0, 0, 10, 10])
        second = {
            **original,
            "id": "p1-b2",
            "text": "Second question",
            "bbox": [0, 20, 10, 30],
        }
        doc["pages"][0]["blocks"].append(second)
        text, ranges = stream(doc, 1, 1)
        self.assertEqual(evidence(ranges, 0, text.index("Second"))[0], ["p1-b1"])

    def test_source_budget_never_silently_drops_later_pages(self):
        sources = [
            {"documentId": "doc", "page": n // 20 + 1, "bbox": [0, n, 1, n + 1]}
            for n in range(50)
        ]
        self.assertEqual([s["page"] for s in compact_sources(sources)], [1, 2, 3])

    def test_review_html_escapes_source_text_and_rejects_external_assets(self):
        doc, plan = separate("Answer 1: B")
        inv = prepare_components(doc, "scanned-separate", "book", EXAM, plan)
        doc["pages"][0]["selectedText"] = '</script><script>alert("x")</script>'
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            html = render(doc, inv, root, root / "review.html")
            self.assertNotIn("</script><script>alert", html)
            self.assertIn("\\u003c/script>", html)
            doc["pages"][0]["blocks"].append(
                {"id": "escape", "kind": "image", "asset": "../outside.png"}
            )
            with self.assertRaisesRegex(ValueError, "inside evidence"):
                render(doc, inv, root, root / "review.html")


if __name__ == "__main__":
    unittest.main()
