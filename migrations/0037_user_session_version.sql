-- issue #46 — signing out did not end a session. Cookie sessions are signed,
-- stateless tokens valid for 7 days; logout only cleared the browser's copy,
-- so a copied token stayed usable until it expired.
--
-- Each token now carries its account's session version (lib/session.ts), and
-- middleware/access.ts refuses a token whose version is no longer current.
-- Signing out or revoking the account increments the version, ending every
-- session of that account at once. Existing tokens predate the version and
-- are refused after this deploys: every user signs in once more.
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
