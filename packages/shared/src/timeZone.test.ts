// issue #47 — calendar days in the account's time zone, including zones with
// DST and zones whose offset is not a whole hour.

import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysToDateKey, canonicalTimeZone, daysBetweenDateKeys, isDateKey, isValidTimeZone,
  resolveTimeZone, weekStartOfDateKey, zonedDateKey, zonedDayStart,
} from "./timeZone.ts";

test("zone names: Intl decides what is valid, and writes store its spelling", () => {
  assert.equal(isValidTimeZone("Asia/Tokyo"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone(9), false);
  assert.equal(canonicalTimeZone("asia/tokyo"), "Asia/Tokyo");
  assert.equal(canonicalTimeZone("Mars/Olympus"), null);
  assert.equal(resolveTimeZone(null), "UTC");
  assert.equal(resolveTimeZone("America/New_York"), "America/New_York");
});

test("a 07:30 JST answer falls on that JST day, not the UTC day before", () => {
  const at = new Date("2026-09-26T22:30:00Z"); // 2026-09-27 07:30 in Tokyo
  assert.equal(zonedDateKey(at, "UTC"), "2026-09-26");
  assert.equal(zonedDateKey(at, "Asia/Tokyo"), "2026-09-27");
  assert.equal(zonedDayStart("2026-09-27", "Asia/Tokyo").toISOString(), "2026-09-26T15:00:00.000Z");
});

test("day starts follow DST in America/New_York", () => {
  // Spring forward on 2026-03-08: that day is 23 hours long.
  assert.equal(zonedDayStart("2026-03-08", "America/New_York").toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(zonedDayStart("2026-03-09", "America/New_York").toISOString(), "2026-03-09T04:00:00.000Z");
  // 00:30 EDT on the 9th. A fixed EST offset would put it at 23:30 on the 8th.
  assert.equal(zonedDateKey(new Date("2026-03-09T04:30:00Z"), "America/New_York"), "2026-03-09");
  // Fall back on 2026-11-01: that day is 25 hours long.
  assert.equal(zonedDayStart("2026-11-01", "America/New_York").toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(zonedDayStart("2026-11-02", "America/New_York").toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(zonedDateKey(new Date("2026-11-02T04:30:00Z"), "America/New_York"), "2026-11-01");
});

test("a day whose midnight is skipped starts at its first real instant", () => {
  // Chile moves from -04:00 to -03:00 at midnight on 2026-09-06.
  assert.equal(zonedDayStart("2026-09-06", "America/Santiago").toISOString(), "2026-09-06T04:00:00.000Z");
  assert.equal(zonedDateKey(new Date("2026-09-06T04:00:00Z"), "America/Santiago"), "2026-09-06");
  assert.equal(zonedDateKey(new Date("2026-09-06T03:59:59.999Z"), "America/Santiago"), "2026-09-05");
});

test("quarter-hour offsets: Nepal is UTC+05:45", () => {
  assert.equal(zonedDayStart("2026-09-27", "Asia/Kathmandu").toISOString(), "2026-09-26T18:15:00.000Z");
  assert.equal(zonedDateKey(new Date("2026-09-26T18:14:59Z"), "Asia/Kathmandu"), "2026-09-26");
});

test("date keys: plain calendar arithmetic", () => {
  assert.equal(isDateKey("2026-02-28"), true);
  assert.equal(isDateKey("2026-02-30"), false);
  assert.equal(isDateKey("2026-9-1"), false);
  assert.equal(addDaysToDateKey("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysToDateKey("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetweenDateKeys("2026-09-20", "2026-10-27"), 37);
  assert.equal(daysBetweenDateKeys("2026-09-20", "2026-09-19"), -1);
  // Across a DST change the calendar still counts one day per date.
  assert.equal(daysBetweenDateKeys("2026-03-07", "2026-03-09"), 2);
  // 2026-09-20 is a Sunday; its week began on Monday the 14th.
  assert.equal(weekStartOfDateKey("2026-09-20"), "2026-09-14");
  assert.equal(weekStartOfDateKey("2026-09-14"), "2026-09-14");
  assert.equal(weekStartOfDateKey("2026-09-21"), "2026-09-21");
});
