-- Archiving preserves provider/exam relationships and all historical content.
ALTER TABLE providers ADD COLUMN archived_at TEXT;
