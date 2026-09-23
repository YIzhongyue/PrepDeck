# Component questions and document import

[Documentation index](../README.md) · [Issue #16](https://github.com/YIzhongyue/PrepDeck/issues/16)

PrepDeck now represents long questions with reusable content blocks, shared
stimuli, one independently graded interaction per item, and separate scoring.
The executable [2.0 schema](../../skills/pdf-to-quiz/references/component-import.schema.json)
owns the contract; the [converter reference](../../skills/pdf-to-quiz/references/component-format.md)
owns commands, examples, limits and review gates. Existing 1.0 imports remain valid.

## Boundaries

```mermaid
flowchart LR
  PDF[Native or scanned PDF] --> E[Evidence document: text, table, image, page, bbox]
  E --> P[Profile and reviewed segmentation]
  P --> H[Text / table / figure component handlers]
  H --> J[Validated 2.0 package]
  J --> I[REST or Admin MCP preview and import]
  I --> D[Question content snapshot plus separate answer key]
  D --> U[Practice, Learning, Mock and editor]
  D --> X[Portable component export]
```

These are three implemented layers, not a schema per exam or per book:

1. Content blocks and response/scoring contracts. Synthetic reading, programming,
   visual case and operation-combination fixtures exercise different domains.
2. Persistence, revision/conflict handling, portable inline assets, rendering,
   structured editing, attempts/grading and export. Shared stimulus IDs/revisions
   are resolved into immutable per-question snapshots; editing one item does not
   silently update other items. Export rejects conflicting snapshots with the
   same ID, and requires an explicit external ID on every exported question so
   re-import can match the original row. The practice catalog carries text
   projections and a content-presence flag; full snapshots and inline assets
   load only for the opened question. Catalog caching stays independent of the
   combined asset size of the bank. A revision mismatch between the catalog and
   opened content asks for an exam refresh before answering; a failed content
   fetch leaves navigation and the Mock timer/submission controls available.
3. Native/OCR evidence extraction, external provider profiles, optional Docling
   layout extraction, reviewed segmentation and reusable assembly handlers. The
   application/MCP catalog advertises content capabilities, not provider names.

[QTI 3](https://www.imsglobal.org/spec/qti/v3p0/impl) informed the separation of
stimulus, interaction and response processing. This is **not** QTI compliance or
QTI XML interoperability. [Docling](https://docling-project.github.io/docling/)
is an optional document parser, not an answer detector or grading engine.
Only exact scoring is implemented. A shared case with independent subquestions
is several items, while an answer selecting an operation combination is one item.

## Current-material verification

The following local check used the two supplied PDFs on 2026-09-22. Source books,
full extracted text, crops and reviewed imports remain under ignored `tmp/`;
committed fixtures and screenshots contain synthetic content only. These results
verify representative end-to-end behavior and expose extraction limits; they do
not certify an automatically converted full question bank.

| Check | Native collection (`layout1.pdf`) | Scanned textbook (`layout2.pdf`) |
| --- | --- | --- |
| Complete page extraction | 551 pages, one blank/failed page to review | 575 pages, one blank/failed page to review |
| Original draft question inventory | 258 items / 258 answer entries (234 A, 24 B) | 111 / 120 expected paper questions; 99 answer candidates, only 32 nonempty entries and 29 linked nonempty keys |
| Draft structural validation | 0 structural issues; all still require source review | 20 reported issues (capped), missing questions/answers; full-book export blocked |
| Refined scan scope | Native text | 138 selected question/answer pages at 240 DPI; original OCR retained |
| Docling evaluation only | Pages 493–495, 516: 67 text, 3 table, 10 picture blocks; 15.64 s | Pages 443–445, 489: 96 text, 4 table, 2 picture blocks; 34.83 s |
| Reviewed B sample | Q13, physical pages 492–493: two typed tables, nine combination options, key ク | Mock Q49, physical pages 443–444 + key 489: two retained source crops, six options, visually verified key カ |
| Source-gated export | 1 item; 2/551 pages reviewed; `completeBookReview: false` | 1 item; 3/575 pages reviewed; `completeBookReview: false` |
| Local API round trip | REST preview → SQLite/D1-compatible import → export → repeat import skips → correct server grading; MCP preview/execute/replay/export | Same; image bytes and stimulus content unchanged |

Docling 2.129.0 ran locally on CPU with two threads and Tesseract; durations are
single warm-environment observations, not a general benchmark. It recovered
structured tables useful to the native sample, while scan OCR still confused
カ with 力 and other characters. Prefer native extraction where usable; use the
structured adapter for difficult layouts, then review source pixels. The scan's
chapter examples are reference scopes and are not included in its 120-paper-item
expectation. Missing exam candidates must be repaired or explicitly inventoried
as unresolved; never lower expected counts to approve the OCR survivors.

### Recovery and independent source comparison

The follow-up fix reconciles explicit answer conclusions and retained OCR passes,
preserves stronger earlier evidence when refinement regresses, normalizes answer
glyphs on dark bars and optionally checks consecutive answer-header boundaries.
It distinguishes candidate records, readable keys, linked keys, conflicts and
reviewed questions. Existing native/structured block spans are preserved instead
of attaching every block on a page to each question. Structured tables with an
unambiguous text span and explicit header cells dispatch to the table handler;
uncertain figures/tables produce source-located review candidates.

The scan was reprocessed on 57 answer pages (469–498 and 537–563) at 240 DPI,
using the same complete extraction and original 120-question expectations:

| Measurement | Before recovery | After recovery |
| --- | --- | --- |
| Detected source questions | 111 / 120 | 111 / 120 |
| Nonempty linked keys, before independent table comparison | 29 | 59 |
| B keys: mock / sample | 0 / 12 and 0 / 12 | 10 / 12 and 12 / 12 |
| Answer candidates / readable entries | 99 / 32 | 104 / 81 |
| Conflicting scoped answer readings | Not separately reported | 6 |
| Uncertain numbered answer regions | Not separately reported | 15 |
| Questions with fewer than two options | 23 | 23; explicitly listed for repair |
| Whole-bank source approval | None | None; full export still blocked |

All 59 candidate keys were compared with an independently transcribed source
answer table (physical pages 468 and 536). **Two original-source disagreements**
remained: mock A Q46 (table page 468 versus explanation page 488) and sample A
Q16 (table page 536 versus explanation page 542). Both were checked visually;
the discrepancy is present in the PDF. The new `--answer-reference` comparison
retains both sources and withholds these keys, leaving **57 nonempty keys**.
It does not fill missing answers from the transcription or decide which original
source is correct. All 22 recovered B keys agree with the original answer tables;
mock B Q51 and Q57 still need repair. These key checks do not certify question
text, figures or options: 20 detected items still have candidate keys whose option
labels were not completely recovered. All source questions remain pending review.

The native document remains 258/258 candidate pairs, with no answer conflicts.
Neither original plain-text full-book extraction gains typed tables merely by
changing its schema. On the previously retained structured-backend evidence,
the planner assembled all three native table blocks and two of four scan table
blocks; two scan tables remained review candidates because their header structure
was insufficient. This is component-level validation on those seven blocks,
not automatic reconstruction of the full books or their question boundaries.

Both existing reviewed B samples still pass source-gated export and actual local
REST/MCP round trips. New synthetic regressions cover cross-pass conflicts,
unreadable counts, explicit conclusions, uncertain boundaries, independent source
disagreement, exact table assembly and evidence coordinates. The standalone
source-review browser test checks desktop/mobile layouts, retained page images,
unsafe text, filters, invalid corrections, downloads and shared-material review
invalidation. The reviewer downloads an unapproved inventory; no source upload
or automatic bank write is added. See the [source-review screenshots](../screenshots/component-questions.md#local-pdf-source-review).

Local recovery artifacts are `tmp/component-validation/{native,scanned}/fixed.inventory.json`,
`scanned/crosschecked.inventory.json` and each directory's `review.html`. The
independent source transcription and all source images stay in ignored `tmp/`.

Reproduce reviewed local API verification (only when the local imports exist):

```bash
COMPONENT_SOURCE_FILES=/absolute/native/reviewed.json,/absolute/scanned/reviewed.json \
  node --test apps/worker/scripts/question-authoring.test.mjs
COMPONENT_SOURCE_FILES=/absolute/native/reviewed.json,/absolute/scanned/reviewed.json \
  node --test --test-name-pattern="component " apps/worker/scripts/mcp-foundation.test.mjs
```

The same test always runs the four committed synthetic fixtures without this
environment variable. MCP tests additionally cover preview/execute/replay/export;
browser tests cover actual provider state, restored ordering/matching drafts,
image/table/code rendering, component import preview/edit/export and mobile UI.
See [synthetic screenshots](../screenshots/component-questions.md).

## Limits and follow-up

Inline raster assets make a bounded portable first implementation; large banks
need batches. Source PDFs are not uploaded or parsed by the Worker. A future
object-storage asset protocol can replace inline transport without changing the
logical block reference model. Merged table cells, nested/composite interactions,
partial credit, QTI interchange, annotations on complex component blocks and
graphical block editing are not implemented. Legacy stem/option annotations
remain usable after export and re-import when their single Markdown block still
matches the original source. The current JSON editor exposes the complete model.
AI explanations/search/email continue to use text projections, so figure-only
content may require a textual description for those consumers; the question UI
and component-aware MCP records retain the image. No production migration or
production import was performed during this verification.
