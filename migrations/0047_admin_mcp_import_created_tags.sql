-- Preserve only the tag identities actually registered by an import job.
-- Evidence is committed atomically with each successful catalog INSERT and
-- survives a tag rename/merge/delete so replay can reject external changes.
-- No question payloads, credentials, or full import files are stored here.
CREATE TABLE admin_mcp_import_created_tags (
  import_id TEXT NOT NULL REFERENCES admin_mcp_import_jobs(id) ON DELETE CASCADE,
  normalized_name TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (import_id, normalized_name)
);
