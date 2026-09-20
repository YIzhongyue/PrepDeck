-- implementation — generalize admin_mcp_audit_log beyond question-only mutations
-- (import execute, exam lifecycle, taxonomy). SQLite can't rename a column and
-- widen a CHECK constraint in place, so the table is rebuilt (same idiom as
-- 0018_mcp_credential_names.sql).
CREATE TABLE admin_mcp_audit_log_new (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  credential_id TEXT NOT NULL REFERENCES mcp_credentials(id),
  tool TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'create', 'update', 'delete', 'batch_create', 'batch_update',
    'import_execute', 'exam_create', 'exam_update', 'exam_archive',
    'tag_create', 'tag_update', 'tag_merge'
  )),
  exam_id TEXT,
  target_ids_json TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'partial', 'failure', 'skipped')),
  detail_json TEXT
);

INSERT INTO admin_mcp_audit_log_new
  (id, occurred_at, admin_user_id, credential_id, tool, action, exam_id, target_ids_json, outcome, detail_json)
SELECT id, occurred_at, admin_user_id, credential_id, tool, action, exam_id, question_ids_json, outcome, detail_json
FROM admin_mcp_audit_log;

DROP TABLE admin_mcp_audit_log;
ALTER TABLE admin_mcp_audit_log_new RENAME TO admin_mcp_audit_log;

CREATE INDEX idx_admin_mcp_audit_log_admin ON admin_mcp_audit_log(admin_user_id, occurred_at);
CREATE INDEX idx_admin_mcp_audit_log_exam ON admin_mcp_audit_log(exam_id, occurred_at);
