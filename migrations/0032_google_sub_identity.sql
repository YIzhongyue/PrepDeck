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
-- subjects as UUIDs: 36 characters, exactly four hyphens, at 9/14/19/24, and
-- 32 hex digits around them — and not by failing to look like a Google
-- subject. Google only documents `sub` as a case-sensitive ASCII string of at
-- most 255 characters; it happens to be decimal today, but treating "not
-- decimal" as "not Google" would let this migration erase a legitimate binding
-- the day that changes, and an unbound row can be claimed by whoever next
-- signs in with its address.
--
-- The shape is spelled out with LENGTH/SUBSTR rather than one GLOB per hex
-- digit because D1 rejects a pattern that long outright ("LIKE or GLOB pattern
-- too complex", SQLITE_ERROR 7500) and fails the deploy. The single GLOB left
-- is short, and only asks whether anything outside [0-9a-f] survives once the
-- hyphens are stripped — a negative test inside a positive identification, not
-- in place of one.
--
-- Erring the other way is the safe direction: an Access value this misses is
-- not lost data, just a conflict denial with the Admin recovery path behind it
-- (FR-1.10).
--
-- Applied via: wrangler d1 migrations apply <DB_NAME>

UPDATE users
SET google_sub = NULL
WHERE google_sub IS NOT NULL
  AND LENGTH(google_sub) = 36
  AND LENGTH(REPLACE(google_sub, '-', '')) = 32
  AND SUBSTR(google_sub, 9, 1) = '-'
  AND SUBSTR(google_sub, 14, 1) = '-'
  AND SUBSTR(google_sub, 19, 1) = '-'
  AND SUBSTR(google_sub, 24, 1) = '-'
  AND LOWER(REPLACE(google_sub, '-', '')) NOT GLOB '*[^0-9a-f]*';
