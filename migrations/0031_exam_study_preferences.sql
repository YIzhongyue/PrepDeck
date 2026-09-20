-- implementation — the Statistics screen's exam countdown and weekly study-time
-- goal. Neither can be derived from attempt history: an exam date is a fact
-- only the user knows, and a weekly goal is a choice, so both are persisted
-- per user AND per exam (someone preparing for two certifications has two
-- dates and two goals, not one).
--
-- Kept out of `users` on purpose: the columns there (theme, show_shared_notes)
-- are account-wide preferences, and these are not.
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

CREATE TABLE user_exam_preferences (
  user_id TEXT NOT NULL REFERENCES users(id),
  exam_id TEXT NOT NULL REFERENCES exams(id),
  -- "YYYY-MM-DD". A calendar day, not a timestamp: the countdown is in whole
  -- UTC days (see packages/shared/src/statistics.ts), and storing an instant
  -- would invite a timezone the rest of the dashboard does not use.
  target_date TEXT,
  weekly_goal_minutes INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, exam_id)
);
