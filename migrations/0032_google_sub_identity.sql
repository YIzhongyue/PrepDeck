-- FR-1.9: `users.google_sub` becomes the identifier a returning Google user is
-- resolved by (lib/authorizeIdentity.ts), instead of the email address. The
-- column and its UNIQUE index already exist, so there is nothing to add — but
-- the values in it can no longer be trusted blindly, for one reason:
--
-- The Cloudflare Access path (AUTH_MODE=access, middleware/access.ts) used to
-- write the *Access* JWT's `sub` into this column. That is Access's own
-- subject for the person, not Google's, so it will never match the `sub` a
-- Google ID token carries. Left in place it would be read as "this account is
-- already bound to a different Google account" and lock the user out, since
-- the email fallback deliberately refuses to rebind a row that already carries
-- a subject rather than merge two identities.
--
-- Google OIDC subjects are decimal digit strings; Access subjects are UUIDs.
-- Clearing everything that cannot be a Google subject re-arms the one-time
-- email-based rebind for exactly those rows, and is harmless for any value
-- that only looks unusual: an unbound row simply binds again on the next
-- successful Google sign-in.
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

UPDATE users
SET google_sub = NULL
WHERE google_sub IS NOT NULL
  AND (google_sub = '' OR google_sub GLOB '*[^0-9]*');
