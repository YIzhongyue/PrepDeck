# Japanese SG provider profile example

Both inspected source books contain 科目A and 科目B. They use the same generic
[component format and pipeline](component-format.md) as other exams. The optional
[Japanese profile file](profiles/japanese-sg.json) supplies regexes, language and
OCR settings only; there is no SG-specific schema, compiler or server catalog.
Use an existing exam ID when available, language `ja`, and separate stable
material/edition namespaces. Preserve kana labels and section-qualified IDs.

## Native collection

The inspected 551-page `layout1.pdf` contains 258 question/answer pairs:
234 科目A and 24 科目B. Native text is primary. Answers follow questions and
explanations can continue across pages. The profile hashes normalized headings
to distinguish repeated question numbers, including dated sample-paper sections.

```bash
python scripts/extract_pdf.py layout1.pdf \
  --profiles references/profiles/japanese-sg.json --layout ja-sg-interleaved \
  --ocr-cache WORK/cache -o WORK/source.txt
python scripts/prepare_components.py WORK/source.document.json \
  --profiles references/profiles/japanese-sg.json --layout ja-sg-interleaved \
  --namespace native-edition --exam-id ipa-sg --exam-name SG --language ja \
  -o WORK/inventory.json
```

The draft needs visual review even if its schema passes: native extraction can
flatten table options into plausible but incomplete strings. A combination such
as `ア = (一), (三)` remains one choice. A blank with an answer group is a choice
interaction, not a free-text response. Use component tables/figures/references.

## Scanned textbook

The inspected 575-page `layout2.pdf` mixes chapter examples, mock/sample papers,
answer tables and explanations. Each paper has 48 A and 12 B questions. Copy and
verify the edition-specific [section plan](ja-sg-textbook-sections.json) against
physical pages, not printed folios. Chapter examples are reference ranges in
that plan; they need separate scopes before preparing them as questions.

```bash
python scripts/extract_pdf.py layout2.pdf \
  --profiles references/profiles/japanese-sg.json --layout ja-sg-textbook-ocr \
  --ocr-cache WORK/cache --workers 4 -o WORK/source.txt
python scripts/prepare_components.py WORK/source.document.json \
  --profiles references/profiles/japanese-sg.json --layout ja-sg-textbook-ocr \
  --sections WORK/sections.json --namespace scanned-edition \
  --exam-id ipa-sg --exam-name SG --language ja -o WORK/inventory.json
```

Install Tesseract `jpn` language data; boxed-label OCR additionally needs OpenCV.
Dark labels, kana (e.g. カ versus 力), sidebars and answer grids require inspection.
The local test found 111/120 paper questions and 99 answer entries after a selected
240-DPI refinement. This is an incomplete draft, not an importable full book.
Repair missing headers or inventory unreadable questions as unresolved, retaining
expected counts. Never infer missing question numbers or answer labels by position.
Reconcile answer tables and explanation headers independently.

Review and export with `build_components.py`; use `build_quiz.py` only for legacy
1.0 inventories. Original pages, OCR variants and copyrighted source content stay
local; only profiles, synthetic regression cases and validation results ship.
