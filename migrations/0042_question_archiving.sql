-- Issues #92/#93 — archive a single question instead of deleting it.
--
-- archived_at is lifecycle state, like exams.archived_at (0003) and
-- providers.archived_at (0041): the row, its tags, attempts, wrong-book and
-- bookmark entries, notes, annotations and Knowledge Point links all stay put.
-- Archived questions drop out of every learner-facing listing, search and
-- selection, and cannot be added to a new attempt; reads by id keep working so
-- history that already references them still renders.
--
-- Deliberately not part of a question's content: archiving does not bump
-- revision or updated_at, so an editor already open on the question, a cached
-- AI explanation and an import baseline are all unaffected.
ALTER TABLE questions ADD COLUMN archived_at TEXT;

-- Every learner-facing read is "the active questions of THIS exam", so the exam
-- leads, like idx_questions_exam_needs_review (0033).
CREATE INDEX idx_questions_exam_archived ON questions(exam_id, archived_at);
