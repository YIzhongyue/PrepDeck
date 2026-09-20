-- implementation — canonical question-bank tag catalog + ID-based associations,
-- replacing questions.tags_json (name array, per-question) as the source of
-- truth. question_bank_tags (0022) gains a normalized_name identity column
-- and an optimistic-concurrency revision counter; question_tag_links is the
-- new many-to-many join table, modeled directly on
-- knowledge_point_tag_links (0014) — same composite PK, same reverse index
-- shape, deliberately still a separate table (question-bank tags stay
-- admin-global; Knowledge Point tags stay per-user private).
--
-- This migration only ADDS structure and backfills it from the still-live
-- tags_json column; 0027 removes that column once every reader/writer has
-- switched to the tables introduced here (see that migration's header).

ALTER TABLE question_bank_tags ADD COLUMN normalized_name TEXT;
ALTER TABLE question_bank_tags ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

-- #107 review — a bare `lower(trim(x))` here is NOT the same identity
-- lib/questionBankTags.ts's normalizeTagName()+normalizeTagKey() compute at
-- runtime (trim, strip exactly one leading '#', collapse internal
-- whitespace runs to one space, THEN lower-case): a legacy tags_json value
-- like "#AWS" or "aws   security" would otherwise migrate to a DIFFERENT
-- catalog identity than the one every post-migration read/write path
-- resolves it to. `_tag_normalized` below computes the exact same pipeline
-- in SQL, once, so every step after it (catalog backfill, link backfill)
-- references the identical key instead of re-deriving it and risking drift.
--
-- Whitespace collapsing has no SQL/regex primitive, so it's done via
-- bounded `replace('  ', ' ')` passes: each pass at most halves (ceiling)
-- the length of any run of spaces, so 10 passes fully converges any run up
-- to well beyond MAX_TAG_NAME_LENGTH (200) — tabs/newlines/CR are folded to
-- a plain space first so a run mixing them collapses the same way.
--
-- #108 follow-up review — this only covers ASCII whitespace (space/tab/
-- LF/CR); SQL has no practical way to enumerate the rest of JS `\s`'s
-- Unicode whitespace set (NBSP U+00A0, U+3000, etc.) the way a regex can.
-- Rather than leave that a silent gap, normalizeTagName() in
-- questionBankTags.ts was narrowed to match exactly this ASCII-only domain
-- — any other Unicode whitespace character is now left untouched (an
-- ordinary character, not folded/trimmed) by BOTH sides, so this migration
-- and the live application always compute the same identity for any given
-- input.
-- Deliberately a plain (non-TEMP) table: Cloudflare D1's remote engine
-- rejects CREATE TEMP TABLE/VIEW outright with "not authorized:
-- SQLITE_AUTH" (confirmed against remote D1; this migration passed every
-- local test against node:sqlite, which has no such restriction, so the
-- failure only ever surfaced on an actual `wrangler d1 migrations apply
-- --remote` run — see cloudflare/workers-sdk#4298, closed as a permanent
-- "not planned" limitation). Ordinary tables work identically here since
-- both are created and dropped within this same migration file; nothing
-- else in the schema ever references them.
CREATE TABLE _tag_raw_values AS
  SELECT name AS raw FROM question_bank_tags
  UNION
  SELECT je.value AS raw FROM questions, json_each(questions.tags_json) je WHERE trim(je.value) <> '';

CREATE TABLE _tag_normalized AS
SELECT
  raw,
  -- Case-preserved, hash-stripped, whitespace-collapsed spelling — used as
  -- a display-name candidate for a newly-backfilled catalog row so a
  -- leading '#' or doubled space never leaks into what gets shown.
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    CASE
      WHEN substr(trim(replace(replace(replace(raw, char(9), ' '), char(10), ' '), char(13), ' ')), 1, 1) = '#'
        THEN trim(substr(trim(replace(replace(replace(raw, char(9), ' '), char(10), ' '), char(13), ' ')), 2))
      ELSE trim(replace(replace(replace(raw, char(9), ' '), char(10), ' '), char(13), ' '))
    END,
  '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ') AS normalized_display
FROM _tag_raw_values;

ALTER TABLE _tag_normalized ADD COLUMN normalized_key TEXT;
UPDATE _tag_normalized SET normalized_key = lower(normalized_display);

-- Backfill every existing catalog row's identity via the shared table above.
UPDATE question_bank_tags
SET normalized_name = (SELECT n.normalized_key FROM _tag_normalized n WHERE n.raw = question_bank_tags.name)
WHERE normalized_name IS NULL;

-- Defensive collision resolution: every existing catalog row was already
-- registered through normalizeTagName (admin_create_tag/rename/merge run
-- input through it before ever building a catalog statement — see #65's
-- questionBankTags.ts), so correcting the normalization above is expected
-- to be a no-op for them in practice. This guards the CREATE UNIQUE INDEX
-- below regardless: if two pre-existing rows do collide once corrected,
-- keep the lexicographically-first id as the survivor and drop the rest —
-- nothing yet references a catalog row by id (question_tag_links doesn't
-- exist until below, and the tags_json backfill matches by normalized name,
-- not old catalog id), so this can't orphan a link.
DELETE FROM question_bank_tags
WHERE id NOT IN (SELECT MIN(id) FROM question_bank_tags GROUP BY normalized_name);

DROP INDEX idx_question_bank_tags_name;
CREATE UNIQUE INDEX idx_question_bank_tags_normalized_name ON question_bank_tags(normalized_name);

CREATE TABLE question_tag_links (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES question_bank_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);
CREATE INDEX idx_question_tag_links_tag ON question_tag_links(tag_id, question_id);

-- Backfill: register a catalog row for every distinct normalized tag
-- identity still only living in tags_json (the #65 catalog was registered
-- lazily — see 0022's header — so plenty of question tags have never been
-- registered at all), preserving every catalog id already assigned. The
-- display name picked for a brand-new row is the lexicographically-first
-- cleaned (hash-stripped/whitespace-collapsed, case-preserved) spelling
-- seen for that identity — deterministic, and never surfaces a raw leading
-- '#' or doubled space even though the identity match is case-insensitive.
INSERT INTO question_bank_tags (id, name, normalized_name, revision, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),
  (SELECT MIN(n2.normalized_display) FROM _tag_normalized n2 WHERE n2.normalized_key = grouped.normalized_key),
  grouped.normalized_key, 1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (SELECT DISTINCT normalized_key FROM _tag_normalized WHERE normalized_key <> '') grouped
WHERE NOT EXISTS (SELECT 1 FROM question_bank_tags t WHERE t.normalized_name = grouped.normalized_key);

-- Backfill: link every question to the (now guaranteed-to-exist) catalog
-- row for each of its tags_json entries, matched by the same shared
-- normalized identity — a question naming the same tag twice with
-- different casing/spacing/a leading '#' collapses onto the one catalog
-- identity (the join table has no room for a duplicate), which is the same
-- "one identity per normalized name" rule the live application enforces.
INSERT OR IGNORE INTO question_tag_links (question_id, tag_id)
SELECT DISTINCT q.id, t.id
FROM questions q, json_each(q.tags_json) je
JOIN _tag_normalized n ON n.raw = je.value
JOIN question_bank_tags t ON t.normalized_name = n.normalized_key
WHERE n.normalized_key <> '';

DROP TABLE _tag_normalized;
DROP TABLE _tag_raw_values;
