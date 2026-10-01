-- Issue #102 — MCP OAuth authorization (Google sign-in through PrepDeck)
-- alongside the existing personal access tokens (mcp_credentials, 0017/0018).
--
-- Additive: existing PAT rows are not touched and PATs keep working on the
-- same /mcp and /admin-mcp endpoints. PrepDeck is its own authorization
-- server; Google only proves who is signing in. Every OAuth secret below
-- (authorization codes, access and refresh tokens) is a high-entropy opaque
-- value stored only as its SHA-256 digest, like a PAT. Timestamps are Unix
-- milliseconds, matching mcp_credentials.
--
-- See docs/architecture/mcp.md#oauth-authorization for the flow.

-- OAuth clients PrepDeck knows about. `kind` says how the client was onboarded:
--   'dynamic'           — RFC 7591 Dynamic Client Registration; the client_id is
--                         PrepDeck-issued and its metadata is self-asserted.
--   'metadata_document' — a Client ID Metadata Document: the client_id is an
--                         https URL whose document PrepDeck fetched; the row is
--                         a cache of that document, refreshed on later requests.
-- Only public clients (token_endpoint_auth_method "none", PKCE required) exist.
CREATE TABLE mcp_oauth_clients (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('dynamic', 'metadata_document')),
  client_name TEXT,
  client_uri TEXT,
  redirect_uris_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  fetched_at INTEGER
);

-- An interactive authorization transaction: created by /api/oauth/authorize,
-- shown on the consent screen and decided once (approve or deny). It is bound
-- to the browser that started it by a cookie whose digest is
-- `browser_binding_hash`, so a consent link alone cannot be decided elsewhere.
CREATE TABLE mcp_oauth_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('user', 'admin')),
  scopes TEXT NOT NULL,
  state TEXT,
  code_challenge TEXT NOT NULL,
  browser_binding_hash TEXT NOT NULL CHECK (length(browser_binding_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_at INTEGER,
  decision TEXT CHECK (decision IN ('approved', 'denied')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE
);

-- One approved connection between an account and a client for one MCP audience.
-- Users see and revoke grants in Settings / the Admin console, independently of
-- their PATs. Revoking a grant ends refresh and every access token issued under
-- it. Grants survive browser sign-out (issue #46's session version is not
-- consulted) and are never deleted, so audit rows can keep referring to them.
CREATE TABLE mcp_oauth_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(id),
  audience TEXT NOT NULL CHECK (audience IN ('user', 'admin')),
  scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  revoke_reason TEXT CHECK (revoke_reason IN ('user', 'client', 'code_replay', 'refresh_replay'))
);

CREATE INDEX idx_mcp_oauth_grants_owner ON mcp_oauth_grants(user_id, audience);

-- Authorization codes: short-lived and single-use. Everything the token
-- request must match is copied here, so redeeming a code needs no other row.
CREATE TABLE mcp_oauth_codes (
  code_hash TEXT PRIMARY KEY CHECK (length(code_hash) = 64),
  grant_id TEXT NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- Access and refresh tokens. A refresh token is single-use: redeeming it sets
-- used_at in the same batch that creates its successor pair. `rotation_result`
-- holds that successor pair encrypted (AES-GCM) under a key derived from the
-- spent refresh token itself, so a client's concurrent duplicate refresh
-- within a few seconds gets the same pair back instead of a new one; presented
-- later, the spent token revokes the whole grant (token family). The daily
-- prune clears rotation_result once the window has passed.
CREATE TABLE mcp_oauth_tokens (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  rotation_result TEXT
);

CREATE INDEX idx_mcp_oauth_tokens_grant ON mcp_oauth_tokens(grant_id, kind);
CREATE INDEX idx_mcp_oauth_tokens_expiry ON mcp_oauth_tokens(expires_at);

-- Admin MCP audit rows must name the credential behind every mutation, and an
-- OAuth-authorized call has a grant rather than a PAT. `credential_id` keeps
-- its PAT meaning (and its foreign key) but becomes nullable; exactly one of
-- it and the new `oauth_grant_id` is set. SQLite cannot relax NOT NULL in
-- place, so the log table is rebuilt (same idiom as 0021/0043); existing rows
-- are copied unchanged. The view that reads it is dropped first and recreated
-- with the new column.
DROP VIEW content_mutation_audit;

CREATE TABLE admin_mcp_audit_log_new (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  credential_id TEXT REFERENCES mcp_credentials(id),
  oauth_grant_id TEXT REFERENCES mcp_oauth_grants(id),
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
  detail_json TEXT,
  CHECK ((credential_id IS NULL) <> (oauth_grant_id IS NULL))
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
SELECT id, occurred_at, admin_user_id, entry_point, NULL AS credential_id, NULL AS oauth_grant_id,
       NULL AS tool, action, exam_id, target_ids_json, outcome, detail_json
FROM question_mutation_audit_log
UNION ALL
SELECT id, occurred_at, admin_user_id, 'admin_mcp' AS entry_point, credential_id, oauth_grant_id,
       tool, action, exam_id, target_ids_json, outcome, detail_json
FROM admin_mcp_audit_log;
