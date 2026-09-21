-- FR-1.9: `users.google_sub` becomes the identifier a returning Google user is
-- resolved by (lib/authorizeIdentity.ts), instead of the email address. The
-- column and its UNIQUE index already exist, so there is nothing to add — but
-- one class of historical value in it has to go, for one reason:
--
-- The Cloudflare Access path (AUTH_MODE=access, middleware/access.ts) used to
-- write the *Access* JWT's `sub` into this column. That is Access's own
-- subject for the person, not Google's, so it will never match the `sub` a
-- Google ID token carries. Left in place it would be read as "this account is
-- already bound to a different Google account" and lock the user out, since
-- the email fallback deliberately refuses to rebind a row that already carries
-- a subject rather than merge two identities.
--
-- Those values are identified by what they positively are — Access mints its
-- subjects as UUIDs, matched below — and not by failing to look like a Google
-- subject. Google only documents `sub` as a case-sensitive ASCII string of at
-- most 255 characters; it happens to be decimal today, but treating "not
-- decimal" as "not Google" would let this migration erase a legitimate binding
-- the day that changes, and an unbound row can be claimed by whoever next
-- signs in with its address.
--
-- Erring the other way is the safe direction: an Access value this pattern
-- fails to match is not lost data, just a conflict denial with the Admin
-- recovery path behind it (FR-1.10).
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

UPDATE users
SET google_sub = NULL
WHERE google_sub IS NOT NULL
  AND google_sub GLOB '[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]';
