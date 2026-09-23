---
name: pdf-to-quiz
description: Convert text-based or scanned exam PDFs into validated PrepDeck import JSON with source evidence, answer-key reconciliation and unresolved-question reports. Also compose reusable passages, tables, figures, code and choice/text/order/match interactions in versioned JSON imports.
---

# PDF to PrepDeck quiz

Produce a standalone PrepDeck import without relying on the repository. Preserve source wording and evidence; never invent answers, missing options, explanations or question text.

## Requirements

The scripts support CPython 3.12 through 3.14, and CI runs the validation suite on each. Version 2.0 validation requires `jsonschema`; extraction/figure assembly use `pymupdf`/`Pillow`. Optional Docling and OCR dependencies are described in the component reference. `scripts/validate_quiz.py` enforces the import contract itself rather than delegating to interpreter behaviour — `datetime.fromisoformat`, for one, began accepting the end-of-day form `24:00:00` in 3.14 — so the same file is accepted or rejected identically on every supported version, and offline validation agrees with what the Worker will do on import.

## Inputs

Infer or ask for the exam name/stable slug, content language, output path and source namespace when not supplied. Preserve existing question IDs when refining a previous import. Questions without source-backed answers remain in the review artifact; if all are unresolved, produce no import JSON.

## Workflow

1. Create a working directory outside the skill. Keep the original PDF with its evidence artifacts.
   Choose the legacy [1.0 format](references/import-format.md) for simple Markdown questions or the generic [2.0 component workflow](references/component-format.md) for shared passages, tables, figures, code and structured interactions. Keep document parsing profiles separate from question schemas. Use [provider examples](references/japanese-sg-layouts.md) only when the source matches; do not specialize core code for an exam. Read the component workflow before preparing a 2.0 inventory; its builder/review contract replaces steps 5–6 below for that version.
2. Read [references/evidence-format.md](references/evidence-format.md) for extraction commands, intermediate contracts, batching and exit codes. Run `scripts/extract_pdf.py` to produce page-delimited text, `document.json`, assets and a quality report. Inspect diagnostics and original pages. Partial extraction requires review; missing pages must be repaired or explicitly represented and reviewed. Do not mistake a successful text extraction for correct question interpretation.
3. Inspect the entire PDF and answer/explanation sections. Build the master inventory with every source question, stable `externalId`, section-qualified printed identifier and source order. Independently count questions and answer entries. Review each page, including blank/excluded pages, with a reason.
4. Fill the inventory in question-boundary batches. Include cross-page continuations and relevant answer-key pages. Reference the source blocks for each stem, option, accepted answer, official explanation and shared passage. Retain both native/OCR evidence when they disagree; consult the original visual before deciding. Explicitly account for unused blocks.
5. Read [references/import-format.md](references/import-format.md) before constructing question `data`. Reconcile answers by section-qualified source ID, not position. Preserve the source option-to-answer mapping when normalizing labels. Determine question type from the actual format: single/multiple choice, explicit true/false or fill-in-the-blank. A source instruction such as “choose two” must agree with the answer count; conflicts remain `review`.
6. Mark each inventoried question `ready`, `review` or `excluded`, retaining reasons/evidence for withheld items. Check completed batches with `scripts/build_quiz.py --allow-pending`; resolve all pending headers before export. Build the final import using that script's deterministic merge/export, then run `scripts/validate_quiz.py OUTPUT.json`. Fix errors and review warnings. A warning word appearing in authentic source text is not itself evidence of an invented answer.
7. Compare at least the first, last and five distributed emitted questions (all when fewer than seven) against the PDF, plus all extraction/answer/visual conflicts. Check complete stems/options, NOT/BEST/units/formulas, exact answer mapping and ordering. Record corrections in the inventory and rebuild.
8. Return the import file if any, review report and merged inventory, exported/withheld/excluded counts, extraction caveats and validator result. Keep document/assets available for provenance. Report an all-unresolved result explicitly.

## Fidelity rules

- Preserve meaningful line breaks, code, formulas, units, negation and selection counts. Join wrapped prose only when meaning is preserved; retain helpful Markdown.
- Preserve necessary figures as evidence. Export a faithful text description only when it suffices to answer the question; otherwise mark `review`. For 2.0, include reviewed raster crops as bounded package assets with meaningful alt text. In 1.0, image-dependent questions that cannot be faithfully expressed in text remain unresolved.
- Map explicit True/False options to IDs `true` and `false`. Omit `options` for `fill_blank`; accepted answers must appear in the source.
- Copy official explanations only; omit or use `null` when absent. Add difficulty/tags only from the source or explicit user instruction.
- Do not silently resolve conflicting answer entries or generate placeholder answers. Keep these in the review artifact.
- Do not claim completeness from schema validation alone. Source page review, inventory/answer counts and evidence checks must also be satisfied.
