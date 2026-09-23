# Presenting a study question

Use this workflow for any exam, including long case studies. A list/search stem
is a selection preview, not proof that the full question has been retrieved.

1. Select a question ID using practice, review or recommendation tools. Call
   `user_present_question({examId, id})` when discovery exposes it. It reads the
   full component snapshot, shared material and referenced images without
   grading keys, explanations or personal annotations. Reads do not record a
   study attempt or change the bank.
2. Read the metadata in `structuredContent.data` (also the first JSON text
   content block). Keep the question ID and revision for later grading. Render
   the subsequent text and image blocks in order; do not show the metadata JSON
   as the question. `figures[].imageContentIndex` locates the image in the tool's
   complete content array; repeated figures can reference the same image.
3. Check the material against the presentation rules below. Show all material,
   the prompt and options, then wait for the learner's answer. Keep original
   language and option IDs unless translation is requested; do not translate
   away source labels or blanks.
4. After the learner responds, fetch `user_get_question` for the answer and
   explanation. If its revision changed, reconcile the displayed question
   before grading. Do not prefetch annotations, highlights or notes which may
   reveal the answer. Do not add correct-answer emphasis or an annotated answer
   image before the response. If the stored material itself contains a visible
   answer marking, flag it for review instead of presenting it as a blind quiz.

## Preserve the source structure

| Material | Conversation output |
| --- | --- |
| Prose | Readable paragraphs with natural wrapping and meaningful paragraph boundaries. |
| Simple rectangular table | A real table retaining headers, every row/cell, blank cells, units and their relationships. Never a bullet-list summary. |
| Boxed form/figure, merged/complex table, flowchart or diagram | Retained original image/crop with number and caption. Preserve borders, grouping, arrows and notes. Do not generate a replacement diagram from guessed geometry. |
| Code/pseudocode | Fenced code preserving indentation, blanks and meaningful line breaks. |
| Shared material, prompt and options | Separate sections in source order, preserving numbering, option labels, source emphasis and combination member mappings. Never sort ordering items into the solution or pair matching options yourself. |
| Genuine list | A list with its original labels, including literal source omissions such as 「省略」. Never introduce new omissions to shorten a question. |

Use a client-supported table renderer for the returned Markdown. A multiline
cell uses `<br>`; if the client cannot render that, retain its text within the
same cell using a supported representation, not a shifted row or dropped cell.
Do not claim to have inspected the source PDF just because a stored asset exists.
`sourceLayoutVerified: false` means this tool has not made that verification.

## Missing material and client limitations

- `status: incomplete` means visual material or structured data is unavailable
  or invalid. Explain the specific warning and retrieve the source for review
  before asking for an answer or grading. Do not use the flattened projection
  to hide missing shared material, tables, options or figures.
- If the client cannot display MCP images, use `imageMode: "text-only"` and
  disclose that the figure was not shown. Descriptions are explicitly labeled
  as descriptions and are not equivalent to the original image. Provide an
  existing accessible source/question link when one is actually available;
  otherwise direct the learner to the material in PrepDeck. Never invent URLs,
  render raw base64 as prose, or claim an unresolved asset/local path is visible.
- Legacy records retain their original Markdown with
  `legacy_layout_unverified`. Existing tables/code can be displayed as stored;
  plain text cannot recover a lost table grid or boxed diagram. If missing
  structure affects answering, explain the limitation and inspect accessible
  source material rather than guessing cells, grouping or arrows.
- On an older deployment without `user_present_question`, use exposed detail
  tools to retrieve complete content/shared material/assets, retaining the
  same formatting rules and withholding answer fields from the learner. If
  the available tools cannot supply complete material, report that limitation.
- A presentation issue does not authorize data repair. Use a separately
  authorized admin workflow for bank changes and report a repair only after
  it succeeds.
