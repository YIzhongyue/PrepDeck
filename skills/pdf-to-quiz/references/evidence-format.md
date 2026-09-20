# Evidence workspace 1.0

Read this before building the inventory. These files stay beside the PDF; only the final PrepDeck 1.0 import JSON goes to the application. Keep the original PDF and the entire workspace together for review.

## Extraction artifacts

```bash
python3 <skill-dir>/scripts/extract_pdf.py exam.pdf -o WORK/source.txt \
  --document WORK/document.json --report WORK/extraction.report.json
```

Exit codes: `0` complete extraction, `3` partial extraction requiring review, `1` failed extraction, `2` invalid command arguments. A complete extraction is not proof of semantic correctness. Always inspect the report and original PDF. Missing tools/backends, OCR errors, suspicious characters, visual content and page-count mismatches are recorded. A partial result is usable evidence after its affected pages have been checked; do not rerun blindly just to obtain exit 0.

PyMuPDF (optional: `python3 -m pip install pymupdf`) supplies text blocks with bounding boxes and renders pages containing images/vector drawings. The script falls back after backend exceptions to pypdf, then Poppler's `pdftotext -layout`. These fallbacks produce page-level text blocks with `bbox: null` and flag unknown layout coverage. OCR requires Poppler (`pdfinfo`, `pdftoppm`) and Tesseract with the selected language installed. It can run without a native text backend when `pdfinfo` supplies the page count. Native and OCR candidates are retained independently; their agreement is not proof of correctness. OCR remains page-level in this version.

`document.json` contains:

- `version: "1.0"`, `documentId` (SHA-256 of the original PDF bytes), `originalFileName`, real `extractedAt`, `pageCount`, `status`, `issues`, `backendAttempts`.
- `pages`: every source page in order, numbered from 1, with dimensions when available, `status`, `signals`, `errors`, `selectedText`, and `blocks`.
- Each block: `id`, `documentId`, `page`, `kind` (`text` or `image`), `text`, `method`, `bbox` (PDF coordinates `[x0,y0,x1,y1]`, or `null`). Image blocks also have an `asset` path relative to the document JSON. Rendered images include the full page, not an isolated semantic figure.

Do not invent coordinates for text-only backends or change raw blocks to match the desired output. Correct transcription in the inventory, citing the original evidence. Block IDs are local to this extraction; rebuilding the document requires rebuilding/reconciling the inventory. A document hash identifies exact bytes, not a stable question-bank identity across versions.

## Inventory and source coverage

Create the master inventory by inspecting the entire PDF, including answer tables, before filling question data. Record every discovered question with a contiguous `order` starting at 1. `externalId` must be stable and non-empty; preserve existing IDs on re-import. Use a meaningful source/section prefix where printed question numbers restart. Do not use filenames or file hashes as a substitute for a stable source namespace.

```json
{
  "version": "1.0",
  "documentId": "sha256:HASH_FROM_DOCUMENT",
  "exam": {"id": "sample-exam", "name": "Sample exam", "language": "en"},
  "coverage": {"questionCount": 1, "answerEntryCount": 1},
  "pageReviews": [
    {"page": 1, "status": "reviewed", "reason": "Checked Q1, both options and its inline answer against the PDF."}
  ],
  "questions": [
    {
      "externalId": "Section-A-Q1",
      "sourceQuestionId": "Section A / 1",
      "order": 1,
      "status": "ready",
      "data": {
        "type": "single_choice",
        "stem": "Which value is even?",
        "options": [{"id": "A", "text": "2"}, {"id": "B", "text": "3"}],
        "correctAnswers": ["A"]
      },
      "sources": {
        "stem": ["p1-b1"],
        "options": {"A": ["p1-b1"], "B": ["p1-b1"]},
        "correctAnswers": {"A": ["p1-b1"]}
      }
    }
  ],
  "answerEntries": [
    {"id": "answer-1", "sourceQuestionId": "Section A / 1", "blockRefs": ["p1-b1"], "correctAnswers": ["A"], "questionId": "Section-A-Q1"}
  ],
  "ignoredBlocks": []
}
```

Use actual block IDs, source question IDs and the document hash. This example shows one coarse page-level block shared across fields; use precise blocks whenever available. The script validates references and declared coverage, not whether a model transcribed their meaning correctly.

Question statuses:

- `pending`: inventory header (`externalId`, `sourceQuestionId`, `order`) reserved for a later batch. Never exported.
- `ready`: complete valid `data`, evidence for the stem, every option and every accepted answer; official explanations need `sources.explanation`.
- `review`: unresolved question, with `reason` and at least `sources.stem`; partial `data`/other source fields may be retained. Never exported.
- `excluded`: deliberately omitted question, with `reason` and at least `sources.stem`. Never exported.

Additional source fields: `passage` for shared material, `figures` for necessary image blocks, `explanation`; each is an array of block IDs. Arrays can span pages. Shared material may be referenced by multiple questions. When ready questions use `figures`, supply `visualDescriptions: {"block-id": "faithful description"}` and include that exact description in the exported stem or option text. If a visual cannot be represented faithfully as text, mark the question `review`; this version does not add application image support.

Every page needs a `pageReviews` entry (`reviewed` or `excluded`) with a substantive reason. Inspect original pages even when extraction says complete. Explain document-level extraction issues in `documentReview`; a discrepancy in the actual page inventory must be fixed before export. Ready questions cannot use an excluded page.

Record every inline or separate answer-key entry in `answerEntries`. Match by `sourceQuestionId` including section, not array position. An entry with no corresponding question has `questionId: null` and a `reason`; it appears in the review report. Multiple source entries can support one question. Each entry records normalized `correctAnswers`; use `null` with a `reason` when unreadable. All entries matched to a ready question must agree with its answers. Conflicting answers require `review`, never automatic selection. If the question explicitly specifies a selection count, record `expectedAnswerCount` on its inventory entry; the builder checks that count too.

Every non-empty text block and every image block must be referenced or explicitly listed in `ignoredBlocks` as `{"blockId":"p1-b2","reason":"Recurring page footer"}`. Classify alternative OCR/native copies too; do not silently drop disagreeing evidence. This catches unassigned options/answer blocks at the extraction's granularity. It cannot detect a missing question inside a coarse block; manual page review and the independently counted `coverage` totals remain necessary.

## Batching, checks and export

Split work on question boundaries. Include adjacent pages when a stem/option continues, and include corresponding answer-key pages regardless of distance. Each batch is `{"documentId":"...","questions":[complete inventory question entries]}`. It fills only `pending` master entries and must retain their IDs, source IDs and order. Overlapping batches are errors, even when they contain identical data. This makes repeatable merging possible without silently replacing reviewed work.

Validate completed batches while others are pending:

```bash
python3 <skill-dir>/scripts/build_quiz.py WORK/document.json WORK/inventory.json \
  --batch WORK/batch-01.json --allow-pending
```

After all entries have a final status:

```bash
python3 <skill-dir>/scripts/build_quiz.py WORK/document.json WORK/inventory.json \
  --batch WORK/batch-*.json --output OUTPUT.json
python3 <skill-dir>/scripts/validate_quiz.py OUTPUT.json
```

Omit `--batch` when editing one complete inventory. Omit `--output` to validate only. The builder checks page/block references, assets, question ordering, coverage totals, answer-entry linkage, required field evidence and import validation. Exports are sorted by source order regardless of batch order. It writes `OUTPUT.review.json` with counts/withheld items/page reviews/unmatched answers and `OUTPUT.inventory.json` with the merged evidence. An all-unresolved inventory writes those sidecars only and removes a previous import at the specified output path. An invalid inventory exits nonzero and does not write new outputs. Do not reuse an older import after a failed build.

Review every warning (including possible placeholder words, which may also be legitimate source text). Final manual checks must verify source fidelity, answer conflicts, cross-page joins and any visually described content. Never infer missing answers from subject knowledge.
