-- Resolved component snapshots retain shared-material identities and revisions.
-- Existing text questions continue to use NULL without rewriting their content.
ALTER TABLE questions ADD COLUMN content_json TEXT;
CREATE TRIGGER questions_invalidate_component_ai AFTER UPDATE OF content_json ON questions
WHEN OLD.content_json IS NOT NEW.content_json
BEGIN DELETE FROM ai_explanations WHERE question_id = NEW.id; END;
