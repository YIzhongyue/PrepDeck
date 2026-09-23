#!/usr/bin/env python3
"""Build an unapproved component inventory from generic layout candidates.

Segmentation is profile-driven. A parent answer is never assigned to several
child responses. Every candidate retains its source references for review.
"""

import argparse
import json
import re
from pathlib import Path
from pdf_layouts import get_layout, load_profiles
from prepare_layout import prepare
from components import validate_components
from composition import compact_sources, plan_components, quality_report
from crosscheck_answers import crosscheck


def options_from_text(text, profile, prefix):
    matches = list(re.finditer(profile["optionPattern"], text, re.M))
    stem = text[: matches[0].start()].strip() if matches else text.strip()
    options = []
    for n, m in enumerate(matches):
        end = matches[n + 1].start() if n + 1 < len(matches) else len(text)
        start = (
            m.start(2)
            if m.lastindex and m.lastindex >= 2 and m.group(2) is not None
            else m.end()
        )
        options.append(
            {
                "id": m.group(1),
                "body": [
                    {
                        "id": f"{prefix}-option-{n + 1}",
                        "type": "paragraph",
                        "text": text[start:end].strip(),
                    }
                ],
            }
        )
    return stem, options


def prepare_components(
    document, profile_id, namespace, exam, plan=None, answer_reference=None
):
    base = prepare(document, profile_id, namespace, exam, plan)
    profile = get_layout(profile_id)
    block_index = {b["id"]: b for p in document["pages"] for b in p["blocks"]}
    questions = []
    stimuli = []
    reviews = []
    for row in base["questions"]:
        raw = row["caseBody"]
        qid = row["externalId"]
        pattern = profile.get("subquestionPattern")
        parts = list(re.finditer(pattern, raw, re.M)) if pattern else []
        # A source's single unnumbered prompt is still one response, while
        # numbered subquestions retain their own source labels.
        shared = raw[: parts[0].start()].strip() if parts else ""
        source_refs = [
            {
                "documentId": document["documentId"],
                "page": block_index[r]["page"],
                "bbox": block_index[r].get("bbox"),
            }
            for r in row["sources"]["stem"]
        ]
        source_refs = compact_sources(source_refs)
        if shared:
            stimuli.append(
                {
                    "id": qid + "-material",
                    "revision": 1,
                    "body": [
                        {
                            "id": qid + "-passage",
                            "type": "paragraph",
                            "text": shared,
                            "sources": source_refs,
                        }
                    ],
                }
            )
        chunks = []
        if parts:
            for n, m in enumerate(parts):
                label = m.group(1) if m.lastindex and m.group(1) else str(n + 1)
                chunks.append(
                    (
                        label,
                        raw[
                            m.end() : parts[n + 1].start()
                            if n + 1 < len(parts)
                            else len(raw)
                        ],
                    )
                )
        else:
            chunks = [("1", raw)]
        for label, text in chunks:
            identity = qid if len(chunks) == 1 else qid + ":part-" + label
            stem, options = options_from_text(text, profile, identity)
            for option in options:
                for block in option["body"]:
                    block["sources"] = source_refs
            answers = row["data"]["correctAnswers"] if len(chunks) == 1 else []
            item = {
                "externalId": identity,
                "body": [
                    {
                        "id": identity + "-prompt",
                        "type": "paragraph",
                        "text": stem,
                        "sources": source_refs,
                    }
                ],
                "interaction": {
                    "id": "response",
                    "type": "choice",
                    "multiple": len(answers) > 1,
                    "options": options,
                },
                "scoring": {"method": "exact", "correctAnswers": answers},
                "tags": row["data"].get("tags", []),
            }
            if shared:
                item["stimulusRefs"] = [qid + "-material"]
            if len(chunks) == 1 and row["data"].get("explanation"):
                item["explanation"] = row["data"]["explanation"]
            questions.append(item)
            images = [
                b["id"]
                for p in document["pages"]
                if p["page"] in row["reviewPages"]
                for b in p["blocks"]
                if b["kind"] == "image"
            ]
            evidence_blocks = [block_index[r] for r in row["sources"]["stem"]]
            question_pages = {b["page"] for b in evidence_blocks}
            evidence_blocks.extend(
                block_index[r]
                for r in images
                if r not in row["sources"]["stem"]
                and block_index[r]["page"] in question_pages
            )
            composition = plan_components(document, item, stimuli, evidence_blocks)
            reviews.append(
                {
                    "externalId": identity,
                    "status": "review",
                    "sourceCaseId": row["sourceQuestionId"],
                    "sourceQuestionId": row["sourceQuestionId"]
                    if len(chunks) == 1
                    else row["sourceQuestionId"] + " / part " + label,
                    "questionEvidence": row["sources"]["stem"],
                    "answerEvidence": sorted(
                        {
                            r
                            for entry in base["answerEntries"]
                            if entry["questionId"] == qid
                            for r in entry["blockRefs"]
                        }
                    )
                    if len(chunks) == 1
                    else [],
                    "answerEntries": [
                        e["id"] for e in base["answerEntries"] if e["questionId"] == qid
                    ]
                    if len(chunks) == 1
                    else [],
                    "visualEvidence": images,
                    "visualResolutions": [],
                    "compositionCandidates": composition,
                    "reason": "Review question boundaries, all components, options and source answer."
                    if len(chunks) == 1
                    else "Independently identify this subquestion answer; parent answer was withheld.",
                }
            )
    package = {
        "schemaVersion": "2.0",
        "exam": exam,
        "questions": questions,
        "stimuli": stimuli,
        "assets": [],
    }
    reference_report = (
        crosscheck(document, package, reviews, base["answerEntries"], answer_reference)
        if answer_reference
        else None
    )
    return {
        "version": "2.0",
        "documentId": document["documentId"],
        "package": package,
        "reviews": reviews,
        "pageReviews": [],
        "answerEntries": base["answerEntries"],
        "sourceExpectations": base["sourceExpectations"],
        "coverage": {
            "sourceQuestions": len(base["questions"]),
            "componentItems": len(questions),
            "answerEntries": len(base["answerEntries"]),
        },
        "report": {
            "requiresReview": True,
            "preparation": base["preparationReport"],
            "quality": quality_report(package, reviews, base["answerEntries"]),
            "answerCrosscheck": reference_report,
            "componentIssuesAreSample": True,
            "componentIssues": validate_components(package)
            if questions
            else ["No candidates found"],
        },
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("document", type=Path)
    p.add_argument("--layout", required=True)
    p.add_argument("--profiles", type=Path)
    p.add_argument("--sections", type=Path)
    p.add_argument(
        "--answer-reference",
        type=Path,
        help="independently reviewed answer-table evidence; cross-check existing keys without filling missing answers",
    )
    p.add_argument("--namespace", required=True)
    p.add_argument("--exam-id", required=True)
    p.add_argument("--exam-name", required=True)
    p.add_argument("--language", default="en")
    p.add_argument("-o", "--output", type=Path, required=True)
    a = p.parse_args()
    if a.output.resolve() in {
        v.resolve()
        for v in [a.document, a.profiles, a.sections, a.answer_reference]
        if v
    }:
        p.error("output must not replace source")
    if a.profiles:
        load_profiles(a.profiles)
    result = prepare_components(
        json.loads(a.document.read_text()),
        a.layout,
        a.namespace,
        {"id": a.exam_id, "name": a.exam_name, "language": a.language},
        json.loads(a.sections.read_text()) if a.sections else None,
        json.loads(a.answer_reference.read_text()) if a.answer_reference else None,
    )
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                **result["coverage"],
                "status": "review",
                "sampledStructuralIssues": len(result["report"]["componentIssues"]),
                "readableAnswerEntries": result["report"]["quality"][
                    "readableAnswerEntries"
                ],
                "questionsWithAnswers": result["report"]["quality"][
                    "questionsWithAnswers"
                ],
                "conflictingSourceQuestions": len(
                    result["report"]["quality"]["conflictingSourceQuestions"]
                ),
            }
        )
    )
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
