-- FR-7.7 (S): track who first generated a cached explanation, so a
-- force-regenerate/manual-edit can be scoped to Admin or that original
-- requester, plus when it was last (re)generated/edited.
ALTER TABLE ai_explanations ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE ai_explanations ADD COLUMN updated_at TEXT;
