"""Conservative component planning from retained structure and exact text spans."""

from pathlib import Path
from component_handlers import assemble_component


def compact_sources(sources):
    """Stay within the transport limit without silently dropping later pages."""
    unique = list(
        {
            (s["page"], tuple(s["bbox"]) if s.get("bbox") else None): s for s in sources
        }.values()
    )
    if len(unique) <= 30:
        return unique
    pages = {}
    for source in unique:
        # Full block references remain in the review inventory.
        pages[source["page"]] = {
            "documentId": source["documentId"],
            "page": source["page"],
        }
    return list(pages.values())  # >30 pages remains an explicit validation error.


def plan_components(document, item, stimuli, evidence):
    """Assemble only uniquely located structured tables; propose ambiguous visuals.

    Paragraph text never becomes a table by whitespace guessing. Images need a
    reviewed placement/crop and useful alt text, so remain explicit candidates.
    """
    containers = [
        item["body"],
        *[s["body"] for s in stimuli if s["id"] in item.get("stimulusRefs", [])],
        *[o["body"] for o in item["interaction"].get("options", [])],
    ]
    candidates = []
    for block in evidence:
        if block["kind"] not in ("table", "image"):
            continue
        kind = "table" if block["kind"] == "table" else "figure"
        candidate = {
            "type": kind,
            "sourceBlocks": [block["id"]],
            "page": block["page"],
            "bbox": block.get("bbox"),
            "status": "review",
            "reason": "Choose placement, crop and alt text against the original page.",
        }
        candidates.append(candidate)
        if kind != "table":
            continue
        text = block.get("text", "").strip()
        matches = [
            (container, i, b)
            for container in containers
            for i, b in enumerate(container)
            if b["type"] == "paragraph" and text and b["text"].count(text) == 1
        ]
        candidate["reason"] = (
            "Table requires a unique text span and explicit source header cells."
        )
        cells = block.get("table", {}).get("table_cells", [])
        first_row = [c for c in cells if c.get("start_row_offset_idx") == 0]
        if (
            len(matches) != 1
            or not first_row
            or not all(c.get("column_header") for c in first_row)
        ):
            continue
        container, index, paragraph = matches[0]
        spec = {
            "id": paragraph["id"] + "-" + block["id"],
            "type": "table",
            "sourceBlocks": [block["id"]],
            "headerRows": 1,
        }
        try:
            table, _ = assemble_component(spec, document, Path("."))
        except (ValueError, KeyError, IndexError) as error:
            candidate["reason"] = str(error)
            continue
        before, after = paragraph["text"].split(text, 1)
        replacement = []
        if before.strip():
            replacement.append({**paragraph, "text": before.strip()})
        replacement.append(table)
        if after.strip():
            replacement.append(
                {**paragraph, "id": table["id"] + "-after", "text": after.strip()}
            )
        container[index : index + 1] = replacement
        candidate.update(
            status="assembled",
            componentId=table["id"],
            reason="Exact source span and structured header cells; visual review still required.",
        )
    return candidates


def quality_report(package, reviews, entries):
    questions = package["questions"]
    conflicts = {}
    for entry in entries:
        if entry.get("correctAnswers"):
            conflicts.setdefault(entry["sourceQuestionId"], set()).add(
                tuple(sorted(entry["correctAnswers"]))
            )
    return {
        "answerCandidates": len(entries),
        "uncertainAnswerBoundaries": sorted(
            {e["sourceQuestionId"] for e in entries if e.get("boundaryIssues")}
        ),
        "readableAnswerEntries": sum(bool(e.get("correctAnswers")) for e in entries),
        "unreadableAnswerEntries": sum(not e.get("correctAnswers") for e in entries),
        "conflictingSourceQuestions": sorted(
            k for k, v in conflicts.items() if len(v) > 1
        ),
        "questionsWithAnswers": sum(
            bool(q["scoring"]["correctAnswers"]) for q in questions
        ),
        "questionsWithoutAnswers": [
            q["externalId"] for q in questions if not q["scoring"]["correctAnswers"]
        ],
        "questionsWithInsufficientOptions": [
            q["externalId"]
            for q in questions
            if q["interaction"]["type"] == "choice"
            and len(q["interaction"]["options"]) < 2
        ],
        "questionsWithUnknownAnswerLabels": [
            q["externalId"]
            for q in questions
            if q["interaction"]["type"] == "choice"
            and not set(q["scoring"]["correctAnswers"])
            <= {o["id"] for o in q["interaction"]["options"]}
        ],
        "componentCandidates": sum(
            len(r.get("compositionCandidates", [])) for r in reviews
        ),
        "assembledTables": sum(
            c["status"] == "assembled"
            for r in reviews
            for c in r.get("compositionCandidates", [])
        ),
        "reviewedQuestions": sum(r["status"] == "ready" for r in reviews),
        "automaticAccuracyMeasured": False,
    }
