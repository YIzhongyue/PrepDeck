// issue #47 — calendar days in the user's own time zone. Statistics count a
// day, a week and a countdown in the account's IANA zone (users.timezone), and
// the Worker and the web app must draw the same boundaries, so both use these.
//
// A "date key" is a calendar date, "YYYY-MM-DD", with no zone of its own.
// Arithmetic on date keys is plain calendar arithmetic; only converting between
// an instant and a date key needs the zone, and Intl does that, DST included.

/** The zone used when an account has not chosen one yet. */
export const DEFAULT_TIME_ZONE = "UTC";

const DAY_MS = 24 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** True for a zone name this runtime's Intl accepts, such as "Asia/Tokyo". */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

/** Intl's own spelling of a valid zone ("asia/tokyo" → "Asia/Tokyo"), else null. */
export function canonicalTimeZone(value: unknown): string | null {
  return isValidTimeZone(value) ? formatterFor(value).resolvedOptions().timeZone : null;
}

/** `value` if it is a usable zone, otherwise UTC. */
export function resolveTimeZone(value: unknown): string {
  return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}

/** The calendar date `at` falls on in `timeZone`. */
export function zonedDateKey(at: Date | number, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

function dateKeyToUtcMs(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

/** True for a real "YYYY-MM-DD" calendar date. */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = dateKeyToUtcMs(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** `key` moved by `days` calendar days. */
export function addDaysToDateKey(key: string, days: number): string {
  return new Date(dateKeyToUtcMs(key) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetweenDateKeys(from: string, to: string): number {
  return Math.round((dateKeyToUtcMs(to) - dateKeyToUtcMs(from)) / DAY_MS);
}

/** The Monday of the Monday-to-Sunday week containing `key`. */
export function weekStartOfDateKey(key: string): string {
  const isoWeekday = (new Date(dateKeyToUtcMs(key)).getUTCDay() + 6) % 7; // Monday = 0
  return addDaysToDateKey(key, -isoWeekday);
}

/**
 * The first instant of calendar day `key` in `timeZone`. Usually local
 * midnight; where a DST change skips midnight, the first moment that exists.
 *
 * Found by bisection over the instants that could start the day, since every
 * UTC offset in use lies between -12:00 and +14:00: a local date only moves
 * forward as time does, so the first instant whose date is `key` or later is
 * the day's start.
 */
export function zonedDayStart(key: string, timeZone: string): Date {
  const midnightAsUtc = dateKeyToUtcMs(key);
  // At `lo` the local date is still the previous day (offset at most +14:00);
  // by `hi` it is `key` or later (offset at least -12:00).
  let lo = midnightAsUtc - 15 * 60 * 60 * 1000;
  let hi = midnightAsUtc + 13 * 60 * 60 * 1000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (zonedDateKey(mid, timeZone) >= key) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}
