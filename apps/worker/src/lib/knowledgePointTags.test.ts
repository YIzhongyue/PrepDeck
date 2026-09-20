import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGroupName, normalizeTagName } from "./knowledgePointTags.ts";

test("trims surrounding whitespace", () => {
  assert.equal(normalizeTagName("  aws  "), "aws");
});

test("collapses internal whitespace runs", () => {
  assert.equal(normalizeTagName("needs   review"), "needs review");
});

test("strips a leading #", () => {
  assert.equal(normalizeTagName("#aws"), "aws");
});

test("strips a leading # even with surrounding whitespace", () => {
  assert.equal(normalizeTagName("  # aws  "), "aws");
});

test("rejects an empty string", () => {
  assert.equal(normalizeTagName(""), null);
});

test("rejects a whitespace-only string", () => {
  assert.equal(normalizeTagName("   "), null);
});

test("rejects a string that is only a #", () => {
  assert.equal(normalizeTagName("#"), null);
});

test("rejects non-string input", () => {
  assert.equal(normalizeTagName(undefined), null);
  assert.equal(normalizeTagName(42), null);
  assert.equal(normalizeTagName(null), null);
});

test("rejects a name over 40 characters", () => {
  assert.equal(normalizeTagName("a".repeat(41)), null);
});

test("accepts a name at exactly 40 characters", () => {
  assert.equal(normalizeTagName("a".repeat(40)), "a".repeat(40));
});

test("preserves case (case-insensitive de-dup happens at the DB layer)", () => {
  assert.equal(normalizeTagName("AWS"), "AWS");
});

test("group names do not strip a leading #", () => {
  assert.equal(normalizeGroupName("#project"), "#project");
});

test("group names share the whitespace and length rules", () => {
  assert.equal(normalizeGroupName("  AWS   Security  "), "AWS Security");
  assert.equal(normalizeGroupName(""), null);
  assert.equal(normalizeGroupName("a".repeat(41)), null);
});
