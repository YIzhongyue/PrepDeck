-- Seek by immutable creation position without sorting the entire note set.
CREATE INDEX idx_notes_page ON notes(created_at, id);
CREATE INDEX idx_notes_question_page ON notes(question_id, created_at, id);
