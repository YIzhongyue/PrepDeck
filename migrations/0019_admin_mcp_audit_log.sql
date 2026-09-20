-- implementation — audit trail for Admin MCP mutation tools. One row per tool
-- call (not per affected question); batch tools summarize outcome counts in
-- detail_json rather than getting one row per item.
CREATE TABLE admin_mcp_audit_log (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  credential_id TEXT NOT NULL REFERENCES mcp_credentials(id),
  tool TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'batch_create', 'batch_update')),
  exam_id TEXT,
  question_ids_json TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'partial', 'failure')),
  detail_json TEXT
);

CREATE INDEX idx_admin_mcp_audit_log_admin ON admin_mcp_audit_log(admin_user_id, occurred_at);
CREATE INDEX idx_admin_mcp_audit_log_exam ON admin_mcp_audit_log(exam_id, occurred_at);
