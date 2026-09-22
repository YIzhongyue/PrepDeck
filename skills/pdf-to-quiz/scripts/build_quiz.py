#!/usr/bin/env python3
"""Check evidence/coverage, merge question batches and export PrepDeck 1.0 JSON."""
from __future__ import annotations

import argparse
import copy
import json
import math
import sys
from pathlib import Path
from typing import Any

from validate_quiz import check_transport, nonempty, validate


class Invalid(ValueError):
    pass


def require(condition: bool, path: str, message: str) -> None:
    if not condition:
        raise Invalid(f"{path}: {message}")


def obj(value: Any, path: str) -> dict:
    require(isinstance(value, dict), path, "must be an object")
    return value


def array(value: Any, path: str) -> list:
    require(isinstance(value, list), path, "must be an array")
    return value


def string(value: Any, path: str) -> str:
    require(nonempty(value), path, "must be a non-empty string")
    return value


def integer(value: Any, path: str, minimum: int = 0) -> int:
    require(type(value) is int and value >= minimum, path, f"must be an integer >= {minimum}")
    return value


def read_json(path: Path) -> Any:
    def invalid_constant(value: str) -> None:
        raise Invalid(f"non-JSON number: {value}")
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=invalid_constant)


def merge_batches(inventory: dict, batches: list[Any]) -> dict:
    merged = copy.deepcopy(inventory)
    headers = array(merged.get("questions"), "inventory.questions")
    by_id = {}
    for i, header in enumerate(headers):
        row = obj(header, f"inventory.questions[{i}]")
        identity = string(row.get("externalId"), f"inventory.questions[{i}].externalId")
        require(identity not in by_id, identity, "duplicate externalId")
        by_id[identity] = row
    updated = set()
    for i, value in enumerate(batches):
        batch = obj(value, f"batch[{i}]")
        require(batch.get("documentId") == merged.get("documentId"), f"batch[{i}].documentId", "document mismatch")
        for row in array(batch.get("questions"), f"batch[{i}].questions"):
            row = obj(row, f"batch[{i}].question")
            identity = string(row.get("externalId"), f"batch[{i}].externalId")
            require(identity in by_id, identity, "not in the master inventory")
            require(identity not in updated, identity, "appears in more than one batch")
            header = by_id[identity]
            require(header.get("status") == "pending", identity, "batch may only fill pending entries")
            for field in ("order", "sourceQuestionId"):
                require(row.get(field) == header.get(field), f"{identity}.{field}", "must match the master inventory")
            header.clear()
            header.update(row)
            updated.add(identity)
    return merged


def reconcile(document: Any, inventory: Any, root: Path, allow_pending: bool = False) -> tuple[dict, dict]:
    doc = obj(document, "document")
    inv = obj(inventory, "inventory")
    require(doc.get("version") == "1.0" and inv.get("version") == "1.0", "version", 'must be "1.0"')
    identity = string(doc.get("documentId"), "document.documentId")
    require(inv.get("documentId") == identity, "inventory.documentId", "document mismatch")
    pages = array(doc.get("pages"), "document.pages")
    count = integer(doc.get("pageCount"), "document.pageCount", 1)
    require(len(pages) == count, "document.pages", "page count mismatch; repair extraction before export")
    blocks = {}
    for number, value in enumerate(pages, 1):
        page = obj(value, f"document.pages[{number - 1}]")
        require(page.get("page") == number, "document.pages", "must cover every page in order")
        for block in array(page.get("blocks"), f"page[{number}].blocks"):
            block = obj(block, f"page[{number}].block")
            bid = string(block.get("id"), "block.id")
            require(bid not in blocks, bid, "duplicate block id")
            require(block.get("documentId") == identity and block.get("page") == number, bid, "invalid block provenance")
            require(block.get("kind") in ("text", "image"), bid, "kind must be text or image")
            require(isinstance(block.get("text"), str), bid, "text must be a string")
            string(block.get("method"), f"{bid}.method")
            bbox = block.get("bbox")
            if bbox is not None:
                require(isinstance(bbox, list) and len(bbox) == 4 and all(type(x) in (int, float) and math.isfinite(x) for x in bbox), bid, "invalid bbox")
                require(bbox[0] <= bbox[2] and bbox[1] <= bbox[3], bid, "inverted bbox")
            if block["kind"] == "image":
                asset = string(block.get("asset"), f"{bid}.asset")
                target = (root / asset).resolve()
                require(not Path(asset).is_absolute() and target.is_relative_to(root.resolve()) and target.is_file(), bid, "missing or unsafe image asset")
            blocks[bid] = block
    if doc.get("issues"):
        string(inv.get("documentReview"), "inventory.documentReview")
    reviews = {}
    for review in array(inv.get("pageReviews"), "inventory.pageReviews"):
        review = obj(review, "pageReview")
        number = integer(review.get("page"), "pageReview.page", 1)
        require(number <= count and number not in reviews, "pageReview.page", "unknown or duplicate page")
        require(review.get("status") in ("reviewed", "excluded"), "pageReview.status", "must be reviewed or excluded")
        string(review.get("reason"), "pageReview.reason")
        reviews[number] = review
    require(len(reviews) == count, "inventory.pageReviews", "every source page needs a review or exclusion")

    used = set()

    def refs(value: Any, path: str, required: bool = True) -> set[str]:
        values = array(value, path)
        require(not required or bool(values), path, "must contain source block references")
        result = set()
        for bid in values:
            bid = string(bid, path)
            require(bid in blocks, path, f"unknown block {bid}")
            require(bid not in result, path, f"duplicate reference {bid}")
            require(blocks[bid]["kind"] == "image" or bool(blocks[bid]["text"].strip()), path, "cannot cite an empty text block")
            result.add(bid)
        used.update(result)
        return result

    questions = array(inv.get("questions"), "inventory.questions")
    coverage = obj(inv.get("coverage"), "inventory.coverage")
    require(integer(coverage.get("questionCount"), "coverage.questionCount") == len(questions), "coverage.questionCount", "does not match the source question inventory")
    ready, review_items, excluded, pending = [], [], [], []
    ids, orders, answer_sources, source_ids, ready_answers = set(), set(), {}, {}, {}
    for i, value in enumerate(questions):
        path = f"inventory.questions[{i}]"
        q = obj(value, path)
        qid = string(q.get("externalId"), f"{path}.externalId")
        require(qid not in ids, path, "duplicate externalId")
        ids.add(qid)
        order = integer(q.get("order"), f"{path}.order", 1)
        require(order not in orders, path, "duplicate source order")
        orders.add(order)
        source_id = string(q.get("sourceQuestionId"), f"{path}.sourceQuestionId")
        require(source_id not in source_ids.values(), path, "duplicate section-qualified sourceQuestionId")
        source_ids[qid] = source_id
        status = q.get("status")
        require(status in ("ready", "review", "excluded", "pending"), path, "invalid status")
        if status == "pending":
            require(allow_pending, path, "pending question must be resolved before export")
            pending.append(q)
            continue
        sources = obj(q.get("sources"), f"{path}.sources")
        require(set(sources) <= {"stem", "options", "correctAnswers", "explanation", "figures", "passage"}, path, "unknown source field")
        qrefs = refs(sources.get("stem"), f"{path}.sources.stem")
        for field in ("explanation", "figures", "passage"):
            if field in sources:
                qrefs |= refs(sources[field], f"{path}.sources.{field}")
        for field in ("options", "correctAnswers"):
            mapping = obj(sources.get(field, {}), f"{path}.sources.{field}")
            for label, values in mapping.items():
                qrefs |= refs(values, f"{path}.sources.{field}.{label}")
        if status != "ready":
            string(q.get("reason"), f"{path}.reason")
            (review_items if status == "review" else excluded).append(q)
            continue
        require(all(reviews[blocks[bid]["page"]]["status"] == "reviewed" for bid in qrefs), path, "ready question references an excluded page")
        data = copy.deepcopy(obj(q.get("data"), f"{path}.data"))
        require("externalId" not in data or data["externalId"] == qid, path, "data.externalId disagrees with inventory")
        data["externalId"] = qid
        errors, _ = validate({"schemaVersion": "1.0", "exam": inv.get("exam"), "questions": [data]})
        require(not errors, path, "; ".join(errors))
        option_ids = {option["id"] for option in data.get("options", [])}
        require(set(sources.get("options", {})) == option_ids, path, "every option must have matching evidence, with no extra option labels")
        require(set(sources.get("correctAnswers", {})) == set(data["correctAnswers"]), path, "every accepted answer must have matching evidence")
        if "expectedAnswerCount" in q:
            require(integer(q["expectedAnswerCount"], f"{path}.expectedAnswerCount", 1) == len(data["correctAnswers"]), path, "answer count disagrees with the source instruction")
        if data.get("explanation"):
            require(bool(sources.get("explanation")), path, "official explanation needs evidence")
        if sources.get("figures"):
            descriptions = obj(q.get("visualDescriptions"), f"{path}.visualDescriptions")
            emitted_text = "\n".join([data["stem"]] + [o["text"] for o in data.get("options", [])])
            for bid in sources["figures"]:
                require(blocks[bid]["kind"] == "image", path, "figure must reference an image block")
                description = string(descriptions.get(bid), f"{path}.visualDescriptions.{bid}")
                require(description in emitted_text, path, "necessary visual description must be included in the exported stem/options; otherwise mark review")
        answer_sources[qid] = set(bid for values in sources["correctAnswers"].values() for bid in values)
        ready_answers[qid] = set(data["correctAnswers"])
        ready.append((order, data))

    require(orders == set(range(1, len(questions) + 1)), "inventory.questions.order", "must be contiguous source order starting at 1")
    # Layout drafts retain independently known source counts. Adding a few
    # reviewed OCR survivors must not silently erase missing questions.
    for expectation in array(inv.get("sourceExpectations", []), "inventory.sourceExpectations"):
        expectation = obj(expectation, "sourceExpectation")
        section = string(expectation.get("section"), "sourceExpectation.section")
        expected = integer(expectation.get("questionCount"), "sourceExpectation.questionCount")
        unit = expectation.get("unit", "questions")
        require(unit in ("questions", "cases"), section, "unknown source expectation unit")
        require(unit != "cases" or "cases" in inv, section, "case expectation requires a case inventory")
        counted_sources = [case["sourceQuestionId"] for case in inv["cases"]] if unit == "cases" else source_ids.values()
        actual = sum(source.startswith(section + " / ") for source in counted_sources)
        require(actual == expected, section, f"source inventory has {actual} questions; expected {expected}; repair missing OCR headers")
    entries = array(inv.get("answerEntries"), "inventory.answerEntries")
    require(integer(coverage.get("answerEntryCount"), "coverage.answerEntryCount") == len(entries), "coverage.answerEntryCount", "does not match answer entries")
    entry_ids, matched = set(), {}
    for entry in entries:
        entry = obj(entry, "answerEntry")
        eid = string(entry.get("id"), "answerEntry.id")
        require(eid not in entry_ids, eid, "duplicate answer entry id")
        entry_ids.add(eid)
        string(entry.get("sourceQuestionId"), f"{eid}.sourceQuestionId")
        evidence = refs(entry.get("blockRefs"), f"{eid}.blockRefs")
        answers = entry.get("correctAnswers")
        if answers is None:
            string(entry.get("reason"), f"{eid}.reason")
        else:
            answers = array(answers, f"{eid}.correctAnswers")
            require(bool(answers) and all(nonempty(a) for a in answers), eid, "answers must be non-empty strings")
            require(len(answers) == len(set(answers)), eid, "duplicate answers")
        target = entry.get("questionId")
        if target is None:
            string(entry.get("reason"), f"{eid}.reason")
        else:
            require(isinstance(target, str) and target in ids, eid, "answer points to an unknown question")
            require(entry["sourceQuestionId"] == source_ids[target], eid, "source question identifier disagrees with the matched question")
            if target in ready_answers:
                require(answers is not None and set(answers) == ready_answers[target], eid, "answer key conflicts with a ready question; mark it review")
            matched.setdefault(target, set()).update(evidence)
    for qid, evidence in answer_sources.items():
        require(evidence <= matched.get(qid, set()), qid, "answer evidence is not reconciled with the answer inventory")
    ignored = set()
    for item in array(inv.get("ignoredBlocks"), "inventory.ignoredBlocks"):
        item = obj(item, "ignoredBlock")
        bid = string(item.get("blockId"), "ignoredBlock.blockId")
        require(bid in blocks and bid not in ignored and bid not in used, bid, "unknown, duplicate or also-used ignored block")
        string(item.get("reason"), f"{bid}.reason")
        ignored.add(bid)
    missing = {bid for bid, block in blocks.items() if block["kind"] == "image" or block["text"].strip()} - used - ignored
    require(allow_pending or not missing, "inventory", "unassigned source blocks: " + ", ".join(sorted(missing)))
    output = {"schemaVersion": "1.0", "exam": inv.get("exam"),
              "source": {"originalFileName": doc.get("originalFileName"), "extractedBy": "pdf-to-quiz evidence pipeline",
                         "extractedAt": doc.get("extractedAt")},
              "questions": [row for _, row in sorted(ready)]}
    # Validate metadata even when every question is withheld.
    metadata_probe = copy.deepcopy(output)
    if not ready:
        metadata_probe["questions"] = [{"type": "fill_blank", "stem": "metadata validation", "correctAnswers": ["validation"]}]
    errors, warnings = validate(metadata_probe)
    require(not errors, "output", "; ".join(errors))
    report = {"documentId": identity, "counts": {"source": len(questions), "exported": len(ready),
              "review": len(review_items), "excluded": len(excluded), "pending": len(pending), "answerEntries": len(entries)},
              "review": review_items, "excluded": excluded, "pageReviews": list(reviews.values()),
              "unmatchedAnswerEntries": [e for e in entries if e.get("questionId") is None],
              "warnings": warnings, "unassignedBlocks": sorted(missing)}
    return output, report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", type=Path)
    parser.add_argument("inventory", type=Path)
    parser.add_argument("--batch", type=Path, nargs="*", default=[])
    parser.add_argument("--output", type=Path, help="omit to validate only; writes review and merged inventory sidecars")
    parser.add_argument("--allow-pending", action="store_true", help="check completed batches; cannot export")
    args = parser.parse_args()
    if args.allow_pending and args.output:
        parser.error("--allow-pending cannot be used with --output")
    try:
        inventory = merge_batches(obj(read_json(args.inventory), "inventory"), [read_json(p) for p in args.batch])
        output, report = reconcile(read_json(args.document), inventory, args.document.parent, args.allow_pending)
        serialized = json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        check_transport(serialized)
        if args.output:
            outputs = [args.output, args.output.with_suffix(".review.json"), args.output.with_suffix(".inventory.json")]
            inputs = {p.resolve() for p in [args.document, args.inventory, *args.batch]}
            require(len({p.resolve() for p in outputs}) == 3 and not any(p.resolve() in inputs for p in outputs), "output", "paths collide with each other or input files")
            # Avoid leaving a stale successful import after an all-unresolved rerun.
            args.output.parent.mkdir(parents=True, exist_ok=True)
            for path, data in zip(outputs[1:], [report, inventory]):
                path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
            if output["questions"]:
                args.output.write_text(serialized, encoding="utf-8")
            else:
                args.output.unlink(missing_ok=True)
        print(json.dumps(report["counts"]))
        for warning in report["warnings"]:
            print(f"WARNING: {warning}", file=sys.stderr)
        return 0
    except (OSError, ValueError, TypeError, OverflowError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
