# Subject B case schema

Select `ja-sg-subject-b` for SG 科目B, for either text collections or scanned
textbooks. The [case schema](subject-b-case.schema.json) extends the local
evidence inventory with `caseSchemaVersion: "1.0"`, `cases`, and each question's
`caseId` / `subquestionId`. The application still receives standard import 1.0.
REST/MCP schema discovery includes this definition under
`caseSchemas["ja-sg-subject-b"]`; the import dialog lists this profile too.

## Prepare

Reuse the document extracted with either existing layout. Native year/subject
headings select B sections automatically. For scanned documents, use the
[page plan](ja-sg-textbook-sections.json): B question and explanation ranges are
marked `subject: "B"`. A custom plan can set `sourceLayout` to
`ja-sg-interleaved` or `ja-sg-textbook-ocr`; otherwise extraction metadata or
native headings determine the source layout. No B section is an error, not an
empty successful conversion. Other sections remain in the source document and
still need page/block review or explicit exclusion before final export.

```bash
python3 <skill-dir>/scripts/prepare_layout.py WORK/source.document.json \
  --layout ja-sg-subject-b --namespace te2-sg-2025 \
  --exam-id ipa-sg --exam-name '情報セキュリティマネジメント' \
  -o WORK/subject-b.inventory.json
```

For the scanned textbook add `--sections WORK/sections.json`. When extracting
afresh, `extract_pdf.py --layout ja-sg-subject-b` uses missing-text Japanese OCR
and boxed-header processing. The OCR helper also reads the left question label
of wide B header bars and boxed `設問` labels. It never guesses a missing number.

The helper splits case background before `設問` from its prompt. Distinct numbered
`設問1`, `設問2` headings become leaf questions sharing the case. The standalone
kana-label layout of row-major option tables is supported. Explicit variable
headers such as `a1`, `a2` and complete rectangular rows become `optionTable`.
Arbitrary multi-column OCR grids, merged cells and unclear nested `(1)/(2)`
boundaries still need manual transcription and leaf-question inventory.

## Case materials and child questions

Each case has a stable material/section/printed-number `id`, scoped
`sourceQuestionId`, `expectedSubquestions`, `reviewed`, and ordered `materials`.
Material kinds are:

- `text`: source `text` and nonempty `blockRefs`.
- `table`: `caption`, `columns`, rectangular `rows` and `blockRefs`. Keep blank
  cells as empty strings. Transcribe spanning cells explicitly; do not infer
  missing cells or flatten row/column relationships into unlabelled numbers.
- `figure`: `description`, `textSufficient` and image `blockRefs`. A necessary
  image with no sufficient text equivalent blocks every ready question using it.

For example, an element of `cases` can be:

```json
{
  "id": "book:mock-b:q49",
  "sourceQuestionId": "mock-b / 49",
  "expectedSubquestions": 2,
  "reviewed": false,
  "materials": [
    { "id": "background", "kind": "text", "text": "A社の共通事例。", "blockRefs": ["p1-b1"] },
    { "id": "table-1", "kind": "table", "caption": "表1", "columns": ["項目", "値"],
      "rows": [["a1", "0"], ["a2", "1"]], "blockRefs": ["p2-b1"] }
  ]
}
```

Its two question rows use the same `caseId`, distinct `subquestionId` values
`"1"` / `"2"`, and source IDs `mock-b / 49 / 1` / `mock-b / 49 / 2`.
Their existing `data.stem` holds only the prompt. Other `data`, `sources`,
`status`, `order`, and answer-entry fields follow the evidence inventory.
For a single-question case, the original external/source IDs are retained to
avoid duplicate imports when switching from the generic converter.

An optional question `optionTable` contains `columns`, header `blockRefs`, and
`rows` with `{id, values, blockRefs}`. Use it instead of `data.options`. Each
row becomes one option with its original ID and labeled column values. An
option selecting multiple actions or values remains `single_choice` when the
answer selects one kana label. No new grading type is introduced.

## Review and compile

Draft cases have `reviewed: false`; draft questions stay `review`. Review every
shared passage/table and all necessary images, then set the case's `reviewed`
flag and each verified child's status. Splitting a parent does **not** copy its
answer to its children: match each leaf to its own answer entry and evidence.
An unmatched case-level key remains in the review report. Preserve unknown or
conflicting keys; do not replace 工 with エ without checking the page.

`expectedSubquestions` must match the child inventory, including withheld
children. B section `sourceExpectations` use `unit: "cases"`, so splitting a
case does not change an independently counted source case total.

```bash
python3 <skill-dir>/scripts/build_quiz.py WORK/source.document.json WORK/subject-b.inventory.json \
  --output WORK/subject-b.import.json
python3 <skill-dir>/scripts/validate_quiz.py WORK/subject-b.import.json
```

The builder copies all shared materials into every child's stem. Tables render
as numbered rows of labeled cells using the existing question renderer's
headings/lists; it does not support GFM table grids. Option tables similarly
render as labeled values. Material references join the child's passage
evidence, so excluded/unreviewed pages cannot enter a ready question. Missing
children, malformed tables, unknown references and insufficient figures fail
the build. The expanded stem/option lengths must fit existing import limits;
oversized cases are rejected without truncation.

Only the compiled `subject-b.import.json` goes to Web UI or Admin MCP preview /
execute. The structured case inventory stays local for review and reproducible
re-export; compiling does not modify it or duplicate the shared material on a
second export. This schema preserves structure but does not certify OCR text
or provide managed question-image uploads.
