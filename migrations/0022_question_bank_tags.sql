-- implementation — admin-managed question-bank taxonomy catalog. Deliberately
-- separate from knowledge_point_tags (0014, implementation's per-user tags): this
-- table is admin-global and gives a stable id to a tag name that survives a
-- rename, but the identity is name-addressed at the tool boundary (see
-- lib/questionBankTags.ts) — rows are registered lazily, not backfilled from
-- existing questions.tags_json usage.
CREATE TABLE question_bank_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_question_bank_tags_name ON question_bank_tags(name COLLATE NOCASE);
