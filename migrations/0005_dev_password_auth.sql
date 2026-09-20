-- Dev-only email+password login, used in place of Cloudflare Access while
-- AUTH_MODE = "dev" (see apps/worker/src/middleware/access.ts). NULL for
-- accounts that will only ever sign in through Access/Google SSO.
ALTER TABLE users ADD COLUMN password_hash TEXT;
