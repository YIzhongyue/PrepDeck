-- issue #15 — promote "this imported question still needs a human look" from a
-- question-bank TAG to a first-class column on `questions`.
--
-- question_bank_tags (0022/0026) is descriptive/classification metadata that
-- admins curate and that learners filter Practice by; review state is workflow
-- state the system itself writes at import time. Keeping the latter in the tag
-- catalog meant every tag listing, merge, rename and Practice-domain picker had
-- to know about one magic name, and there was no way to filter on the state
-- without a join through the catalog. A column says exactly what it means.
--
-- Moving the state is only half the job: `questions` also carries two frozen
-- snapshots of what each row looked like at its last import commit
-- (import_baseline_json, and its id-based sibling import_baseline_tag_ids_json
-- from 0027). lib/importConflicts.ts compares a row against those snapshots to
-- decide whether a re-import reports `incoming_changes` or the far more
-- disruptive `locally_edited`. Rewriting the row's representation without
-- rewriting the snapshots would make EVERY previously-imported, review-tagged
-- question look locally edited on its next import — a conflict an administrator
-- has to resolve by hand, manufactured by this migration rather than by anyone's
-- edit. So the snapshots are translated here too, in the same transaction.

ALTER TABLE questions ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;

-- Filtering is always "the questions in THIS exam that still need review"
-- (routes/questions.ts's ?needsReview=, admin_search_questions), so the exam
-- leads the index exactly like idx_questions_exam_external (0015) does.
CREATE INDEX idx_questions_exam_needs_review ON questions(exam_id, needs_review);

-- Catalog identity of the legacy tag, captured BEFORE the deletes at the
-- bottom so the baseline translation below can still recognize it. Matched on
-- question_bank_tags.normalized_name (0026's identity column, already
-- lower-cased/whitespace-collapsed by that migration), so any casing the tag
-- was created with — "Needs Review", "needs_review", "#Needs   Review" —
-- resolves to one of the three spellings below. Deliberately a plain
-- (non-TEMP) table: D1's remote engine rejects CREATE TEMP TABLE outright
-- (see 0026's header for the full reasoning); it is dropped before this file
-- ends, like the scratch tables there.
CREATE TABLE _legacy_review_tags AS
  SELECT id FROM question_bank_tags
  WHERE normalized_name IN ('needs_review', 'needs review', 'needs-review');

-- The live state, from the links as they stand right now.
UPDATE questions SET needs_review = 1
WHERE id IN (SELECT l.question_id FROM question_tag_links l JOIN _legacy_review_tags g ON g.id = l.tag_id);

-- Every distinct tag SPELLING that appears inside an import baseline's `tags`
-- array, reduced to the ones that are the legacy tag. Baselines predating 0027
-- have no id snapshot at all, so their only record of the tag is this display
-- name — which means the same normalization pipeline 0026 defined has to be
-- applied here rather than a bare lower(trim()) (see that migration's header
-- for why the two are not the same identity). Computed once, into a table, so
-- the two UPDATEs below share one answer instead of re-deriving it.
CREATE TABLE _baseline_tag_raw AS
  SELECT DISTINCT je.value AS raw
  FROM questions, json_each(COALESCE(json_extract(questions.import_baseline_json, '$.tags'), '[]')) je;

CREATE TABLE _baseline_legacy_tag_names AS
SELECT raw FROM _baseline_tag_raw
WHERE lower(
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    CASE
      WHEN substr(trim(replace(replace(replace(raw, char(9), ' '), char(10), ' '), char(13), ' ')), 1, 1) = '#'
        THEN trim(substr(trim(replace(replace(replace(raw, char(9), ' '), char(10), ' '), char(13), ' ')), 2))
      ELSE trim(replace(replace(replace(raw, char(9), ' '), char(10), ' '), char(13), ' '))
    END,
  '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')
) IN ('needs_review', 'needs review', 'needs-review');

-- Translate each import baseline into the new representation, exactly as the
-- application would have written it had the column always existed:
--
--   * `$.needsReview` records whether the baseline itself carried the tag —
--     NOT whether the row carries it now. That distinction is the whole point:
--     a question imported clean and tagged for review afterwards is a genuine
--     local edit and must keep reporting as one, while a question that arrived
--     tagged is unchanged and must not.
--   * `$.tags` and the id snapshot drop the retired tag, so they describe the
--     same link set the row now actually has.
--
-- The id snapshot is the authority when it exists (it survives a catalog
-- rename, which is why 0027 introduced it); a pre-0027 baseline falls back to
-- the display names collected above. All right-hand sides see the row's
-- pre-UPDATE values, so the two SET clauses cannot observe each other.
UPDATE questions SET
  import_baseline_json = json_set(
    json_set(
      import_baseline_json,
      '$.tags',
      json((SELECT json_group_array(je.value)
            FROM json_each(COALESCE(json_extract(questions.import_baseline_json, '$.tags'), '[]')) je
            WHERE je.value NOT IN (SELECT raw FROM _baseline_legacy_tag_names)))),
    '$.needsReview',
    json(CASE
      WHEN questions.import_baseline_tag_ids_json IS NOT NULL THEN
        CASE WHEN EXISTS (SELECT 1 FROM json_each(questions.import_baseline_tag_ids_json) je
                          WHERE je.value IN (SELECT id FROM _legacy_review_tags))
          THEN 'true' ELSE 'false' END
      ELSE
        CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(questions.import_baseline_json, '$.tags'), '[]')) je
                          WHERE je.value IN (SELECT raw FROM _baseline_legacy_tag_names))
          THEN 'true' ELSE 'false' END
    END)),
  import_baseline_tag_ids_json = CASE WHEN import_baseline_tag_ids_json IS NULL THEN NULL ELSE
    (SELECT json_group_array(je.value) FROM json_each(questions.import_baseline_tag_ids_json) je
     WHERE je.value NOT IN (SELECT id FROM _legacy_review_tags)) END
WHERE import_baseline_json IS NOT NULL;

-- Retire the tag itself, links first. Dropping the catalog row once the state
-- is preserved in the column and the baselines above is what stops a later
-- import/merge/rename from resurrecting a second source of truth.
DELETE FROM question_tag_links WHERE tag_id IN (SELECT id FROM _legacy_review_tags);
DELETE FROM question_bank_tags WHERE id IN (SELECT id FROM _legacy_review_tags);

DROP TABLE _baseline_legacy_tag_names;
DROP TABLE _baseline_tag_raw;
DROP TABLE _legacy_review_tags;
