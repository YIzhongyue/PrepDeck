-- Exam vendors/providers and their many-to-many exam assignments.
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  website_url TEXT,
  icon_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE provider_exams (
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, exam_id)
);

CREATE INDEX idx_provider_exams_exam_id ON provider_exams(exam_id);
