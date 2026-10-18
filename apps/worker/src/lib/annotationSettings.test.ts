import assert from "node:assert/strict";
import test from "node:test";
import { resolveMarkAlias } from "./annotationSettings.ts";

test("resolveMarkAlias trims and returns non-empty input", () => {
  assert.equal(resolveMarkAlias("  Service  ", undefined, "hl1"), "Service");
});

test("resolveMarkAlias falls back to the current stored value when input is empty", () => {
  assert.equal(resolveMarkAlias("   ", "Existing alias", "hl1"), "Existing alias");
});

test("resolveMarkAlias falls back to the current stored value when input is omitted", () => {
  assert.equal(resolveMarkAlias(undefined, "Existing alias", "hl2"), "Existing alias");
});

test("resolveMarkAlias falls back to the built-in default when no row exists and input is empty", () => {
  assert.equal(resolveMarkAlias(undefined, undefined, "hl3"), "Other");
});

test("resolveMarkAlias falls back to the built-in default for each mark style", () => {
  assert.equal(resolveMarkAlias("", undefined, "hl1"), "Service");
  assert.equal(resolveMarkAlias("", undefined, "hl2"), "Key constraint");
  assert.equal(resolveMarkAlias("", undefined, "hl3"), "Other");
});
