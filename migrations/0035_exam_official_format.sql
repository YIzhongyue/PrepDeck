-- An exam's official mock format: the real test's number of questions, its
-- time limit, and how many correct answers it takes to pass. Admins set it per
-- exam; Mock setup derives its Full / Half / Sprint formats from it, and a
-- finished mock passes when it reaches the same share of correct answers,
-- scaled to its own length (packages/shared/src/examFormat.ts).
--
-- The three columns are set and cleared together — a pass count means nothing
-- without the question count it is out of. When they are NULL the exam keeps
-- the older percentage rule in pass_mark_pct.
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

ALTER TABLE exams ADD COLUMN official_question_count INTEGER;
ALTER TABLE exams ADD COLUMN official_time_limit_minutes INTEGER;
ALTER TABLE exams ADD COLUMN official_pass_correct_count INTEGER;
