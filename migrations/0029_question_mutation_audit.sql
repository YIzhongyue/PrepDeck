-- Browser/API authoring uses the same audit vocabulary as Admin MCP without
-- inventing an MCP credential for a browser session.
CREATE TABLE question_mutation_audit_log (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  entry_point TEXT NOT NULL CHECK (entry_point IN ('admin_api', 'import_api')),
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  exam_id TEXT,
  target_ids_json TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'skipped')),
  detail_json TEXT
);
CREATE INDEX idx_question_mutation_audit_exam ON question_mutation_audit_log(exam_id, occurred_at);

CREATE VIEW content_mutation_audit AS
SELECT id, occurred_at, admin_user_id, entry_point, NULL AS credential_id,
       NULL AS tool, action, exam_id, target_ids_json, outcome, detail_json
FROM question_mutation_audit_log
UNION ALL
SELECT id, occurred_at, admin_user_id, 'admin_mcp' AS entry_point, credential_id,
       tool, action, exam_id, target_ids_json, outcome, detail_json
FROM admin_mcp_audit_log;
