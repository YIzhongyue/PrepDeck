-- issue #47 — statistics bucketed every answer and session by its UTC calendar
-- day, so a learner in Japan (UTC+9) who studied before 09:00 saw it counted on
-- the previous day, and their week reset at 09:00 on Monday.
--
-- Each account now has one IANA time zone. Statistics compute day and week
-- boundaries in it (lib/learningStats.ts), and the daily review email is sent
-- at its local hour in the same zone. NULL means not chosen yet: the server
-- treats it as UTC, and the web app fills it in from the browser on its next
-- load.
--
-- The daily email kept its own zone in user_email_settings.timezone. A value
-- other than the column's 'UTC' default was chosen by the user (the Settings
-- screen switched the default to the browser's zone when the email was turned
-- on), so it becomes the account's zone. That column is no longer read or
-- written; it is left in place so a rollback of the Worker still finds it.
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

ALTER TABLE users ADD COLUMN timezone TEXT;

UPDATE users
SET timezone = (SELECT s.timezone FROM user_email_settings s WHERE s.user_id = users.id)
WHERE EXISTS (SELECT 1 FROM user_email_settings s WHERE s.user_id = users.id AND s.timezone <> 'UTC');
