#!/usr/bin/env python3
"""Create a local browser workbench for source comparison and draft corrections.

Downloads remain unapproved inventories; the source-gated builder is still the
only export path. No PDF, source pixels or question text leaves this machine.
"""

import argparse
import json
import os
from pathlib import Path
from urllib.parse import quote


def render(document, inventory, root, output):
    if document["documentId"] != inventory["documentId"]:
        raise ValueError("document identity mismatch")
    pages = []
    for page in document["pages"]:
        images = []
        for block in page["blocks"]:
            if block.get("kind") != "image" or not block.get("asset"):
                continue
            path = (root / block["asset"]).resolve()
            if not path.is_relative_to(root.resolve()):
                raise ValueError("source images must remain inside evidence workspace")
            if path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
                continue
            images.append(
                {
                    "id": block["id"],
                    "url": quote(os.path.relpath(path, output.parent), safe="/"),
                    "bbox": block.get("bbox"),
                }
            )
        pages.append(
            {
                "page": page["page"],
                "images": images,
                "text": page.get("selectedText", ""),
            }
        )
    data = {
        "inventory": inventory,
        "pages": pages,
        "blockPages": {
            b["id"]: p["page"] for p in document["pages"] for b in p["blocks"]
        },
    }
    template = (
        Path(__file__).resolve().parents[1] / "assets/component-review.html"
    ).read_text()
    return template.replace(
        "/* REVIEW_DATA */",
        json.dumps(data, ensure_ascii=False).replace("<", "\\u003c"),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", type=Path)
    parser.add_argument("inventory", type=Path)
    parser.add_argument("-o", "--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() in (args.document.resolve(), args.inventory.resolve()):
        parser.error("output must differ from sources")
    document = json.loads(args.document.read_text())
    inventory = json.loads(args.inventory.read_text())
    html = render(
        document, inventory, args.document.resolve().parent, args.output.resolve()
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(html, encoding="utf-8")
    print(f"Open {args.output} locally. Downloads are unapproved review inventories.")


if __name__ == "__main__":
    main()
