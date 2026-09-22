#!/usr/bin/env python3
"""Extract PDF text plus document evidence and a quality report (0 complete, 3 partial, 1 failed)."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pdf_layouts import LAYOUTS, get_layout, load_profiles


def command(args: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(args, check=True, text=True, capture_output=True, timeout=120)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f"{args[0]} failed: {(error.stderr or str(error)).strip()}") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"{args[0]} timed out after 120 seconds") from error


def page_count(pdf: Path) -> int | None:
    if shutil.which("pdfinfo"):
        for line in command(["pdfinfo", str(pdf)]).stdout.splitlines():
            if line.startswith("Pages:"):
                return int(line.split(":", 1)[1].strip())
    return None


def text_page(text: str, method: str) -> dict[str, Any]:
    return {"width": None, "height": None, "blank": False, "visualCoverage": "unknown",
            "blocks": [{"kind": "text", "text": text, "bbox": None, "method": method}] if text else []}


def extract_backend(pdf: Path, backend: str, assets: Path) -> list[dict[str, Any]]:
    if backend == "pymupdf":
        import fitz  # type: ignore[import-not-found]
        pages = []
        with fitz.open(pdf) as document:
            for number, page in enumerate(document, 1):
                # Do not decode every image into the text dictionary. Some books
                # share hundreds of image resources on every page.
                layout = page.get_text("dict", flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)
                blocks = []
                for block in layout["blocks"]:
                    if block["type"] == 0:
                        text = "\n".join("".join(span["text"] for span in line["spans"]) for line in block["lines"])
                        blocks.append({"kind": "text", "text": text, "bbox": list(block["bbox"]), "method": backend})
                visual = bool(page.get_image_info()) or bool(page.get_drawings())
                if visual:
                    # A full-page rendering also preserves vector diagrams, masks and surrounding context.
                    assets.mkdir(parents=True, exist_ok=True)
                    target = assets / f"page-{number}.png"
                    page.get_pixmap(dpi=150).save(str(target))
                    blocks.append({"kind": "image", "text": "", "bbox": list(page.rect),
                                   "method": "render", "asset": f"{assets.name}/{target.name}"})
                pages.append({"width": layout["width"], "height": layout["height"], "blocks": blocks,
                              "blank": not blocks, "visualCoverage": "rendered" if visual else "native"})
        return pages
    if backend == "pypdf":
        from pypdf import PdfReader  # type: ignore[import-not-found]
        return [text_page(page.extract_text() or "", backend) for page in PdfReader(str(pdf)).pages]
    with tempfile.TemporaryDirectory() as temp:
        target = Path(temp) / "source.txt"
        command(["pdftotext", "-layout", str(pdf), str(target)])
        pages = target.read_text(encoding="utf-8", errors="replace").split("\f")
        # Remove only the form-feed terminator, never a whitespace-only final PDF page.
        if pages and pages[-1] == "":
            pages.pop()
        return [text_page(text, backend) for text in pages]


def extract_native(pdf: Path, assets: Path) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    attempts = []
    for backend, available in (
        ("pymupdf", importlib.util.find_spec("fitz") is not None),
        ("pypdf", importlib.util.find_spec("pypdf") is not None),
        ("pdftotext", shutil.which("pdftotext") is not None),
    ):
        if not available:
            attempts.append({"backend": backend, "status": "unavailable"})
            continue
        try:
            pages = extract_backend(pdf, backend, assets)
            if not pages:
                raise RuntimeError("returned no pages")
            attempts.append({"backend": backend, "status": "success"})
            return pages, attempts
        except Exception as error:
            # Third-party PDF libraries have different exception hierarchies.
            attempts.append({"backend": backend, "status": "failed", "error": str(error)})
    return [], attempts


def ocr_page(pdf: Path, page: int, language: str, dpi: int, psm: int = 3, boxed_headers: bool = False, header_pattern: str | None = None) -> str:
    has_fitz = importlib.util.find_spec("fitz") is not None
    required = ("tesseract",) if has_fitz else ("pdftoppm", "tesseract")
    missing = [name for name in required if not shutil.which(name)]
    if missing:
        raise RuntimeError("OCR requested but missing command(s): " + ", ".join(missing))
    with tempfile.TemporaryDirectory() as temp:
        prefix = Path(temp) / "page"
        if has_fitz:
            import fitz
            with fitz.open(pdf) as document:
                document[page - 1].get_pixmap(dpi=dpi).save(str(prefix) + ".png")
        else:
            command(["pdftoppm", "-f", str(page), "-l", str(page), "-singlefile",
                     "-r", str(dpi), "-png", str(pdf), str(prefix)])
        if boxed_headers:
            from boxed_ocr import recognize
            return recognize(prefix.with_suffix(".png"), language, dpi, psm, command, **({"label_pattern": header_pattern} if header_pattern else {}))
        return command(["tesseract", str(prefix) + ".png", "stdout", "-l", language, "--psm", str(psm)]).stdout


def cached_ocr(pdf, number, language, dpi, psm, boxed_headers, cache, identity, header_pattern=None):
    key = hashlib.sha256(f"v5:{identity}:{number}:{language}:{dpi}:{psm}:{boxed_headers}:{header_pattern}".encode()).hexdigest()
    target = cache / f"{key}.json"
    if target.is_file():
        return
    recognized = ocr_page(pdf, number, language, dpi, psm, boxed_headers, header_pattern)
    write_json(target, {"text": recognized})


def useful_characters(text: str) -> int:
    return sum(character.isalnum() for character in text)


def quality_signals(text: str, threshold: int) -> list[str]:
    signals = []
    if useful_characters(text) < threshold:
        signals.append("low_text")
    if "\ufffd" in text or any(ord(c) < 32 and c not in "\n\r\t" for c in text):
        signals.append("suspect_characters")
    return signals


def extract(pdf: Path, assets: Path, ocr: str = "auto", language: str = "eng",
            threshold: int = 40, dpi: int = 300, psm: int = 3,
            cache: Path | None = None, boxed_headers: bool = False, workers: int = 1, header_pattern: str | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    with pdf.open("rb") as source:
        identity = "sha256:" + hashlib.file_digest(source, "sha256").hexdigest()
    pages, attempts = extract_native(pdf, assets)
    issues = []
    try:
        expected = page_count(pdf)
    except (OSError, RuntimeError, ValueError) as error:
        expected = None
        issues.append(f"page_count_unavailable: {error}")
    native_count = len(pages)
    if expected is not None and native_count != expected:
        issues.append(f"page_count_mismatch: native={native_count}, expected={expected}")
    if expected is not None:
        for _ in range(max(0, expected - len(pages))):
            pages.append(text_page("", "unavailable"))
    if workers > 1 and ocr == "always":
        if cache is None:
            raise ValueError("parallel OCR requires --ocr-cache")
        from concurrent.futures import ProcessPoolExecutor, as_completed
        with ProcessPoolExecutor(max_workers=min(workers, 8)) as pool:
            jobs = [pool.submit(cached_ocr, pdf, n, language, dpi, psm, boxed_headers, cache, identity, header_pattern) for n in range(1, len(pages) + 1)]
            for n, job in enumerate(as_completed(jobs), 1):
                try: job.result()
                except (OSError, RuntimeError, ValueError): pass  # Retry once below and report per-page errors.
                if n % 25 == 0: print(f"OCR cached {n}/{len(pages)} pages", flush=True)
    reports = []
    for number, page in enumerate(pages, 1):
        page["page"] = number
        native = "\n".join(b["text"] for b in page["blocks"] if b["kind"] == "text")
        signals = [] if page["blank"] else quality_signals(native, threshold)
        if page["visualCoverage"] == "unknown":
            signals.append("layout_unavailable")
        if any(b["kind"] == "image" for b in page["blocks"]):
            signals.append("visual_content")
        selected = native
        errors = []
        method = "native"
        triggers = ("low_text", "suspect_characters", "visual_content") if ocr == "auto" else ("low_text", "suspect_characters")
        use_ocr = ocr == "always" or (ocr in ("auto", "missing") and not page["blank"] and
                                      any(s in signals for s in triggers))
        if use_ocr:
            try:
                cache_key = hashlib.sha256(f"v5:{identity}:{number}:{language}:{dpi}:{psm}:{boxed_headers}:{header_pattern}".encode()).hexdigest()
                cache_file = cache / f"{cache_key}.json" if cache else None
                if cache_file and cache_file.is_file():
                    recognized = json.loads(cache_file.read_text(encoding="utf-8"))["text"]
                    if not isinstance(recognized, str):
                        raise ValueError("invalid OCR cache text")
                else:
                    recognized = ocr_page(pdf, number, language, dpi, psm, boxed_headers, header_pattern)
                    if cache_file:
                        write_json(cache_file, {"text": recognized})
                page["blocks"].append({"kind": "text", "text": recognized, "bbox": None, "method": "tesseract"})
                # Retain both candidates; do not replace readable native text with worse OCR.
                if recognized.strip() and (not native.strip() or
                    len(quality_signals(recognized, threshold)) < len(quality_signals(native, threshold))):
                    selected, method = recognized, "tesseract"
                signals.append("ocr_requires_review")
            except (OSError, RuntimeError, ValueError, KeyError) as error:
                errors.append(str(error))
                signals.append("ocr_failed")
        page["selectedText"] = selected
        for i, block in enumerate(page["blocks"], 1):
            block.update(id=f"p{number}-b{i}", documentId=identity, page=number)
        page["status"] = "blank" if page["blank"] and not selected.strip() and not errors else (
            "failed" if not selected.strip() else "review" if signals or errors else "extracted")
        page["signals"] = list(dict.fromkeys(signals))
        page["errors"] = errors
        reports.append({"page": number, "status": page["status"], "signals": page["signals"],
                        "errors": errors, "selectedMethod": method, "nativeCharacters": useful_characters(native),
                        "selectedCharacters": useful_characters(selected)})
    status = "complete"
    if not pages or all(p["status"] == "failed" for p in pages):
        status = "failed"
    elif issues or any(p["status"] in ("review", "failed") for p in pages):
        status = "partial"
    document = {"version": "1.0", "documentId": identity, "originalFileName": pdf.name,
                "extractedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "pageCount": expected if expected is not None else native_count,
                "status": status, "issues": issues, "backendAttempts": attempts, "pages": pages}
    document["ocrSettings"] = {"mode": ocr, "language": language, "dpi": dpi, "psm": psm, "boxedHeaders": boxed_headers}
    if importlib.util.find_spec("fitz") is not None:
        try:
            import fitz
            with fitz.open(pdf) as source:
                document["bookmarks"] = [{"level": level, "title": title, "page": number}
                                         for level, title, number in source.get_toc()]
        except Exception:
            # Bookmarks are optional hints; text/page extraction remains authoritative.
            document["bookmarks"] = []
    report = {"version": "1.0", "documentId": identity, "status": status,
              "expectedPages": expected, "nativePages": native_count, "processedPages": len(pages),
              "issues": issues, "backendAttempts": attempts, "pages": reports}
    return document, report


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", "-o", type=Path, required=True, help="page-delimited UTF-8 text")
    parser.add_argument("--document", type=Path, help="default: OUTPUT stem + .document.json")
    parser.add_argument("--report", type=Path, help="default: OUTPUT stem + .report.json")
    parser.add_argument("--workers", type=int, choices=range(1,9), default=1)
    parser.add_argument("--profiles", type=Path, help="optional provider profile catalog")
    parser.add_argument("--layout", help="PDF layout schema; explicit OCR flags override its defaults")
    parser.add_argument("--ocr", choices=("auto", "missing", "always", "never"))
    parser.add_argument("--ocr-lang")
    parser.add_argument("--ocr-threshold", type=int, default=40)
    parser.add_argument("--dpi", type=int)
    parser.add_argument("--psm", type=int, choices=range(3, 14), help="Tesseract page segmentation mode")
    parser.add_argument("--ocr-cache", type=Path, help="resume OCR using per-document/page/language/DPI/PSM results")
    parser.add_argument("--boxed-headers", action=argparse.BooleanOptionalAction, default=None,
                        help="read dark question-label boxes using the selected profile separately (requires OpenCV)")
    args = parser.parse_args()
    if args.profiles: load_profiles(args.profiles)
    defaults = get_layout(args.layout)["extraction"] if args.layout else {}
    args.ocr = args.ocr or defaults.get("ocr", "auto")
    args.ocr_lang = args.ocr_lang or defaults.get("language", "eng")
    args.dpi = args.dpi if args.dpi is not None else defaults.get("dpi", 300)
    args.psm = args.psm if args.psm is not None else defaults.get("psm", 3)
    args.boxed_headers = args.boxed_headers if args.boxed_headers is not None else defaults.get("boxedHeaders", False)
    if not args.input.is_file() or args.input.suffix.lower() != ".pdf":
        parser.error(f"not a readable PDF: {args.input}")
    if args.dpi <= 0 or args.ocr_threshold < 0:
        parser.error("dpi must be positive and ocr-threshold must be non-negative")
    document_path = args.document or args.output.with_suffix(".document.json")
    report_path = args.report or args.output.with_suffix(".report.json")
    paths = [p.resolve() for p in (args.input, args.output, document_path, report_path)]
    if len(set(paths)) != len(paths):
        parser.error("input, text, document and report paths must be distinct")
    try:
        document, report = extract(args.input, document_path.parent / (document_path.stem + ".assets"),
                                   args.ocr, args.ocr_lang, args.ocr_threshold, args.dpi, args.psm, args.ocr_cache, args.boxed_headers, args.workers, get_layout(args.layout).get("boxedHeaderPattern") if args.layout else None)
        if args.layout:
            document["layoutId"] = report["layoutId"] = args.layout
        write_json(document_path, document)
        write_json(report_path, report)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text("\n".join(f"===== PAGE {p['page']} =====\n{p['selectedText']}\n" for p in document["pages"]), encoding="utf-8")
        print(f"{document['status']}: {len(document['pages'])} page(s); report: {report_path}", file=sys.stderr)
        if not document["pages"]:
            print("Install PyMuPDF, pypdf or Poppler. OCR requires Poppler and Tesseract.", file=sys.stderr)
        return {"complete": 0, "partial": 3, "failed": 1}[document["status"]]
    except (OSError, RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
