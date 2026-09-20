-- implementation — claim/progress ledger for Admin MCP import execution. Unlike
-- admin_mcp_create_operations (0020), this row is inserted at *execute* time
-- (never at preview, so preview stays non-mutating) and doubles as: (a) an
-- atomic claim on `id` (importId) so two concurrent executes of the same
-- import can't both proceed, (b) the idempotency/replay record compared via
-- request_fingerprint (which binds conflictResolutions, not just the file),
-- and (c) the backing store for admin_get_import_status.
CREATE TABLE admin_mcp_import_jobs (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id),
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  file_token TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'partial', 'failed')),
  question_count INTEGER NOT NULL,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  r2_object_key TEXT,
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX idx_admin_mcp_import_jobs_exam ON admin_mcp_import_jobs(exam_id, created_at);
