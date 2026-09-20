-- Only digests of high-entropy, server-specific bearer credentials are stored.
-- Token issuance is an internal operation; no public management API in #59.
CREATE TABLE mcp_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server TEXT NOT NULL CHECK (server IN ('user', 'admin')),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  revoked_at INTEGER
);

CREATE INDEX idx_mcp_credentials_owner ON mcp_credentials(user_id, server);
