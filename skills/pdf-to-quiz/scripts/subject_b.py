"""Subject B case compilation. Source evidence and final import limits are checked by the builder."""
from __future__ import annotations

import copy
import re

from validate_quiz import nonempty


def require(condition, message):
    if not condition:
        raise ValueError(f"Subject B: {message}")


def render_material(material: dict) -> str:
    require(isinstance(material, dict), "material must be an object")
    kind = material.get("kind")
    fields = {"text": {"text"}, "table": {"caption", "columns", "rows"}, "figure": {"description", "textSufficient"}}
    require(kind in fields, "unknown material kind")
    require(set(material) == {"id", "kind", "blockRefs"} | fields[kind], "invalid material fields")
    require(nonempty(material["id"]), "material ID is required")
    refs = material["blockRefs"]
    require(isinstance(refs, list) and refs and all(nonempty(r) for r in refs), "material evidence is required")
    require(len(refs) == len(set(refs)), "duplicate material evidence")
    if kind == "text":
        require(nonempty(material["text"]), "shared text must be nonempty")
        return material["text"]
    if kind == "figure":
        require(type(material["textSufficient"]) is bool, "textSufficient must be boolean")
        require(material["description"] is None or isinstance(material["description"], str), "invalid figure description")
        return material["description"] or ""
    require(isinstance(material["caption"], str), "table caption must be a string")
    columns, rows = material["columns"], material["rows"]
    require(isinstance(columns, list) and columns and all(nonempty(c) for c in columns), "table headers are required")
    require(isinstance(rows, list) and rows, "table rows are required")
    require(all(isinstance(row, list) and len(row) == len(columns) and all(isinstance(cell, str) for cell in row)
                for row in rows), "table row width must match headers; do not drop or guess cells")
    # QuestionContent supports headings and lists, but not GFM table markup.
    # Render labeled cells, preserving source row/column order and blank cells,
    # so the existing annotatable UI can display these without a new renderer.
    parts = [material["caption"]] if material["caption"] else []
    for number, row in enumerate(rows, 1):
        if len(rows) > 1:
            parts.append(f"### 行 {number}")
        parts.append("\n".join(f"- {column}: {cell}" for column, cell in zip(columns, row)))
    return "\n\n".join(parts)


def compile_cases(inventory: dict, blocks: dict) -> dict:
    """Return an expanded copy; keep the on-disk inventory compact and stable on re-export."""
    if "cases" not in inventory and "caseSchemaVersion" not in inventory:
        require(not any("caseId" in q or "subquestionId" in q for q in inventory.get("questions", []) if isinstance(q, dict)),
                "case references require a case inventory")
        return inventory
    require(inventory.get("caseSchemaVersion") == "1.0", "unsupported case schema version")
    result = copy.deepcopy(inventory)
    require(isinstance(result.get("cases"), list), "cases must be an array")
    require(isinstance(result.get("questions"), list), "questions must be an array")
    cases, contents, memberships, source_ids = {}, {}, {}, set()
    for case in result["cases"]:
        require(isinstance(case, dict) and set(case) == {"id", "sourceQuestionId", "expectedSubquestions", "reviewed", "materials"}, "invalid case fields")
        cid = case["id"]
        require(nonempty(cid) and cid not in cases, "case IDs must be unique nonempty strings")
        require(nonempty(case["sourceQuestionId"]), "case sourceQuestionId is required")
        require(case["sourceQuestionId"] not in source_ids, "duplicate case sourceQuestionId")
        source_ids.add(case["sourceQuestionId"])
        require(type(case["expectedSubquestions"]) is int and case["expectedSubquestions"] >= 1, "expectedSubquestions must be positive")
        require(type(case["reviewed"]) is bool, "reviewed must be boolean")
        require(isinstance(case["materials"], list), "materials must be an array")
        mids, parts, refs = set(), [], []
        for material in case["materials"]:
            rendered = render_material(material)
            require(material["id"] not in mids, "duplicate material ID in case")
            mids.add(material["id"])
            require(all(bid in blocks for bid in material["blockRefs"]), "unknown material source block")
            if material["kind"] == "figure":
                require(all(blocks[bid]["kind"] == "image" for bid in material["blockRefs"]), "figures must cite image blocks")
            parts.append(rendered)
            refs.extend(material["blockRefs"])
        cases[cid], memberships[cid] = case, set()
        contents[cid] = ("\n\n".join(p for p in parts if p), list(dict.fromkeys(refs)))
    for row in result["questions"]:
        require(isinstance(row, dict), "question must be an object")
        cid, sid = row.get("caseId"), row.get("subquestionId")
        require(isinstance(cid, str) and cid in cases, "question references unknown case")
        require(nonempty(sid) and sid not in memberships[cid], "subquestion IDs must be unique within a case")
        memberships[cid].add(sid)
        case = cases[cid]
        source_id = row.get("sourceQuestionId")
        permitted = [case["sourceQuestionId"] + " / " + sid]
        if case["expectedSubquestions"] == 1:
            permitted.append(case["sourceQuestionId"])
        require(source_id in permitted, "subquestion source scope disagrees with case")
        if row.get("status") == "ready":
            require(case["reviewed"], "shared case material must be reviewed before exporting a subquestion")
            for material in case["materials"]:
                if material["kind"] == "figure":
                    require(material["textSufficient"] and nonempty(material["description"]), "necessary figure lacks a sufficient text description; keep question in review")
        if row.get("status") != "pending":
            passage, refs = contents[cid]
            require(isinstance(row.get("sources"), dict), "question sources must be an object")
            existing = row["sources"].get("passage", [])
            require(isinstance(existing, list) and all(nonempty(r) for r in existing), "invalid passage evidence")
            if refs:
                row["sources"]["passage"] = list(dict.fromkeys(existing + refs))
            if passage:
                require(isinstance(row.get("data"), dict) and isinstance(row["data"].get("stem"), str), "case question needs a prompt")
                row["data"]["stem"] = passage + "\n\n### 設問\n\n" + row["data"]["stem"]
            if "optionTable" in row:
                table = row["optionTable"]
                require(isinstance(table, dict) and set(table) == {"columns", "rows", "blockRefs"}, "invalid option table")
                require(isinstance(row.get("data"), dict) and not row["data"].get("options"), "use optionTable or data.options, not both")
                require(isinstance(table["rows"], list) and 2 <= len(table["rows"]) <= 20, "option table needs 2–20 rows")
                require(isinstance(table["blockRefs"], list) and table["blockRefs"] and all(nonempty(r) for r in table["blockRefs"]), "option table needs header evidence")
                require(len(table["blockRefs"]) == len(set(table["blockRefs"])), "duplicate option header evidence")
                option_ids, options, option_refs = set(), [], {}
                for option in table["rows"]:
                    require(isinstance(option, dict) and set(option) == {"id", "values", "blockRefs"}, "invalid option table row")
                    oid = option["id"]
                    require(nonempty(oid) and oid not in option_ids, "duplicate or missing option table ID")
                    option_ids.add(oid)
                    text = render_material({"id": oid, "kind": "table", "caption": "", "columns": table["columns"],
                                            "rows": [option["values"]], "blockRefs": option["blockRefs"]})
                    refs = list(dict.fromkeys(table["blockRefs"] + option["blockRefs"]))
                    require(all(bid in blocks for bid in refs), "unknown option table source block")
                    options.append({"id": oid, "text": text})
                    option_refs[oid] = refs
                row["data"]["options"] = options
                row["sources"]["options"] = option_refs
    for cid, case in cases.items():
        require(len(memberships[cid]) == case["expectedSubquestions"], f"{cid}: missing or extra subquestions (expected {case['expectedSubquestions']})")
    return result


def parse_options(body: str) -> tuple[str, list[dict]]:
    """Handle text options and row-major table options with standalone kana labels."""
    pattern = re.compile(r"^([アイウエオカキクケコサシスセソ])(?:[ \t　]+(.+)|[ \t　]*$)", re.M)
    matches = list(pattern.finditer(body))
    if not matches:
        return body.strip(), []
    options = []
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        start = match.start(2) if match.group(2) is not None else match.end()
        options.append({"id": match.group(1), "text": body[start:end].strip()})
    return body[:matches[0].start()].strip(), options


def case_inventory(base: dict) -> dict:
    """Turn scoped B question drafts into case material plus leaf question drafts."""
    result = copy.deepcopy(base)
    result.update(layoutId="ja-sg-subject-b", caseSchemaVersion="1.0", cases=[], questions=[])
    markers = re.compile(r"^[ \t　]*設問[ \t　]*([0-9０-９]+)?(?:[ \t　]+(.*))?[ \t　]*$", re.M)
    split_ids = set()
    for original in base["questions"]:
        # Generic extraction stops at the first options. Retain its full body
        # here so multiple subquestions can be split before parsing options.
        body = original.get("caseBody") or original["data"]["stem"]
        headings = list(markers.finditer(body))
        case_id = original["externalId"]
        if len(headings) > 1 and (any(not h.group(1) for h in headings) or len({h.group(1) for h in headings}) != len(headings)):
            raise ValueError(f"Subject B: {case_id}: ambiguous subquestion numbering; define distinct source IDs after review")
        prefix = body[:headings[0].start()].strip() if headings else ""
        case = {"id": case_id, "sourceQuestionId": original["sourceQuestionId"], "reviewed": False,
                "expectedSubquestions": max(1, len(headings)), "materials": []}
        if prefix:
            case["materials"].append({"id": "passage", "kind": "text", "text": prefix, "blockRefs": original["sources"]["stem"]})
        result["cases"].append(case)
        if len(headings) > 1:
            split_ids.add(case_id)
        for index, heading in enumerate(headings or [None]):
            row = copy.deepcopy(original)
            row.pop("caseBody", None)
            sid = str(int(heading.group(1))) if heading and heading.group(1) else "1"
            start = heading.start(2) if heading and heading.group(2) else heading.end() if heading else 0
            stop = headings[index + 1].start() if index + 1 < len(headings) else len(body)
            prompt, options = parse_options(body[start:stop])
            row.update(caseId=case_id, subquestionId=sid, order=len(result["questions"]) + 1)
            row["data"]["stem"], row["data"]["options"] = prompt, options
            row["sources"]["options"] = {o["id"]: original["sources"]["stem"] for o in options}
            # Recognize only unambiguous row-major tables with explicit simple
            # variable headers. Arbitrary OCR grids remain review candidates.
            group = re.search(r"解答群[^\n]*\n((?:[a-zA-Z][0-9]*[ \t　]*\n?){2,})$", prompt)
            if group:
                columns = group.group(1).split()
                values = [o["text"].splitlines() for o in options]
                if len(columns) >= 2 and len(options) >= 2 and all(len(v) == len(columns) for v in values):
                    row["optionTable"] = {"columns": columns, "blockRefs": original["sources"]["stem"],
                        "rows": [{"id": o["id"], "values": v, "blockRefs": original["sources"]["stem"]}
                                 for o, v in zip(options, values)]}
                    row["data"].pop("options")
                    row["sources"]["options"] = {}
            row.pop("validationIssues", None)
            if len(headings) > 1:
                row["externalId"] += f":s{sid}"
                row["sourceQuestionId"] += f" / {sid}"
                row["data"]["correctAnswers"] = []
                row["data"].pop("explanation", None)
                row["sources"]["correctAnswers"] = {}
                row["sources"].pop("explanation", None)
                row["reason"] = "Match each subquestion to its own source answer; a case-level key is not a subquestion key."
            else:
                row["reason"] = "Review the shared case, table layout, complete options and answer against the source."
            result["questions"].append(row)
    for entry in result["answerEntries"]:
        if entry.get("questionId") in split_ids:
            entry["questionId"] = None
            entry["reason"] = "Case was split into subquestions; reconcile this answer by its full case/subquestion identifier."
    for expectation in result["sourceExpectations"]:
        expectation["unit"] = "cases"
    result["coverage"]["questionCount"] = len(result["questions"])
    result["preparationReport"]["caseCount"] = len(result["cases"])
    return result
