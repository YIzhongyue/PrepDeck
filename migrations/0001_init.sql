-- Initial schema, based on Requirement Spec Appendix A (informative sketch).
-- Applied via: wrangler d1 migrations apply <DB_NAME>

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  google_sub TEXT UNIQUE,        -- NULL until first sign-in (status = 'invited')
  display_name TEXT,             -- FR-12.1/12.2: initialized from Google profile, user-editable after
  avatar_url TEXT,               -- FR-12.1/12.3: initialized from Google profile picture; may later point to an R2-hosted custom upload
  role TEXT NOT NULL CHECK (role IN ('admin','user')) DEFAULT 'user',
  status TEXT NOT NULL CHECK (status IN ('invited','active','revoked')) DEFAULT 'invited',
  invited_by TEXT REFERENCES users(id),
  show_shared_notes INTEGER NOT NULL DEFAULT 1, -- FR-11.4: show other users' shared notes? default ON
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE exams (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  subject TEXT,
  language TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id),
  external_id TEXT,
  type TEXT NOT NULL,
  stem TEXT NOT NULL,
  options_json TEXT,          -- JSON array, null for fill_blank
  correct_answers_json TEXT NOT NULL, -- JSON array
  explanation TEXT,
  difficulty TEXT,
  tags_json TEXT,              -- JSON array
  points REAL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_questions_exam_id ON questions(exam_id);

CREATE TABLE ai_explanations (
  question_id TEXT NOT NULL REFERENCES questions(id),
  provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic')),
  model TEXT NOT NULL,
  content TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (question_id, provider, model)
  -- Note: no API key is ever stored here or in any other Cloudflare storage service;
  -- the AI-proxy Worker endpoint only relays it transiently to the upstream provider (see FR-7.0, FR-7.4).
);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  exam_id TEXT NOT NULL REFERENCES exams(id),
  mode TEXT NOT NULL CHECK (mode IN ('practice','mock')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_seconds INTEGER,
  score REAL,
  total_questions INTEGER
);

CREATE INDEX idx_attempts_user_id ON attempts(user_id);

CREATE TABLE attempt_answers (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  selected_answer_json TEXT,
  is_correct INTEGER NOT NULL,
  time_spent_seconds INTEGER
);

CREATE INDEX idx_attempt_answers_attempt_id ON attempt_answers(attempt_id);

CREATE TABLE wrong_question_book (
  user_id TEXT NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  wrong_count INTEGER NOT NULL DEFAULT 1,
  last_wrong_at TEXT NOT NULL,
  mastered INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('stem','option','ai_explanation')),
  target_ref TEXT,              -- option id, when target_type = 'option'
  range_start INTEGER NOT NULL,
  range_end INTEGER NOT NULL,
  style TEXT NOT NULL,          -- e.g. 'highlight_yellow', 'underline', 'bold'
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_annotations_user_question ON annotations(user_id, question_id);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  content TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private','shared')) DEFAULT 'private',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_notes_question_id ON notes(question_id);

CREATE TABLE import_logs (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id),
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  r2_object_key TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
