import assert from "node:assert/strict";
import test from "node:test";
import { CLEANUP_GRACE_MS, isEligibleForCleanup } from "./knowledgePointCleanup.ts";

const NOW = Date.parse("2026-01-02T00:00:00.000Z");

test("a pending image past the grace window is eligible", () => {
  const updatedAt = new Date(NOW - CLEANUP_GRACE_MS - 1000).toISOString();
  assert.equal(isEligibleForCleanup("pending", updatedAt, NOW), true);
});

test("an orphaned image past the grace window is eligible", () => {
  const updatedAt = new Date(NOW - CLEANUP_GRACE_MS - 1000).toISOString();
  assert.equal(isEligibleForCleanup("orphaned", updatedAt, NOW), true);
});

test("a pending image still within the grace window is not eligible", () => {
  const updatedAt = new Date(NOW - CLEANUP_GRACE_MS + 1000).toISOString();
  assert.equal(isEligibleForCleanup("pending", updatedAt, NOW), false);
});

test("exactly at the grace window boundary is eligible (inclusive)", () => {
  const updatedAt = new Date(NOW - CLEANUP_GRACE_MS).toISOString();
  assert.equal(isEligibleForCleanup("pending", updatedAt, NOW), true);
});

test("an attached image is never eligible, no matter how old", () => {
  const updatedAt = new Date(NOW - CLEANUP_GRACE_MS * 100).toISOString();
  assert.equal(isEligibleForCleanup("attached", updatedAt, NOW), false);
});

test("respects a custom grace window", () => {
  const oneHour = 60 * 60 * 1000;
  const updatedAt = new Date(NOW - oneHour - 1).toISOString();
  assert.equal(isEligibleForCleanup("pending", updatedAt, NOW, oneHour), true);
  assert.equal(isEligibleForCleanup("pending", updatedAt, NOW, CLEANUP_GRACE_MS), false);
});
