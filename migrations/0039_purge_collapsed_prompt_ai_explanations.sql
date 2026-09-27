-- Review of #69 — the AI explanation prompt collapsed every run of whitespace
-- in matching and ordering option text to a single space. Code is valid option
-- content, so two snippets that differ only in line breaks or indentation (an
-- unconditional `stop()` and one inside an `if`) reached the model as the same
-- text, and the learner's answer and the correct one could read identically.
-- Those results sit in the shared ai_explanations cache and are served to
-- every learner.
--
-- The prompt now keeps whitespace and fences code (packages/shared/src/
-- answerFormat.ts, promptOptionText). Remove cached results for the matching
-- and ordering questions whose content has a line break or a code block, the
-- only ones the collapse could change, so the next request regenerates them.
-- content_json is compact JSON, so a line break in any text appears as the two
-- characters \n. Other explanations are kept.
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

DELETE FROM ai_explanations
WHERE question_id IN (
  SELECT id FROM questions
  WHERE type IN ('matching', 'ordering')
    AND content_json IS NOT NULL
    AND (instr(content_json, '\n') > 0 OR instr(content_json, '"type":"code"') > 0)
);
