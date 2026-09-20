-- implementation (review) — a standalone idempotency ledger for Admin MCP question
-- creation, kept independent of the questions table so a replay after the
-- created question is deleted is still recognized rather than silently
-- recreating it. proposal_token is the immutable fingerprint of the
-- originally accepted request (it already binds examId + payload — see
-- lib/questionProposals.ts): a replay must present the same proposalToken,
-- or the proposalId is being reused with different content and is rejected
-- as a conflict instead of returning or recreating anything.
CREATE TABLE admin_mcp_create_operations (
  proposal_id TEXT PRIMARY KEY,
  proposal_token TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_admin_mcp_create_operations_exam ON admin_mcp_create_operations(exam_id);
