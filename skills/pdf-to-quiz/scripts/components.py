"""Portable component package validation; schemas are shared with the Worker."""

import base64
import json
from pathlib import Path

SCHEMA = json.loads(
    (
        Path(__file__).resolve().parents[1] / "references/component-import.schema.json"
    ).read_text()
)


def block_text(block):
    kind = block["type"]
    if kind in ("paragraph", "heading", "code"):
        return block["text"]
    if kind == "list":
        return "\n".join(f"{e['id']}: {e['text']}" for e in block["entries"])
    if kind == "table":
        return "\n".join(
            [
                *([block["caption"]] if block.get("caption") else []),
                " | ".join(block["columns"]),
                *(" | ".join(r) for r in block["rows"]),
            ]
        )
    return "\n".join(filter(None, [block.get("caption"), block["alt"]]))


def resolve(file, item):
    stimuli = [
        next(s for s in file.get("stimuli", []) if s["id"] == identity)
        for identity in item.get("stimulusRefs", [])
    ]
    interaction = item["interaction"]
    options = (
        interaction.get("options", [])
        if interaction["type"] != "match"
        else interaction["left"] + interaction["right"]
    )
    blocks = (
        [b for s in stimuli for b in s["body"]]
        + item["body"]
        + [b for o in options for b in o.get("body", [])]
    )
    used = {b["assetId"] for b in blocks if b["type"] == "figure"}
    assets = [a for a in file.get("assets", []) if a["id"] in used]
    return stimuli, blocks, options, assets


def validate_components(data):
    from jsonschema import Draft7Validator
    from validate_quiz import utf16_length, valid_timestamp

    errors = []
    for e in Draft7Validator(SCHEMA).iter_errors(data):
        errors.append("$/" + "/".join(map(str, e.absolute_path)) + ": " + e.message)
        if len(errors) >= 20:
            return errors
    if errors:
        return errors

    def unique(values, where):
        if len(set(values)) != len(values):
            errors.append(where + ": duplicate IDs/references")

    unique([q["externalId"] for q in data["questions"]], "questions")
    unique([a["id"] for a in data.get("assets", [])], "assets")
    unique([s["id"] for s in data.get("stimuli", [])], "stimuli")
    for a in data.get("assets", []):
        try:
            raw = base64.b64decode(a["data"], validate=True)
            signature = (
                raw.startswith(b"\x89PNG\r\n\x1a\n")
                if a["mediaType"] == "image/png"
                else raw.startswith(b"\xff\xd8\xff")
                if a["mediaType"] == "image/jpeg"
                else raw.startswith(b"RIFF") and raw[8:12] == b"WEBP"
            )
            if (
                len(raw) > 262144
                or base64.b64encode(raw).decode() != a["data"]
                or not signature
            ):
                raise ValueError()
        except (ValueError, TypeError):
            errors.append("invalid raster asset " + a["id"])
    if "extractedAt" in data.get("source", {}) and not valid_timestamp(
        data["source"]["extractedAt"]
    ):
        errors.append("invalid source timestamp")
    used_stimuli = set()
    used_assets = set()
    for item in data["questions"]:
        refs = item.get("stimulusRefs", [])
        unique(refs, item["externalId"])
        used_stimuli.update(refs)
        if any(not any(s["id"] == r for s in data.get("stimuli", [])) for r in refs):
            errors.append("unknown stimulus")
            continue
        stimuli, blocks, options, assets = resolve(data, item)
        used_assets.update(a["id"] for a in assets)
        unique([b["id"] for b in blocks], "blocks")
        entries = [e for b in blocks if b["type"] == "list" for e in b["entries"]]
        unique([e["id"] for e in entries], "list entries")
        for b in blocks:
            if b["type"] == "figure" and not any(
                a["id"] == b["assetId"] for a in assets
            ):
                errors.append("unknown figure asset")
            if b["type"] == "table" and any(
                len(r) != len(b["columns"]) for r in b["rows"]
            ):
                errors.append("table row width mismatch")
            for source in b.get("sources", []):
                box = source.get("bbox")
                if box and (box[2] < box[0] or box[3] < box[1]):
                    errors.append("reversed source bbox")
        i = item["interaction"]
        answers = item["scoring"]["correctAnswers"]
        unique(answers, "answers")
        if i["type"] == "match":
            unique([o["id"] for o in i["left"]], "left")
            unique([o["id"] for o in i["right"]], "right")
        else:
            unique([o["id"] for o in options], "options")
        for o in options:
            unique(o.get("memberRefs", []), "memberRefs")
            if any(
                not any(e["id"] == r for e in entries) for r in o.get("memberRefs", [])
            ):
                errors.append("unknown list reference")
        if i["type"] in ("choice", "order"):
            if any(not any(o["id"] == a for o in options) for a in answers):
                errors.append("answer missing option")
            if (
                i["type"] == "choice"
                and i.get("variant") == "true_false"
                and (
                    i["multiple"]
                    or {o["id"] for o in options} != {"true", "false"}
                    or len(options) != 2
                )
            ):
                errors.append("true_false needs two options and one answer")
            if i["type"] == "choice" and (
                len(answers) < 2 if i["multiple"] else len(answers) != 1
            ):
                errors.append("choice cardinality mismatch")
            if i["type"] == "order" and len(answers) != len(options):
                errors.append("order must cover every option")
        if i["type"] == "match":
            left = set()
            for a in answers:
                try:
                    pair = json.loads(a)
                    if (
                        not isinstance(pair, list)
                        or len(pair) != 2
                        or json.dumps(pair, ensure_ascii=False, separators=(",", ":"))
                        != a
                        or pair[0] in left
                        or not any(o["id"] == pair[0] for o in i["left"])
                        or not any(o["id"] == pair[1] for o in i["right"])
                    ):
                        raise ValueError()
                    left.add(pair[0])
                except (ValueError, TypeError):
                    errors.append("invalid matching pair")
            if len(left) != len(i["left"]):
                errors.append("matching must cover each left entry")
        content = {
            "version": "1.0",
            "body": item["body"],
            "stimuli": stimuli,
            "assets": assets,
            "interaction": i,
        }
        if (
            len(json.dumps(content, ensure_ascii=False, separators=(",", ":")).encode())
            > 1048576
        ):
            errors.append("resolved question exceeds 1 MiB")
        stem = "\n\n".join(
            block_text(b)
            for b in [b for s in stimuli for b in s["body"]] + item["body"]
        )
        if utf16_length(stem) > 20000:
            errors.append("projected stem exceeds 20000 characters")
        projected_options = []
        for o in options:
            text = (
                "\n\n".join(block_text(b) for b in o["body"])
                if "body" in o
                else "; ".join(
                    r + ": " + next(e["text"] for e in entries if e["id"] == r)
                    for r in o["memberRefs"]
                    if any(e["id"] == r for e in entries)
                )
            )
            if utf16_length(text) > 10000:
                errors.append("projected option exceeds 10000 characters")
            projected_options.append({"id": o["id"], "text": text})
        kind = (
            "fill_blank"
            if i["type"] == "text"
            else "ordering"
            if i["type"] == "order"
            else "matching"
            if i["type"] == "match"
            else "true_false"
            if i.get("variant") == "true_false"
            else "multiple_choice"
            if i["multiple"]
            else "single_choice"
        )
        payload = {
            "content": content,
            "externalId": item["externalId"],
            "type": kind,
            "stem": stem,
            "correctAnswers": answers,
            "explanation": item.get("explanation"),
            "difficulty": item.get("difficulty"),
            "tags": item.get("tags", []),
            "points": item.get("points", 1),
        }
        if i["type"] != "text":
            payload["options"] = (
                projected_options[: len(i["left"])]
                if i["type"] == "match"
                else projected_options
            )
        if (
            len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())
            > 900000
        ):
            errors.append(
                "normalized question payload exceeds 900000-byte storage budget"
            )
    if any(s["id"] not in used_stimuli for s in data.get("stimuli", [])):
        errors.append("unreferenced stimulus")
    if any(a["id"] not in used_assets for a in data.get("assets", [])):
        errors.append("unreferenced asset")
    return errors[:100]
