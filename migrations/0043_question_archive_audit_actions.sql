-- Issues #92/#93 — question archive/unarchive are audited content mutations on
-- both entry points: the Admin UI (question_mutation_audit_log, 0029) and Admin
-- MCP (admin_mcp_audit_log, 0021). Neither CHECK constraint can be widened in
-- place, so both tables are rebuilt (same idiom as 0021).
--
-- The content_mutation_audit view (0029) reads both tables. SQLite refuses to
-- rename a table while a view refers to a table that no longer exists, so the
-- view is dropped first and recreated, unchanged, at the end.
DROP VIEW content_mutation_audit;

CREATE TABLE question_mutation_audit_log_new (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  entry_point TEXT NOT NULL CHECK (entry_point IN ('admin_api', 'import_api')),
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'archive', 'unarchive')),
  exam_id TEXT,
  target_ids_json TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'skipped')),
  detail_json TEXT
);

INSERT INTO question_mutation_audit_log_new
  (id, occurred_at, admin_user_id, entry_point, action, exam_id, target_ids_json, outcome, detail_json)
SELECT id, occurred_at, admin_user_id, entry_point, action, exam_id, target_ids_json, outcome, detail_json
FROM question_mutation_audit_log;

DROP TABLE question_mutation_audit_log;
ALTER TABLE question_mutation_audit_log_new RENAME TO question_mutation_audit_log;
CREATE INDEX idx_question_mutation_audit_exam ON question_mutation_audit_log(exam_id, occurred_at);

CREATE TABLE admin_mcp_audit_log_new (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  credential_id TEXT NOT NULL REFERENCES mcp_credentials(id),
  tool TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'create', 'update', 'delete', 'batch_create', 'batch_update',
    'archive', 'unarchive',
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
SELECT id, occurred_at, admin_user_id, credential_id, tool, action, exam_id, target_ids_json, outcome, detail_json
FROM admin_mcp_audit_log;

DROP TABLE admin_mcp_audit_log;
ALTER TABLE admin_mcp_audit_log_new RENAME TO admin_mcp_audit_log;
CREATE INDEX idx_admin_mcp_audit_log_admin ON admin_mcp_audit_log(admin_user_id, occurred_at);
CREATE INDEX idx_admin_mcp_audit_log_exam ON admin_mcp_audit_log(exam_id, occurred_at);

CREATE VIEW content_mutation_audit AS
SELECT id, occurred_at, admin_user_id, entry_point, NULL AS credential_id,
       NULL AS tool, action, exam_id, target_ids_json, outcome, detail_json
FROM question_mutation_audit_log
UNION ALL
SELECT id, occurred_at, admin_user_id, 'admin_mcp' AS entry_point, credential_id,
       tool, action, exam_id, target_ids_json, outcome, detail_json
FROM admin_mcp_audit_log;
