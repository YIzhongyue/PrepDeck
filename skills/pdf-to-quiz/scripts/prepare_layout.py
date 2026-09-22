#!/usr/bin/env python3
"""Prepare a review inventory from a supported PDF document extraction; never auto-approve OCR."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from pdf_layouts import LAYOUTS, get_layout
from validate_quiz import validate


LABELS = "アイウエオカキクケコサシスセソ"
# Full headings, not mentions in prose or table-of-contents entries.
SECTION = re.compile(
    r"^(?:(令和(?:元|[0-9０-９]+)年度|平成[0-9０-９]+年度)[ \t　]*(春期|秋期)?\n)?"
    r"情報セキュリティマネジメント試験\n"
    r"(科目[ABＡＢ]|午前)[ \t　の]*(公開問題|サンプル問題|問題)"
    r"(?:\n※公開日[:：]([0-9]+)年([0-9]+)月([0-9]+)日)?[ \t　]*$", re.M)


def page_text(page: dict) -> tuple[str, list[str]]:
    """Use only the selected extraction, keeping raw blocks untouched as evidence."""
    selected = page.get("selectedText", "")
    texts = [b for b in page["blocks"] if b["kind"] == "text"]
    ocr = [b for b in texts if b["method"] == "tesseract" and b["text"] == selected]
    refs = [b["id"] for b in (ocr or [b for b in texts if b["method"] != "tesseract"])]
    # Only discard a native page-number block identified by both text and geometry.
    if not ocr and page.get("height"):
        footer = {b["id"] for b in texts if b.get("bbox") and b["bbox"][1] > page["height"] * .9
                  and b["text"].strip() == str(page["page"])}
        if footer:
            selected = "\n".join(b["text"] for b in texts if b["id"] not in footer and b["method"] != "tesseract")
            refs = [bid for bid in refs if bid not in footer]
    return selected, refs


def stream(document: dict, start: int, end: int) -> tuple[str, list[tuple[int, int, list[str], int]]]:
    if type(start) is not int or type(end) is not int or not 1 <= start <= end <= len(document["pages"]):
        raise ValueError("section page range is outside the document")
    parts, ranges, offset = [], [], 0
    for page in document["pages"][start - 1:end]:
        text, refs = page_text(page)
        parts.append(text + "\n")
        ranges.append((offset, offset + len(text), refs, page["page"]))
        offset += len(text) + 1
    return "".join(parts), ranges


def evidence(ranges: list, start: int, end: int) -> tuple[list[str], list[int]]:
    refs, pages = [], []
    for left, right, block_refs, number in ranges:
        if left < end and right > start:
            refs.extend(block_refs)
            pages.append(number)
    return list(dict.fromkeys(refs)), pages


def auto_sections(text: str) -> list[dict]:
    matches = list(SECTION.finditer(text))
    sections, ids = [], set()
    for i, match in enumerate(matches):
        era, season, subject, kind, year, month, day = match.groups()
        subject = subject.translate(str.maketrans("ＡＢ", "AB"))
        subject_id = "a" if subject in ("科目A", "午前") else "b"
        if era:
            digits = era.removeprefix("令和").removeprefix("平成").removesuffix("年度")
            number = 1 if digits == "元" else int(digits)
            stamp = str(number + (2018 if era.startswith("令和") else 1988))
            if season:
                stamp += "-" + ("spring" if season == "春期" else "autumn")
        elif year:
            stamp = f"sample-{year}-{int(month):02}-{int(day):02}"
        else:
            raise ValueError("Section without a year or sample publication date; supply an explicit section plan")
        identity = f"{stamp}-{subject_id}"
        if identity in ids:
            raise ValueError(f"Repeated section {identity}; supply an explicit section plan")
        ids.add(identity)
        stop = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        if i == len(matches) - 1:
            backmatter = re.search(r"^著者について\s*$", text[match.end():stop], re.M)
            if backmatter:
                stop = match.end() + backmatter.start()
        sections.append({"id": identity, "role": "interleaved", "start": match.end(), "end": stop})
    if not sections:
        raise ValueError("No scoped section headings found; supply --sections after inspecting the PDF")
    return sections


def prepare(document: dict, layout_id: str, namespace: str, exam: dict, plan: dict | None = None,
            _subject_b: bool = False) -> dict:
    if layout_id == "ja-sg-subject-b":
        from subject_b import case_inventory, compile_cases
        base_layout = (plan or {}).get("sourceLayout", document.get("layoutId"))
        if base_layout not in ("ja-sg-interleaved", "ja-sg-textbook-ocr"):
            base_layout = "ja-sg-interleaved" if SECTION.search("\n".join(p.get("selectedText", "") for p in document.get("pages", []))) else "ja-sg-textbook-ocr"
        inventory = case_inventory(prepare(document, base_layout, namespace, exam, plan, _subject_b=True))
        blocks = {block["id"]: block for page in document["pages"] for block in page["blocks"]}
        compiled = compile_cases(inventory, blocks)
        for original, expanded in zip(inventory["questions"], compiled["questions"]):
            errors, _ = validate({"schemaVersion": "1.0", "exam": exam, "questions": [expanded["data"]]})
            if errors:
                original["validationIssues"] = errors
        return inventory
    layout = get_layout(layout_id)
    if not re.fullmatch(r"[a-z0-9]+(?:[-_.][a-z0-9]+)*", namespace):
        raise ValueError("namespace must be a stable lowercase material/edition slug")
    if document.get("version") != "1.0" or len(document.get("pages", [])) != document.get("pageCount"):
        raise ValueError("requires a complete extraction page inventory (including failed pages)")
    text, ranges = stream(document, 1, document["pageCount"])
    if plan is None:
        if layout["sectionStrategy"] != "year-subject-or-dated-sample":
            raise ValueError("This layout requires --sections: define question/answer scopes from bookmarks and original pages")
        sections = auto_sections(text)
    else:
        sections = plan.get("sections")
        if not isinstance(sections, list) or not sections:
            raise ValueError("section plan must contain a nonempty sections array")
    if _subject_b:
        sections = [s for s in sections if s.get("subject") == "B" or ("subject" not in s and s["id"].endswith("-b"))]
        if not sections:
            raise ValueError("No Subject B sections found; mark the relevant plan sections with subject: B")

    questions, entries, warnings, counts = [], [], [], []
    by_id: dict[str, dict] = {}
    for section in sections:
        sid, role = section.get("id"), section.get("role")
        if not isinstance(sid, str) or not re.fullmatch(r"[a-z0-9]+(?:[-_.][a-z0-9]+)*", sid):
            raise ValueError("section id must be a stable lowercase slug")
        if role not in ("interleaved", "questions", "answers", "reference"):
            raise ValueError(f"{sid}: invalid section role")
        if plan is not None:
            chunk, local_ranges = stream(document, section.get("startPage"), section.get("endPage"))
            left, right = 0, len(chunk)
        else:
            chunk, local_ranges = text, ranges
            left, right = section["start"], section["end"]
        if role == "reference":
            warnings.append(f"{sid}: reference pages still need visual review for answer tables, examples and shared passages")
            continue
        qpattern = re.compile(section.get("questionPattern", layout["questionPattern"]), re.M)
        apattern = re.compile(section.get("answerPattern", layout["answerPattern"]), re.M)
        if qpattern.groups < 1 or apattern.groups < 2:
            raise ValueError("question patterns need a number group; answer patterns need number and label groups")
        answers = list(apattern.finditer(chunk, left, right)) if role != "questions" else []
        unreadable = []
        if role == "answers":
            # A legible question number with an unreadable answer still closes
            # the preceding explanation and remains in the answer inventory.
            raw_headers = re.compile(r"^問\s*([0-9０-９]+)(?=[ \t　|｜:：・.]|$)", re.M)
            valid_starts = {a.start() for a in answers}
            unreadable = [a for a in raw_headers.finditer(chunk, left, right) if a.start() not in valid_starts]
        headers = list(qpattern.finditer(chunk, left, right)) if role != "answers" else []
        # A bare 問1 : ア must never be inventoried as a question in a mixed section.
        headers = [h for h in headers if not any(a.start() <= h.start() < a.end() for a in answers)]
        boundaries = sorted({right, *(h.start() for h in headers), *(a.start() for a in answers), *(a.start() for a in unreadable)})
        section_count = 0
        for match in headers:
            printed = str(int(match.group(1)))
            qid = f"{namespace}:{sid}:q{printed}"
            if qid in by_id:
                raise ValueError(f"Duplicate scoped question {qid}; split repeated examples/subquestions into distinct scopes")
            stop = next(b for b in boundaries if b > match.start())
            # Include a stem on the same line as the scanned question number.
            start = match.start(2) if match.lastindex and match.lastindex >= 2 and match.group(2) else match.end()
            body = chunk[start:stop].strip()
            option_re = re.compile(layout["optionPattern"], re.M)
            options = list(option_re.finditer(body))
            candidate = {"type": "single_choice", "stem": body[:options[0].start()].strip() if options else body,
                         "options": [], "correctAnswers": [], "tags": [namespace, sid]}
            for j, option in enumerate(options):
                finish = options[j + 1].start() if j + 1 < len(options) else len(body)
                candidate["options"].append({"id": option.group(1), "text": body[option.start(2):finish].strip()})
            refs, pages = evidence(local_ranges, match.start(), stop)
            row = {"externalId": qid, "sourceQuestionId": f"{sid} / {printed}", "order": len(questions) + 1,
                   "status": "review", "reason": "Check the complete question, option labels, figures and answer against original pages.",
                   "data": candidate, "sources": {"stem": refs,
                     "options": {o["id"]: refs for o in candidate["options"]}, "correctAnswers": {}},
                   "reviewPages": pages}
            questions.append(row)
            if _subject_b:
                row["caseBody"] = body
            by_id[qid] = row
            section_count += 1
        for match in answers:
            printed = str(int(match.group(1)))
            labels = list(match.group(2))
            if not labels or any(label not in LABELS for label in labels) or len(set(labels)) != len(labels):
                raise ValueError(f"{sid}: invalid answer labels")
            stop = next(b for b in boundaries if b > match.start())
            refs, pages = evidence(local_ranges, match.start(), stop)
            entries.append({"id": f"answer-{len(entries) + 1}", "sourceQuestionId": f"{sid} / {printed}",
                            "blockRefs": refs, "correctAnswers": labels, "questionId": None,
                            "candidateQuestionId": f"{namespace}:{sid}:q{printed}",
                            "explanation": chunk[match.end():stop].strip(), "reviewPages": pages})
        for match in unreadable:
            printed = str(int(match.group(1)))
            stop = next(b for b in boundaries if b > match.start())
            refs, pages = evidence(local_ranges, match.start(), stop)
            entries.append({"id": f"answer-{len(entries) + 1}", "sourceQuestionId": f"{sid} / {printed}",
                            "blockRefs": refs, "correctAnswers": None, "questionId": None,
                            "candidateQuestionId": f"{namespace}:{sid}:q{printed}",
                            "reason": "Answer label could not be read; check the original page.",
                            "explanation": chunk[match.start():stop].strip(), "reviewPages": pages})
        expected = section.get("expectedQuestions")
        if expected is not None and (type(expected) is not int or expected < 0):
            raise ValueError("expectedQuestions must be a nonnegative integer")
        counts.append({"section": sid, "role": role, "detectedQuestions": section_count, "detectedAnswers": len(answers) + len(unreadable), "expectedQuestions": expected})
        if expected is not None and expected != section_count:
            warnings.append(f"{sid}: detected {section_count} of {expected} expected questions; repair missing OCR headers before export")
        if not headers and not answers:
            warnings.append(f"{sid}: no question/answer headers detected; this is NOT evidence of an empty section")
    for entry in entries:
        row = by_id.get(entry.pop("candidateQuestionId"))
        if row is None:
            entry["reason"] = "No matching scoped question; inspect OCR and section boundaries."
            continue
        entry["questionId"] = row["externalId"]
        if entry["correctAnswers"] is None:
            row["reason"] = entry["reason"]
            row["reviewPages"] = sorted(set(row["reviewPages"] + entry["reviewPages"]))
            continue
        previous = row["data"]["correctAnswers"]
        if previous and previous != entry["correctAnswers"]:
            row["reason"] = "Conflicting source answers; reconcile all answer entries before export."
            warnings.append(f"{row['externalId']}: conflicting answers")
        elif not previous:
            row["data"]["correctAnswers"] = entry["correctAnswers"]
            row["data"]["type"] = "multiple_choice" if len(entry["correctAnswers"]) > 1 else "single_choice"
            row["sources"]["correctAnswers"] = {label: entry["blockRefs"] for label in entry["correctAnswers"]}
            if entry["explanation"]:
                row["data"]["explanation"] = entry["explanation"]
                row["sources"]["explanation"] = entry["blockRefs"]
        row["reviewPages"] = sorted(set(row["reviewPages"] + entry["reviewPages"]))
    for row in questions:
        errors, _ = validate({"schemaVersion": "1.0", "exam": exam, "questions": [row["data"]]})
        if errors:
            row["validationIssues"] = errors
    return {"version": "1.0", "documentId": document["documentId"], "layoutId": layout_id, "exam": exam,
            "coverage": {"questionCount": len(questions), "answerEntryCount": len(entries)},
            "sourceExpectations": [{"section": c["section"], "questionCount": c["expectedQuestions"]}
                                   for c in counts if c["expectedQuestions"] is not None],
            "pageReviews": [], "questions": questions, "answerEntries": entries, "ignoredBlocks": [],
            "preparationReport": {"warnings": warnings, "sections": counts,
              "requiresReview": True, "reviewedPages": 0, "sourcePages": document["pageCount"]}}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", type=Path)
    parser.add_argument("--layout", required=True, choices=tuple(LAYOUTS))
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--exam-id", required=True)
    parser.add_argument("--exam-name", required=True)
    parser.add_argument("--sections", type=Path, help="reviewed page-range plan; required for scanned textbooks")
    parser.add_argument("--output", "-o", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() in {p.resolve() for p in (args.document, args.sections) if p}:
        parser.error("output must not replace a source file")
    try:
        document = json.loads(args.document.read_text(encoding="utf-8"))
        plan = json.loads(args.sections.read_text(encoding="utf-8")) if args.sections else None
        inventory = prepare(document, args.layout, args.namespace,
                            {"id": args.exam_id, "name": args.exam_name, "language": "ja"}, plan)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({**inventory["coverage"], "status": "review", "warnings": inventory["preparationReport"]["warnings"]}, ensure_ascii=False))
        return 3
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"ERROR: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
