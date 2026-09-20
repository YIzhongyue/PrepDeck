-- Section 3.14 — Learning Mode (学习模式). Sequential read-through study:
-- questions need a stable per-exam ordinal position (FR-14.1's "question
-- sequence number") to support "start from question #N," and each answer
-- needs its own timestamp (FR-14.4's answer-history requirement) which
-- attempt_answers never tracked before (only attempts.started_at/completed_at).

ALTER TABLE questions ADD COLUMN sequence_number INTEGER;

-- Backfill existing rows using their current per-exam creation order
-- (mirrors FR-2.3.1: sequence follows original import-array order, and
-- created_at/id already reflect that insertion order for existing data).
UPDATE questions SET sequence_number = (
  SELECT COUNT(*) FROM questions q2
  WHERE q2.exam_id = questions.exam_id
    AND (q2.created_at < questions.created_at OR (q2.created_at = questions.created_at AND q2.id < questions.id))
) + 1;

CREATE INDEX idx_questions_exam_sequence ON questions(exam_id, sequence_number);

ALTER TABLE attempt_answers ADD COLUMN answered_at TEXT;

-- FR-14.9: per-user, per-exam resume position for Learning Mode.
CREATE TABLE learning_progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  exam_id TEXT NOT NULL REFERENCES exams(id),
  last_sequence_number INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, exam_id)
);
