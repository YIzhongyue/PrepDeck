-- Extends mcp_credentials (0017) for implementation: named, self-service tokens.
-- Adds `name` (shown in Settings / the admin token surface), `last_used_at`
-- (populated on every successful authenticateMcp call), and makes
-- `expires_at` nullable so a token can be issued with no expiration.
-- SQLite cannot relax a NOT NULL/CHECK constraint in place, so the table is
-- rebuilt; existing rows (all from #59, before any UI existed) get a
-- placeholder name.

CREATE TABLE mcp_credentials_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server TEXT NOT NULL CHECK (server IN ('user', 'admin')),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at > created_at),
  revoked_at INTEGER,
  last_used_at INTEGER
);

INSERT INTO mcp_credentials_new (id, user_id, server, name, token_hash, created_at, expires_at, revoked_at)
SELECT id, user_id, server, 'Unnamed token', token_hash, created_at, expires_at, revoked_at
FROM mcp_credentials;

DROP TABLE mcp_credentials;
ALTER TABLE mcp_credentials_new RENAME TO mcp_credentials;

CREATE INDEX idx_mcp_credentials_owner ON mcp_credentials(user_id, server);
