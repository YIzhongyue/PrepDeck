-- implementation — configurable daily question email delivery.

CREATE TABLE user_email_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  enabled INTEGER NOT NULL DEFAULT 0,
  questions_per_email INTEGER NOT NULL DEFAULT 3 CHECK (questions_per_email BETWEEN 1 AND 5),
  -- Reuses the client's existing PracticeSource vocabulary (PrepDeckContext.tsx):
  -- 'wrong' = Wrong Question Book, 'bm' = Bookmarks, 'new' = Unattempted.
  source TEXT NOT NULL DEFAULT 'wrong' CHECK (source IN ('wrong','bm','new')),
  timezone TEXT NOT NULL DEFAULT 'UTC',        -- IANA name, e.g. 'America/Los_Angeles'
  send_hour_local INTEGER NOT NULL DEFAULT 8 CHECK (send_hour_local BETWEEN 0 AND 23),
  unsubscribed_at TEXT,                        -- set by the one-click unsubscribe endpoint; informational only
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Idempotency + variety. PRIMARY KEY(user_id, local_date) is the atomic
-- "claim" that guarantees at most one email per user per local calendar day
-- even with overlapping/retried scheduled runs. question_ids_json also lets
-- selection avoid repeating the last few days' questions when the eligible
-- pool is larger than the requested count.
CREATE TABLE daily_review_email_deliveries (
  user_id TEXT NOT NULL REFERENCES users(id),
  local_date TEXT NOT NULL,       -- YYYY-MM-DD in the user's timezone at send time
  sent_at TEXT NOT NULL,
  question_ids_json TEXT NOT NULL,
  PRIMARY KEY (user_id, local_date)
);
