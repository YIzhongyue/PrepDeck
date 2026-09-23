#!/usr/bin/env python3
"""Resolve sourceBlocks in a question assembly plan through component handlers.

Input is a component package draft: any content block can use sourceBlocks
instead of transcribed values. This produces a draft, not source approval.
"""

import argparse
import json
from pathlib import Path
from component_handlers import assemble_component
from components import validate_components


def assemble(document, plan, root):
    assets = {a["id"]: a for a in plan.get("assets", [])}

    def convert(blocks):
        result = []
        for b in blocks:
            if "sourceBlocks" in b:
                b, asset = assemble_component(b, document, root)
                if asset:
                    if asset["id"] in assets and assets[asset["id"]] != asset:
                        raise ValueError("conflicting asset identity")
                    assets[asset["id"]] = asset
            result.append(b)
        return result

    for stimulus in plan.get("stimuli", []):
        stimulus["body"] = convert(stimulus["body"])
    for item in plan["questions"]:
        item["body"] = convert(item["body"])
        i = item["interaction"]
        options = (
            i.get("options", []) if i["type"] != "match" else i["left"] + i["right"]
        )
        for option in options:
            if "body" in option:
                option["body"] = convert(option["body"])
    plan["assets"] = list(assets.values())
    errors = validate_components(plan)
    return plan, errors


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("document", type=Path)
    p.add_argument("plan", type=Path)
    p.add_argument("-o", "--output", type=Path, required=True)
    a = p.parse_args()
    if a.output.resolve() in (a.document.resolve(), a.plan.resolve()):
        p.error("output must differ from source")
    result, errors = assemble(
        json.loads(a.document.read_text()),
        json.loads(a.plan.read_text()),
        a.document.parent,
    )
    a.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "review", "issues": errors}, ensure_ascii=False))
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
