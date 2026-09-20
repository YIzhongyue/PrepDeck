-- Support Exam management (FR-2.1): free-text description, and soft-archive
-- (archived_at set instead of deleting, so historical attempts/questions survive).
-- Applied via: wrangler d1 migrations apply <DB_NAME>

ALTER TABLE exams ADD COLUMN description TEXT;
ALTER TABLE exams ADD COLUMN archived_at TEXT;
