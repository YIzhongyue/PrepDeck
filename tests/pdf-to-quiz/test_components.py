"""Cross-domain component semantics and fail-closed source-review regression."""

import base64
import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "skills/pdf-to-quiz/scripts"))
from components import validate_components
from component_handlers import assemble_component
from prepare_components import prepare_components
from build_components import build


def fixture(name):
    return json.loads((ROOT / f"tests/fixtures/components/{name}.json").read_text())


def document(text):
    return {
        "version": "1.0",
        "documentId": "sha256:synthetic",
        "pageCount": 1,
        "originalFileName": "example.pdf",
        "extractedAt": "2026-09-22T00:00:00Z",
        "pages": [
            {
                "page": 1,
                "selectedText": text,
                "blocks": [
                    {
                        "id": "p1-b1",
                        "documentId": "sha256:synthetic",
                        "page": 1,
                        "kind": "text",
                        "method": "test",
                        "text": text,
                        "bbox": None,
                    }
                ],
            }
        ],
    }


class ComponentTests(unittest.TestCase):
    def test_cross_domain_fixtures_and_invalid_references(self):
        for name in ["reading", "code", "case-with-figure", "combination"]:
            with self.subTest(name=name):
                file = fixture(name)
                self.assertEqual(validate_components(file), [])
                file["questions"][0]["stimulusRefs"] = ["unknown"]
                self.assertTrue(validate_components(file))

    def test_shared_case_splits_independent_responses_without_copying_parent_key(self):
        doc = document(
            "Question 1\nShared lab result\nPart 1\nFirst task\nA. Yes\nB. No\nPart 2\nSecond task\nA. Up\nB. Down\nAnswer 1: A"
        )
        plan = {
            "sections": [
                {
                    "id": "lab",
                    "role": "interleaved",
                    "startPage": 1,
                    "endPage": 1,
                    "expectedQuestions": 1,
                }
            ]
        }
        inv = prepare_components(
            doc, "native-interleaved", "book", {"id": "lab", "name": "Lab"}, plan
        )
        self.assertEqual(inv["coverage"]["sourceQuestions"], 1)
        self.assertEqual(len(inv["package"]["questions"]), 2)
        self.assertEqual(len(inv["package"]["stimuli"]), 1)
        self.assertTrue(
            all(
                q["scoring"]["correctAnswers"] == []
                for q in inv["package"]["questions"]
            )
        )
        self.assertTrue(
            all(
                r["status"] == "review" and not r["answerEvidence"]
                for r in inv["reviews"]
            )
        )
        output, report = build(doc, inv)
        self.assertEqual(output["questions"], [])
        self.assertEqual(len(report["withheld"]), 2)

    def reviewed(self):
        file = fixture("code")
        doc = document("Reviewed source question and official key")
        for block in file["questions"][0]["body"] + [
            b for o in file["questions"][0]["interaction"]["options"] for b in o["body"]
        ]:
            block["sources"] = [{"documentId": doc["documentId"], "page": 1}]
        q = file["questions"][0]
        inv = {
            "documentId": doc["documentId"],
            "package": file,
            "coverage": {"sourceQuestions": 1},
            "reviews": [
                {
                    "externalId": q["externalId"],
                    "sourceQuestionId": "lab / 1",
                    "status": "ready",
                    "questionEvidence": ["p1-b1"],
                    "answerEvidence": ["p1-b1"],
                    "answerEntries": ["key"],
                }
            ],
            "answerEntries": [
                {
                    "id": "key",
                    "sourceQuestionId": "lab / 1",
                    "correctAnswers": q["scoring"]["correctAnswers"],
                    "blockRefs": ["p1-b1"],
                }
            ],
            "pageReviews": [
                {"page": 1, "status": "reviewed", "reason": "Compared source and key"}
            ],
        }
        return doc, inv

    def test_review_gate_exports_only_evidenced_items(self):
        doc, inv = self.reviewed()
        output, report = build(doc, inv)
        self.assertEqual(report["exported"], 1)
        self.assertEqual(validate_components(output), [])
        for mutate in [
            lambda i: i.update(documentId="another-document"),
            lambda i: i.update(pageReviews=[]),
            lambda i: i["pageReviews"][0].update(page=200),
            lambda i: i["reviews"][0].update(answerEvidence=[]),
            lambda i: i["answerEntries"].append(
                {
                    "id": "conflict",
                    "sourceQuestionId": "lab / 1",
                    "correctAnswers": ["wrong"],
                }
            ),
            lambda i: i.update(
                sourceExpectations=[{"section": "lab", "questionCount": 2}]
            ),
            lambda i: i["reviews"][0].update(visualEvidence=["p1-b1"]),
            lambda i: i["package"]["questions"][0]["body"][0].pop("sources"),
        ]:
            altered = copy.deepcopy(inv)
            mutate(altered)
            with self.assertRaises(ValueError):
                build(doc, altered)

    def test_structured_table_handler_and_merged_cell_rejection(self):
        doc = document("Heading")
        block = doc["pages"][0]["blocks"][0]
        block.update(
            kind="table",
            table={
                "num_rows": 2,
                "num_cols": 2,
                "table_cells": [
                    {
                        "start_row_offset_idx": r,
                        "start_col_offset_idx": c,
                        "text": value,
                        "row_span": 1,
                        "col_span": 1,
                    }
                    for r, row in enumerate([["Label", "Value"], ["pH", "7"]])
                    for c, value in enumerate(row)
                ],
            },
        )
        spec = {
            "id": "result",
            "type": "table",
            "sourceBlocks": ["p1-b1"],
            "headerRows": 1,
        }
        result, asset = assemble_component(spec, doc, ROOT)
        self.assertEqual(result["columns"], ["Label", "Value"])
        self.assertEqual(result["rows"], [["pH", "7"]])
        self.assertIsNone(asset)
        self.assertEqual(spec["headerRows"], 1)  # Assembly does not mutate plans.
        block["table"]["table_cells"][0]["col_span"] = 2
        with self.assertRaisesRegex(ValueError, "merged"):
            assemble_component(spec, doc, ROOT)

    def test_storage_budget_accounts_for_the_import_baseline(self):
        file = fixture("case-with-figure")
        pixels = base64.b64decode(file["assets"][0]["data"])
        data = base64.b64encode(pixels + bytes(225000 - len(pixels))).decode()
        file["assets"] = [
            {"id": f"chart-{n}", "mediaType": "image/png", "data": data}
            for n in range(3)
        ]
        file["questions"][0]["body"] = [file["questions"][0]["body"][0]] + [
            {
                "id": a["id"],
                "type": "figure",
                "assetId": a["id"],
                "alt": "Synthetic chart",
            }
            for a in file["assets"]
        ]
        self.assertTrue(
            any("storage budget" in issue for issue in validate_components(file))
        )

    def test_order_match_and_combination_cardinality(self):
        file = fixture("code")
        file["questions"][0]["scoring"]["correctAnswers"].pop()
        self.assertTrue(validate_components(file))
        file = fixture("case-with-figure")
        file["questions"][0]["scoring"]["correctAnswers"] = ['["missing","missing"]']
        self.assertTrue(validate_components(file))
        file = fixture("combination")
        file["questions"][0]["interaction"]["options"][0]["memberRefs"] = ["missing"]
        self.assertTrue(validate_components(file))
