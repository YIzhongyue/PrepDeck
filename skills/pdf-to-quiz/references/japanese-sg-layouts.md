# Japanese SG PDF layouts

Both source books cover 情報セキュリティマネジメント (SG), 科目A and 科目B.
For B case studies use the dedicated [Subject B schema and workflow](subject-b-cases.md)
after extraction; it supports shared case materials, table options and subquestions.
Default to one exam (`ipa-sg`, language `ja`), with distinct material/edition
namespaces and section tags. Use the existing exam catalog ID if different.
The [layout catalog](pdf-layouts.json) is also served by the application. Layout
versions are separate from the output schema; both produce existing **1.0**
imports after review, with no new question type or database migration.

## Text collection: `ja-sg-interleaved`

The inspected `layout1.pdf` has 551 pages and 258 question/answer pairs:
科目A has 12 + 12 + 12 + 48 + 50 + 50 + 50 questions; 科目B has 3 + 3 + 3 + 12 + 3.
`問1` restarts by section. The two 科目B sample sections have different publication
dates and numbering. Native text is primary. Retain page images for diagrams
and option tables; OCR only missing/suspect text by default. `問N：正答 エ` starts
an answer/explanation, which may continue across pages.

```bash
python3 <skill-dir>/scripts/extract_pdf.py layout1.pdf \
  --layout ja-sg-interleaved --ocr-cache WORK/ocr-cache -o WORK/source.txt
python3 <skill-dir>/scripts/prepare_layout.py WORK/source.document.json \
  --layout ja-sg-interleaved --namespace te2-sg-2025 \
  --exam-id ipa-sg --exam-name '情報セキュリティマネジメント' \
  -o WORK/inventory.json
```

The helper detects year/subject/datestamped sample headings and scopes identities
as `material:section:qN`. Table options, image-dependent stems and source-year
annotations in options require correction. Preserve kana labels. A combination
option such as `ア = (一), (三)` is one choice when the key selects ア, even if it
names several actions. A blank in a case study does not imply `fill_blank`
when an answer group is provided.

## Scanned textbook: `ja-sg-textbook-ocr`

The inspected `layout2.pdf` has 575 image-only pages with bookmarks, mixing
textbook prose, chapter examples, mock/sample questions, answer tables and
separate explanations. OCR defaults to Japanese at 300 DPI with segmentation
mode 6. Install Tesseract's `jpn` language data and `opencv-python-headless`
(`python3 -m pip install pymupdf opencv-python-headless`). The scanned layout
reads short dark question-label boxes separately with OCR, then processes the
surrounding text in page bands. Numbers come from recognized pixels, never
inferred sequence. It falls back to ordinary OCR when labels are unreadable or
column geometry is ambiguous. `--no-boxed-headers` disables this preprocessing.
Original page renders are preserved and all output still requires review.
`--ocr-lang jpn+eng` or `--psm 3`
may help on individual layouts; retain conflicting versions as evidence.

```bash
python3 <skill-dir>/scripts/extract_pdf.py layout2.pdf \
  --layout ja-sg-textbook-ocr --ocr-cache WORK/ocr-cache -o WORK/source.txt
python3 <skill-dir>/scripts/prepare_layout.py WORK/source.document.json \
  --layout ja-sg-textbook-ocr --namespace derutoko-sg-2025 \
  --exam-id ipa-sg --exam-name '情報セキュリティマネジメント' \
  --sections WORK/sections.json -o WORK/inventory.json
```

Copy [the inspected edition's page plan](ja-sg-textbook-sections.json) to
`WORK/sections.json` and verify physical PDF page numbers, not printed folios.
Mock and sample exams each have 48 A questions and 12 B questions. Question
and answer ranges share the same section ID, so matching uses scoped printed
numbers rather than array positions. `expectedQuestions` prevents exporting
only the OCR survivors as a complete inventory. Repair missing headers or
inventory unreadable questions as `review`; do not delete counts to pass a build.

Section roles are `questions`, `answers`, `interleaved`, or `reference`;
each has `id`, `startPage`, `endPage` (inclusive). Optional `questionPattern`
captures the printed number in group 1 and a same-line stem in group 2.
`answerPattern` captures number and kana labels in groups 1 and 2. Use distinct
scopes when example numbers restart. Split examples with multiple subquestions
manually, retaining their shared case passage in each stem. The chapter range
is an inventory starting point, not a guarantee of complete recognition.

Dark question-number boxes, colored kana labels, sidebars and multi-column
answer tables are unreliable under OCR. Inspect original pages; put corrected
transcription in the inventory with source image references. Never infer イ/エ
or missing 問 numbers by position. Independently reconcile answer tables
(PDF pages 468 and 536 in this edition) with explanation headers. Reference
sections are not automatically excluded or marked reviewed.

## Review, export and import

`prepare_layout.py` exits **3** for a generated draft: all questions are `review`,
`pageReviews` is empty, and no import JSON is emitted. Exit 1 indicates invalid
input or ambiguous scopes. `preparationReport` records missing headers/count
mismatches. These are candidates, not a certified full inventory. Keep raw
blocks unchanged; correct transcription and references in the inventory.
Complete the [evidence workflow](evidence-format.md), including all pages,
source blocks, figures, and independent question/answer counts.

Mark verified questions `ready`, leaving unresolved ones `review` with reasons.
Represent necessary diagrams as faithful text/Markdown tables only when
sufficient to answer; otherwise withhold the question. The application still
has no managed question-image import contract.

```bash
python3 <skill-dir>/scripts/build_quiz.py WORK/source.document.json WORK/inventory.json \
  --output WORK/import.json
python3 <skill-dir>/scripts/validate_quiz.py WORK/import.json
```

Upload the final file through Web UI **Import JSON**, or use Admin MCP
`admin_preview_import` then `admin_execute_import` with the returned ID/token.
Create the exam first if absent. Discover formats through `GET /api/import-schemas`,
`user_get_import_schemas` or `admin_get_import_schemas`. Ordinary users can
prepare files; shared-bank writes remain administrator-only. This workflow
does not add a PDF upload endpoint or remote OCR service.

OCR cache keys bind document bytes, page, language, DPI, PSM and box processing. Recreate caches
after upgrading OCR engines/language models. PDFs, full text, images and
inventories stay local; the distributed skill contains rules and synthetic tests.
