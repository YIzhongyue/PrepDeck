-- issue #39 — attempt_answers.time_spent_seconds was stored exactly as a client
-- sent it. SQLite does not enforce the INTEGER column type, so a direct API call
-- could leave text ('lots'), reals (1e300) or negative numbers in it.
--
-- POST /api/attempts/:id/answers now accepts only a whole number of seconds from
-- 0 to 86400 (MAX_TIME_SPENT_SECONDS in packages/shared/src/grading.ts). Nothing
-- reads this column yet, so the values that break that rule are cleared rather
-- than guessed at: NULL already means "not recorded", which is what the web
-- client has always sent.
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

UPDATE attempt_answers
SET time_spent_seconds = NULL
WHERE time_spent_seconds IS NOT NULL
  AND (typeof(time_spent_seconds) <> 'integer'
       OR time_spent_seconds < 0
       OR time_spent_seconds > 86400);
