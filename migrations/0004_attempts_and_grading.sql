-- Support Practice Mode (3.3) and Mock Exam Mode (3.4).
-- question_ids_json/time_limit_seconds fix the exact chosen question set,
-- order, and (for mock) the server-authoritative time limit at attempt
-- creation. draft_answers_json/flagged_json hold mock's in-progress,
-- ungraded state (attempt_answers.is_correct is NOT NULL, and mock must not
-- reveal correctness before submission) and double as resume-on-reload state.
-- pass_mark_pct is the configurable pass/fail threshold for mock grading (FR-4.4).
-- Applied via: wrangler d1 migrations apply <DB_NAME>

ALTER TABLE attempts ADD COLUMN question_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE attempts ADD COLUMN time_limit_seconds INTEGER;
ALTER TABLE attempts ADD COLUMN draft_answers_json TEXT;
ALTER TABLE attempts ADD COLUMN flagged_json TEXT;

ALTER TABLE exams ADD COLUMN pass_mark_pct INTEGER;

CREATE UNIQUE INDEX idx_attempt_answers_unique ON attempt_answers(attempt_id, question_id);
