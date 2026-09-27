-- Review of #69 — the AI explanation prompt collapsed every run of whitespace
-- in matching and ordering option text to a single space. Code is valid option
-- content, so two snippets that differ only in line breaks or indentation (an
-- unconditional `stop()` and one inside an `if`) reached the model as the same
-- text, and the learner's answer and the correct one could read identically.
-- Those results sit in the shared ai_explanations cache and are served to
-- every learner.
--
-- The prompt now keeps whitespace and fences code (packages/shared/src/
-- answerFormat.ts, promptOptionText). Remove the cached results for every
-- matching and ordering question so the next request regenerates them.
--
-- All of them, not only those whose content_json looks multi-line: the
-- collapse also merged whitespace that is not in the stored JSON (an option of
-- two paragraphs is joined with a blank line only when it is formatted) or is
-- easy to miss in it (tabs, runs of spaces), and a narrower filter kept
-- explanations the new prompt would change. Choice and fill-in explanations
-- are unaffected and kept.
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

DELETE FROM ai_explanations
WHERE question_id IN (SELECT id FROM questions WHERE type IN ('matching', 'ordering'));
