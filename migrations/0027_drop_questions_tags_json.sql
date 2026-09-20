-- implementation (part 2) — every question-tag reader/writer now goes through
-- question_bank_tags/question_tag_links (backfilled by 0026); tags_json is
-- no longer live storage anywhere in the application, so this drops it
-- rather than keeping a permanent dual-write/legacy-compat column.
--
-- Also adds import_baseline_tag_ids_json: a *separate* baseline snapshot,
-- alongside the existing import_baseline_json, of the sorted catalog tag
-- ids a question was linked to at its last import commit. A pure catalog
-- rename changes a tag's display name but never its id or any question's
-- links, so comparing baselines by id (lib/importConflicts.ts) — instead of
-- by the display-name array embedded in import_baseline_json — is what lets
-- a rename avoid manufacturing a false "locally_edited" conflict on every
-- question that happens to carry the renamed tag.
ALTER TABLE questions ADD COLUMN import_baseline_tag_ids_json TEXT;
ALTER TABLE questions DROP COLUMN tags_json;
