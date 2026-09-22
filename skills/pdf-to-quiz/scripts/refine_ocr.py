#!/usr/bin/env python3
"""Re-OCR selected original pages without losing the earlier extraction evidence."""

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
from extract_pdf import ocr_page
from answer_evidence import select_refinement
from pdf_layouts import load_profiles, get_layout


def refine(pdf, document, pages, profile, dpi=240, workers=4):
    with pdf.open("rb") as source:
        identity = "sha256:" + hashlib.file_digest(source, "sha256").hexdigest()
    if document["documentId"] != identity:
        raise ValueError("PDF does not match evidence document")
    by_page = {p["page"]: p for p in document["pages"]}
    if any(n not in by_page for n in pages):
        raise ValueError("unknown source page")
    config = profile["extraction"]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        jobs = {
            pool.submit(
                ocr_page,
                pdf,
                n,
                config.get("language", "eng"),
                dpi,
                config.get("psm", 6),
                True,
                profile.get("boxedHeaderPattern"),
            ): n
            for n in pages
        }
        for k, job in enumerate(as_completed(jobs), 1):
            n = jobs[job]
            p = by_page[n]
            try:
                text = job.result()
                p["blocks"].append(
                    {
                        "id": f"p{n}-b{len(p['blocks']) + 1}",
                        "documentId": identity,
                        "page": n,
                        "kind": "text",
                        "text": text,
                        "bbox": None,
                        "method": "tesseract",
                    }
                )
                p["selectedText"], decision = select_refinement(
                    p.get("selectedText", ""), text, profile
                )
                p.setdefault("refinements", []).append(
                    {"blockId": p["blocks"][-1]["id"], "selection": decision}
                )
                p["status"] = "review"
                p["signals"].append("refined_ocr_requires_review")
            except Exception as error:
                p["errors"].append(str(error))
            if k % 10 == 0:
                print(f"Refined {k}/{len(pages)}", flush=True)
    return document


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("pdf", type=Path)
    p.add_argument("document", type=Path)
    p.add_argument(
        "--pages", required=True, help="comma-separated inclusive ranges, e.g. 20:30,42"
    )
    p.add_argument("--profiles", type=Path, required=True)
    p.add_argument("--layout", required=True)
    p.add_argument("--dpi", type=int, default=240)
    p.add_argument("--workers", type=int, choices=range(1, 9), default=4)
    p.add_argument("-o", "--output", type=Path, required=True)
    a = p.parse_args()
    if a.output.resolve() in (a.pdf.resolve(), a.document.resolve()):
        p.error("preserve source document; use a new output")
    load_profiles(a.profiles)
    pages = []
    for part in a.pages.split(","):
        bounds = [int(n) for n in part.split(":")]
        pages.extend(range(bounds[0], bounds[-1] + 1))
    d = refine(
        a.pdf,
        json.loads(a.document.read_text()),
        sorted(set(pages)),
        get_layout(a.layout),
        a.dpi,
        a.workers,
    )
    a.output.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
