#!/usr/bin/env python3
"""Normalize Docling layout/OCR output into the PDF evidence document contract.

Docling is optional and runs locally. Original page numbers and raw Docling JSON
are retained. This step identifies document blocks, never questions or answers.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time


def convert(pdf, output, pages=None, language="eng"):
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions,
        TesseractCliOcrOptions,
    )
    from docling.datamodel.accelerator_options import (
        AcceleratorOptions,
        AcceleratorDevice,
    )
    import fitz

    with Path(pdf).open("rb") as source:
        identity = "sha256:" + hashlib.file_digest(source, "sha256").hexdigest()
    options = PdfPipelineOptions()
    options.ocr_options = TesseractCliOcrOptions(lang=language.split("+"))
    options.accelerator_options = AcceleratorOptions(
        num_threads=2, device=AcceleratorDevice.CPU
    )
    options.generate_picture_images = True
    options.generate_page_images = True
    options.images_scale = 1.5
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    assets = target.parent / (target.stem + ".assets")
    assets.mkdir(exist_ok=True)
    started = time.monotonic()
    # Sparse evaluation ranges use a temporary subset, retaining the original mapping.
    import tempfile

    with fitz.open(pdf) as original, tempfile.TemporaryDirectory() as temp:
        selected = pages or list(range(1, len(original) + 1))
        if (
            not selected
            or len(set(selected)) != len(selected)
            or any(p < 1 or p > len(original) for p in selected)
        ):
            raise ValueError("invalid or duplicate source pages")
        subset = fitz.open()
        for number in selected:
            subset.insert_pdf(original, from_page=number - 1, to_page=number - 1)
        path = Path(temp) / "subset.pdf"
        subset.save(path)
        subset.close()
        result = converter.convert(path)
        raw = result.document.export_to_dict()
        target.with_suffix(".docling.json").write_text(
            json.dumps(raw, ensure_ascii=False), encoding="utf-8"
        )
        normalized = []
        for local, number in enumerate(selected, 1):
            page = original[number - 1]
            blocks = []
            for item, _ in result.document.iterate_items():
                prov = [p for p in getattr(item, "prov", []) if p.page_no == local]
                if not prov:
                    continue
                box = prov[0].bbox.to_top_left_origin(page_height=page.rect.height)
                b = {
                    "id": f"p{number}-b{len(blocks) + 1}",
                    "documentId": identity,
                    "page": number,
                    "bbox": [box.l, box.t, box.r, box.b],
                    "method": "docling",
                    "text": getattr(item, "text", ""),
                }
                label = str(getattr(item, "label", "")).split(".")[-1].lower()
                if label == "table":
                    b["kind"] = "table"
                    b["table"] = item.data.model_dump(mode="json")
                    b["text"] = item.export_to_markdown(doc=result.document)
                elif label in ("picture", "chart"):
                    b["kind"] = "image"
                    picture = item.get_image(result.document)
                    if picture:
                        filename = f"p{number}-{len(blocks) + 1}.png"
                        picture.save(assets / filename)
                        b["asset"] = f"{assets.name}/{filename}"
                    else:
                        b["issue"] = "picture pixels unavailable"
                else:
                    b["kind"] = "text"
                    b["label"] = label
                blocks.append(b)
            normalized.append(
                {
                    "page": number,
                    "width": page.rect.width,
                    "height": page.rect.height,
                    "blocks": blocks,
                    "selectedText": "\n".join(
                        b["text"] for b in blocks if b.get("text")
                    ),
                    "status": "review",
                    "signals": ["structured_extraction_requires_review"],
                    "errors": [],
                }
            )
        document = {
            "version": "1.0",
            "documentId": identity,
            "originalFileName": Path(pdf).name,
            "extractedAt": datetime.now(timezone.utc).isoformat(),
            "pageCount": len(original),
            "status": "partial",
            "issues": ["source review required"]
            + ([] if pages is None else ["partial page selection"]),
            "pages": normalized,
            "backend": "docling",
            "selectedPages": selected,
        }
        target.write_text(
            json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        report = {
            "backend": "docling",
            "status": str(result.status),
            "seconds": round(time.monotonic() - started, 2),
            "sourcePages": len(original),
            "processedPages": len(normalized),
            "textBlocks": sum(
                b["kind"] == "text" for p in normalized for b in p["blocks"]
            ),
            "tables": sum(
                b["kind"] == "table" for p in normalized for b in p["blocks"]
            ),
            "pictures": sum(
                b["kind"] == "image" for p in normalized for b in p["blocks"]
            ),
        }
        target.with_suffix(".report.json").write_text(
            json.dumps(report, indent=2) + "\n"
        )
        print(json.dumps(report))
        return document


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("pdf", type=Path)
    p.add_argument("-o", "--output", type=Path, required=True)
    p.add_argument(
        "--pages", help="comma-separated original page numbers; evaluation only"
    )
    p.add_argument("--language", default="eng")
    a = p.parse_args()
    if a.pdf.resolve() == a.output.resolve():
        p.error("output must differ from input")
    convert(
        a.pdf,
        a.output,
        [int(v) for v in a.pages.split(",")] if a.pages else None,
        a.language,
    )
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
