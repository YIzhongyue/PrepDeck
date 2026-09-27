// issue #47 — the account's IANA time zone (users.timezone), which statistics
// count days and weeks in and the daily review email is sent in. NULL means
// the user has not chosen one yet; everything then counts in UTC.

import { canonicalTimeZone, resolveTimeZone } from "@prepdeck/shared";

/** The stored zone, or null when none has been chosen. */
export async function loadStoredTimeZone(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare("SELECT timezone FROM users WHERE id = ?").bind(userId).first<{ timezone: string | null }>();
  return row?.timezone ?? null;
}

/** The zone to count in: the stored one, or UTC. */
export async function loadUserTimeZone(db: D1Database, userId: string): Promise<string> {
  return resolveTimeZone(await loadStoredTimeZone(db, userId));
}

/** Stores `value` in Intl's spelling. Returns it, or null if it is not a zone. */
export async function saveUserTimeZone(db: D1Database, userId: string, value: unknown): Promise<string | null> {
  const timeZone = canonicalTimeZone(value);
  if (!timeZone) return null;
  await db.prepare("UPDATE users SET timezone = ? WHERE id = ?").bind(timeZone, userId).run();
  return timeZone;
}
