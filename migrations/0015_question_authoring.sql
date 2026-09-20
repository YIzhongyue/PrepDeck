-- Keep legacy identities intact, including any pre-existing duplicate external IDs.
ALTER TABLE questions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE questions ADD COLUMN answer_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE questions ADD COLUMN answer_revised_at TEXT;
ALTER TABLE questions ADD COLUMN import_baseline_json TEXT;
ALTER TABLE attempt_answers ADD COLUMN answer_revision INTEGER;
ALTER TABLE attempt_answers ADD COLUMN graded_answers_json TEXT;
-- NULL snapshots deliberately mean unknown for legacy attempts.
CREATE INDEX idx_questions_exam_external ON questions(exam_id, external_id);

-- Ungraded attempts reference questions through their ordered JSON list,
-- before an attempt_answers foreign key exists. Protect those too.
CREATE TRIGGER questions_attempt_delete BEFORE DELETE ON questions
WHEN EXISTS (
  SELECT 1 FROM attempts, json_each(attempts.question_ids_json)
  WHERE attempts.exam_id = OLD.exam_id AND json_each.value = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'question referenced by an attempt'); END;

CREATE TRIGGER questions_external_id_insert BEFORE INSERT ON questions
WHEN NEW.external_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM questions WHERE exam_id = NEW.exam_id AND external_id = NEW.external_id
)
BEGIN SELECT RAISE(ABORT, 'duplicate external ID'); END;

CREATE TRIGGER questions_external_id_update BEFORE UPDATE OF external_id ON questions
WHEN NEW.external_id IS NOT NULL AND NEW.external_id IS NOT OLD.external_id AND EXISTS (
  SELECT 1 FROM questions WHERE exam_id = NEW.exam_id AND external_id = NEW.external_id AND id != NEW.id
)
BEGIN SELECT RAISE(ABORT, 'duplicate external ID'); END;

-- Invalidation is atomic with the write, including accepted import updates.
CREATE TRIGGER questions_invalidate_ai AFTER UPDATE ON questions
WHEN OLD.type IS NOT NEW.type OR OLD.stem IS NOT NEW.stem
  OR OLD.options_json IS NOT NEW.options_json OR OLD.correct_answers_json IS NOT NEW.correct_answers_json
  OR OLD.explanation IS NOT NEW.explanation
BEGIN DELETE FROM ai_explanations WHERE question_id = NEW.id; END;
