#!/usr/bin/env python3
"""Validate source review and export reviewed component items, reporting withheld items."""

import argparse
import copy
import json
from pathlib import Path
from components import resolve, validate_components
from validate_quiz import check_transport


def build(document, inventory):
    if inventory.get("documentId") != document.get("documentId"):
        raise ValueError("document identity mismatch")
    file = copy.deepcopy(inventory["package"])
    items = file["questions"]
    reviews = inventory["reviews"]
    if len({r["externalId"] for r in reviews}) != len(reviews) or {
        r["externalId"] for r in reviews
    } != {q["externalId"] for q in items}:
        raise ValueError("reviews must cover every item exactly once")
    blocks = {b["id"]: b for p in document["pages"] for b in p["blocks"]}
    page_ids = {p["page"] for p in document["pages"]}
    if len(blocks) != sum(len(p["blocks"]) for p in document["pages"]):
        raise ValueError("duplicate evidence block IDs")
    if len(page_ids) != len(document["pages"]) or not page_ids <= set(
        range(1, document["pageCount"] + 1)
    ):
        raise ValueError("invalid source page inventory")
    page_reviews = inventory.get("pageReviews", [])
    if any(r["page"] not in page_ids for r in page_reviews):
        raise ValueError("review refers to unknown source page")
    if len({r["page"] for r in page_reviews}) != len(page_reviews):
        raise ValueError("duplicate page reviews")
    reviewed_pages = {
        r["page"]
        for r in page_reviews
        if r.get("status") == "reviewed" and str(r.get("reason", "")).strip()
    }
    answers = {a["id"]: a for a in inventory.get("answerEntries", [])}
    if len(answers) != len(inventory.get("answerEntries", [])):
        raise ValueError("duplicate answer entry IDs")
    source_ids = {r.get("sourceCaseId", r["sourceQuestionId"]) for r in reviews}
    if inventory.get("coverage", {}).get("sourceQuestions") != len(source_ids):
        raise ValueError("source question coverage mismatch")
    for e in inventory.get("sourceExpectations", []):
        actual = sum(s.startswith(e["section"] + " / ") for s in source_ids)
        if actual != e["questionCount"]:
            raise ValueError(
                f"{e['section']}: expected {e['questionCount']} source questions, got {actual}"
            )
    ready = []
    withheld = []
    for item in items:
        review = next(r for r in reviews if r["externalId"] == item["externalId"])
        if review["status"] not in ("ready", "review", "excluded"):
            raise ValueError("unknown review status")
        if review["status"] != "ready":
            if not str(review.get("reason", "")).strip():
                raise ValueError("withheld items need a reason")
            withheld.append(
                {
                    "externalId": item["externalId"],
                    "status": review["status"],
                    "reason": review["reason"],
                }
            )
            continue
        refs = review.get("questionEvidence", []) + review.get("answerEvidence", [])
        if (
            not review.get("questionEvidence")
            or not review.get("answerEvidence")
            or any(r not in blocks for r in refs)
        ):
            raise ValueError("ready item needs valid question and answer evidence")
        if any(blocks[r]["page"] not in reviewed_pages for r in refs):
            raise ValueError("ready item uses an unreviewed source page")
        linked = [answers.get(i) for i in review.get("answerEntries", [])]
        if not linked or any(
            not a
            or a.get("sourceQuestionId") != review["sourceQuestionId"]
            or a.get("correctAnswers") != item["scoring"]["correctAnswers"]
            for a in linked
        ):
            raise ValueError("source answers must agree with this item")
        # Include every matching entry, so selecting only one side of a conflict cannot approve a question.
        if any(
            a.get("correctAnswers") != item["scoring"]["correctAnswers"]
            for a in answers.values()
            if a.get("sourceQuestionId") == review["sourceQuestionId"]
        ):
            raise ValueError("conflicting answer entries")
        if any(
            r not in review["answerEvidence"]
            for a in linked
            for r in a.get("blockRefs", [])
        ):
            raise ValueError("answer evidence omitted linked source blocks")
        for evidence in review.get("visualEvidence", []):
            resolutions = [
                v
                for v in review.get("visualResolutions", [])
                if v.get("blockId") == evidence
            ]
            if (
                len(resolutions) != 1
                or not resolutions[0].get("reason")
                or resolutions[0].get("status") not in ("included", "not-required")
            ):
                raise ValueError("resolve every source visual explicitly")
            if evidence not in blocks or blocks[evidence]["page"] not in reviewed_pages:
                raise ValueError("visual page needs review")
            if resolutions[0]["status"] == "included":
                _, content, _, _ = resolve(file, item)
                if not any(
                    b["type"] == "figure"
                    and b["id"] == resolutions[0].get("componentId")
                    for b in content
                ):
                    raise ValueError("included visual needs a figure component")
        _, content, _, _ = resolve(file, item)
        for b in content:
            if not b.get("sources"):
                raise ValueError("every ready content block needs source evidence")
            for src in b["sources"]:
                if (
                    src["documentId"] != document["documentId"]
                    or src["page"] not in reviewed_pages
                ):
                    raise ValueError("component source page must be reviewed")
        ready.append(item)
    file["questions"] = ready
    used = {s for q in ready for s in q.get("stimulusRefs", [])}
    file["stimuli"] = [s for s in file.get("stimuli", []) if s["id"] in used]
    used_assets = {a["id"] for q in ready for a in resolve(file, q)[3]}
    file["assets"] = [a for a in file.get("assets", []) if a["id"] in used_assets]
    if ready:
        errors = validate_components(file)
        if errors:
            raise ValueError("; ".join(errors))
    return file, {
        "exported": len(ready),
        "withheld": withheld,
        "sourcePages": document["pageCount"],
        "reviewedPages": len(reviewed_pages),
        "completeBookReview": reviewed_pages
        == set(range(1, document["pageCount"] + 1)),
        "unmatchedAnswerEntries": [
            a["id"]
            for a in answers.values()
            if a.get("sourceQuestionId") not in {r["sourceQuestionId"] for r in reviews}
        ],
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("document", type=Path)
    p.add_argument("inventory", type=Path)
    p.add_argument("-o", "--output", type=Path, required=True)
    a = p.parse_args()
    if a.output.resolve() in (a.document.resolve(), a.inventory.resolve()):
        p.error("output must differ from sources")
    file, report = build(
        json.loads(a.document.read_text()), json.loads(a.inventory.read_text())
    )
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.with_suffix(".review.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    if file["questions"]:
        raw = json.dumps(file, ensure_ascii=False, indent=2) + "\n"
        check_transport(raw)
        a.output.write_text(raw)
    else:
        a.output.unlink(missing_ok=True)
    print(
        json.dumps(
            {"exported": report["exported"], "withheld": len(report["withheld"])}
        )
    )
    return 0 if not report["withheld"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
