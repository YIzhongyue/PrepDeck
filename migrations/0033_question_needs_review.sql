-- issue #15 — promote "this imported question still needs a human look" from a
-- question-bank TAG to a first-class column on `questions`.
--
-- question_bank_tags (0022/0026) is descriptive/classification metadata that
-- admins curate and that learners filter Practice by; review state is workflow
-- state the system itself writes at import time. Keeping the latter in the tag
-- catalog meant every tag listing, merge, rename and Practice-domain picker had
-- to know about one magic name, and there was no way to filter on the state
-- without a join through the catalog. A column says exactly what it means.

ALTER TABLE questions ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;

-- Filtering is always "the questions in THIS exam that still need review"
-- (routes/questions.ts's ?needsReview=, admin_search_questions), so the exam
-- leads the index exactly like idx_questions_exam_external (0015) does.
CREATE INDEX idx_questions_exam_needs_review ON questions(exam_id, needs_review);

-- Backfill from the legacy tag. Matched on question_bank_tags.normalized_name
-- (0026's identity column, already lower-cased/whitespace-collapsed by that
-- migration), so any casing the tag was created with — "Needs Review",
-- "needs_review", "#Needs   Review" — resolves to one of the three spellings
-- below. The catalog was only ever name-addressed, so there is no id to match
-- on; nothing in the shipped code ever created this tag, which is precisely why
-- the state was invisible to every query. A deployment that never used it
-- backfills zero rows and the DELETEs below are no-ops.
UPDATE questions SET needs_review = 1
WHERE id IN (
  SELECT l.question_id FROM question_tag_links l
  JOIN question_bank_tags t ON t.id = l.tag_id
  WHERE t.normalized_name IN ('needs_review', 'needs review', 'needs-review')
);

-- Retire the tag itself, links first. Dropping the catalog row after the state
-- is preserved in the column above is what stops a later import/merge/rename
-- from resurrecting a second, now-meaningless source of truth.
DELETE FROM question_tag_links
WHERE tag_id IN (SELECT id FROM question_bank_tags WHERE normalized_name IN ('needs_review', 'needs review', 'needs-review'));

DELETE FROM question_bank_tags WHERE normalized_name IN ('needs_review', 'needs review', 'needs-review');
