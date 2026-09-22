# Component import 2.0

Use [the executable JSON Schema](component-import.schema.json) for structured
questions. The legacy [1.0 contract](import-format.md) remains supported.
This format is independent of PDF source, language and exam provider.

## Composition

A package has `schemaVersion: "2.0"`, `exam`, `questions`, and optional `stimuli`,
`assets`, `source`. Each item has a stable `externalId`, ordered `body` blocks,
optional `stimulusRefs`, one `interaction`, and separate `scoring`.
A shared case with three independently graded prompts becomes three items
referencing the same stimulus. Never copy the parent answer to all children.

Blocks: `paragraph`, `heading`, `list`, `table`, `figure`, `code`.
Code is literal text. Paragraphs default to plain text; optional `format: "markdown"`
uses the existing safe Markdown renderer and preserves legacy export formatting. Tables have
column labels and rectangular string cells; merged cells need a reviewed figure
or an explicit, faithful transcription. Figures refer to package assets and need
meaningful `alt` text. Sources may identify original document hash, physical page
and top-left `[x0,y0,x1,y1]` coordinates in PDF points.

Interactions:

| Type | Structure | Stored response / grading |
| --- | --- | --- |
| `choice` | `multiple`, options with unique IDs | One ID, or at least two IDs for multiple choice; exact set. Optional `variant: "true_false"` preserves that type and requires `true`/`false` IDs. |
| `text` | No options | One or more accepted source-backed strings; existing trimmed, case-insensitive exact comparison. |
| `order` | Options in source display order | Correct IDs in exact order, each exactly once. |
| `match` | `left` and `right` options | Canonical JSON pair strings, e.g. `"[\"low\",\"before\"]"`; exactly one pair per left ID. Right IDs may repeat; pair order does not affect grading. |

Options contain either `body` blocks or `memberRefs` pointing to IDs in a list.
A choice that names actions (a)+(c) remains **one choice**, not a multiple-choice
response. Use a list for available actions and references for their combinations.
Use small table blocks inside options for combinations of numeric variables.
There are no nested interactions, scripts, arbitrary HTML or partial-credit rules.

```json
{
  "schemaVersion": "2.0",
  "exam": { "id": "example", "name": "Example" },
  "stimuli": [{ "id": "passage", "revision": 1, "body": [
    { "id": "context", "type": "paragraph", "text": "The tank holds two litres." }
  ] }],
  "questions": [{
    "externalId": "reading-1",
    "stimulusRefs": ["passage"],
    "body": [{ "id": "prompt", "type": "paragraph", "text": "What is its capacity?" }],
    "interaction": { "id": "response", "type": "choice", "multiple": false, "options": [
      { "id": "A", "body": [{ "id": "option-a", "type": "paragraph", "text": "Two litres" }] },
      { "id": "B", "body": [{ "id": "option-b", "type": "paragraph", "text": "Four litres" }] }
    ] },
    "scoring": { "method": "exact", "correctAnswers": ["A"] }
  }]
}
```

PNG/JPEG/WebP assets use canonical base64 in `{id,mediaType,data}`. Each decoded
asset is at most 256 KiB, resolved content per question at most 1 MiB, and an
import at most 5 MiB / 32 JSON nesting levels. A normalized question payload
(content, projected text and metadata) is additionally capped at 900,000 bytes
to accommodate both current fields and the import baseline within the
[2,000,000-byte D1 row limit](https://developers.cloudflare.com/d1/platform/limits/). Split large banks into batches;
include resources used by each batch. Remote image URLs and SVG are unsupported.
IDs for blocks and list members are unique within a resolved item; stimuli/assets
are unique within the package. Reject dangling and unused references. The legacy
projection's stem/option text limits still apply. Source metadata is retained in
raw import archives; block provenance is also retained in question content.

## Local extraction and assembly

Install `pymupdf`, `jsonschema` and `Pillow`. Tesseract plus the relevant language
data is required for OCR; `opencv-python-headless` enables boxed-label refinement.
All commands run locally, before importing reviewed JSON.

1. `extract_pdf.py` produces the same evidence document for native text and OCR.
   Select `--layout native-interleaved` or `scanned-separate`, or pass a separate
   `--profiles profiles.json`. Profile regexes identify boundaries/labels; they
   are not question schemas and are not served by the application.
2. Run `prepare_components.py DOCUMENT --layout PROFILE --namespace EDITION
   --exam-id EXAM --exam-name NAME --sections SECTIONS -o INVENTORY`. It returns
   exit 3 with a review inventory. Scope printed numbers by section. A profile's
   `subquestionPattern` splits prompts and retains shared material; subquestions
   need independently reconciled answers. Explicit plans are needed where
   headings repeat. No component or source page is automatically approved.
   Preparation now retains exact native/structured block spans where available.
   A uniquely located structured table with explicit source header cells is
   dispatched to the table handler automatically. `reviews[].compositionCandidates`
   records original pages, coordinates, proposed handlers and unresolved placement.
   Plain OCR text is not guessed into a table; figures still need reviewed
   placement/crops and useful alt text. If transport provenance exceeds 30 block
   references, it becomes page-level provenance without dropping later pages;
   full block IDs remain in the inventory.
3. Inspect pages, question boundaries and answer keys before choosing handlers.
   Paragraph/code handlers combine selected text; the table handler consumes
   structured cells; the figure handler makes a bounded display copy of original
   pixels while keeping original assets untouched. Lists/references can be
   authored explicitly. `assemble_components.py DOCUMENT PLAN -o DRAFT` resolves
   blocks with `sourceBlocks` in a 2.0 package; `table` plans additionally specify
   `headerRows: 1` or explicit `columns`. It emits a draft, never an approval.
4. Place reviewed components in `inventory.package`. For each item, preserve
   `questionEvidence`, `answerEvidence`, section-qualified `sourceQuestionId`,
   `sourceCaseId` and matching `answerEntries`. Resolve every `visualEvidence`
   block as `included` (with `componentId`) or `not-required`, with a reason.
   Add `sources` to every content block and review all referenced original pages.
   Mark items `ready`, `review` or `excluded`; withheld items require reasons.
5. Run `build_components.py DOCUMENT INVENTORY -o IMPORT.json`, then
   `validate_quiz.py IMPORT.json`. The builder rejects missing source counts,
   conflicting answer entries and unreviewed evidence. No ready items means no
   import file. Exit 3 means items were withheld; the `.review.json` report states
   exported/withheld counts, unmatched answer entries, reviewed pages and
   `completeBookReview`. Reconcile unmatched answer entries against the inventory. A reviewed
   subset must be described as a subset; do not remove expected counts to make
   an incomplete full-book inventory pass.

Evidence source paths are relative to the document directory. Document block IDs
from different extraction backends must be disambiguated when merging evidence.
Review original pages even when the schema passes: structural validity does not
prove correct reading order, OCR, question completeness or answer association.

## Optional structured backend

[Docling](https://docling-project.github.io/docling/) provides layout/table/image
extraction. It is optional, runs outside the Worker and may download models on
first use. Install it in an isolated environment (`docling`, `pymupdf`), with
Tesseract available. The adapter was exercised with Docling 2.129.0:

```bash
python scripts/extract_structured.py SOURCE.pdf -o WORK/structured.json \
  --pages 10,11,12 --language eng
```

The adapter preserves original physical page numbers, coordinates, source hash,
raw `.docling.json` and image assets. A sparse `--pages` result is intentionally
partial; merge its selected blocks into a complete evidence inventory for full
book preparation, or explicitly review/export a selected subset. Table recognition
is useful, but Docling success is not an answer-key correctness guarantee.
`refine_ocr.py` can append a higher-resolution OCR pass for selected pages while
preserving the first pass; its `--help` describes profile and page-range options.
It selects a new pass only when it preserves detected question/answer identities
and does not substantially truncate text. Rejected passes remain available as
evidence. Dark-bar preprocessing also inverts answer glyphs beside boxed numbers.

## Answer recovery and quality reporting

In separate answer scopes, preparation reconciles the selected text and retained
OCR alternatives by scoped printed number. Profiles may define
`answerConclusionPattern` or `answerConclusionPatterns` (each regex has exactly
one label capture) for explicit official conclusions inside numbered answer
regions. Conclusions without a numbered region are not assigned. Unknown glyphs
are never substituted with plausible option labels. Conflicting readings retain
both entries and clear candidate scoring.

An answer section can opt into `"answerSequence": "ascending-consecutive"` when
the original material guarantees that order. Gaps, repeats and backwards jumps
mark the preceding region's association as uncertain and withhold its key.
This is not the default: arbitrary answer order is still supported. A ready item
with `boundaryIssues` needs an explicit `boundaryReview` on the answer entry,
with `status: "reviewed"` and a source-based `reason`, as well as normal page and
answer review. This check does not detect every possible misread number.

`report.quality` separates answer candidates, readable/unreadable entries,
conflicting source questions, uncertain boundaries, questions with nonempty
keys, missing/unknown option labels and reviewed items. A nonempty key is **not**
proof of question correctness. `componentIssues` is an explicitly labelled sample
of validation errors, not a total error count. Full-book expected counts remain
mandatory even when a selected subset looks correct.

Use `--answer-reference REFERENCE.json` to compare candidate keys with an
independently reviewed answer table or another official key. For example:

```json
{
  "documentId": "sha256:the-original-document-hash",
  "review": { "status": "reviewed", "reason": "Transcribed and compared the original answer table." },
  "entries": [
    { "sourceQuestionId": "paper / 1", "correctAnswers": ["B"], "blockRefs": ["p8-b1"] }
  ]
}
```

References must belong to the same document and retained blocks. This comparison
does not fill missing keys or approve items. Disagreement appends the independent
evidence, clears scoring and records a conflict in `report.answerCrosscheck`.
Original sources can disagree; do not silently prefer the table or explanation.

## Local source-review workbench

```bash
python scripts/review_components.py WORK/document.json WORK/inventory.json \
  -o WORK/review.html
```

Open the generated HTML locally. It displays retained source images and extracted
text beside question/shared-material JSON, answer observations and component
candidates. Filters find missing/conflicting answers, insufficient options and
visuals needing review. Images link to the retained full-resolution files; pages
without images explicitly request comparison with the original PDF. It uses no
network service and should stay beside the evidence workspace.

Keep corrections with a note, then download `corrected.inventory.json`. Editing
shared material resets every referencing item to `review`; edits do not approve
pages or source answers. Displayed extraction metrics are labelled as pre-edit
metrics, and the downloaded report has `qualityStale: true`. Check the complete
inventory with the builder/validator after reconciling evidence. The workbench
does not change block references, figure assets or shared identities; crop/asset
assembly and final source approval remain explicit workflow steps.

## Web UI and MCP

Discover schemas through `/api/import-schemas`, `user_get_import_schemas` or
`admin_get_import_schemas`. Web UI **Import JSON** validates both versions and
previews the first five items. Structured questions open a JSON editor with live
preview. Practice, Learning and Mock render the same content; order/match controls
save and restore normal attempt responses. Exact grading stays server-side.

Admin MCP uses `admin_preview_import` then `admin_execute_import` with the returned
ID/token. `admin_export_questions` and Web UI **Export this page** return portable
2.0 packages; follow `nextOffset` for subsequent pages. Exports that exceed the
5 MiB import limit are rejected; use a smaller API/MCP `limit` for image-heavy
pages. Legacy rows that exceed 2.0 field limits also need explicit correction. Shared snapshots must agree
within an exported page; conflicting stimulus revisions require separate exports.
Ordinary users can prepare files and discover schemas; bank writes/exports require
an administrator. No PDF-upload or hosted OCR endpoint is introduced.

Inline text annotations currently apply to legacy Markdown questions only.
Component text/figure annotations, a graphical block editor, complex table cells,
partial credit, QTI import/export and hosted asset storage remain future work.
