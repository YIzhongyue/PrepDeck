import assert from "node:assert/strict";
import test from "node:test";
import { aliasValidationError, resolveMarkAlias } from "./annotationSettings.ts";

test("aliasValidationError accepts an omitted field", () => {
  assert.equal(aliasValidationError("hl1Alias", undefined), null);
});

test("aliasValidationError accepts a valid string", () => {
  assert.equal(aliasValidationError("hl1Alias", "Service"), null);
});

test("aliasValidationError rejects a non-string value", () => {
  assert.match(aliasValidationError("hl1Alias", 42) ?? "", /must be a string/);
});

test("aliasValidationError rejects a value longer than the max length", () => {
  const tooLong = "x".repeat(41);
  assert.match(aliasValidationError("hl1Alias", tooLong) ?? "", /40 characters or fewer/);
});

test("aliasValidationError allows exactly the max length after trimming", () => {
  const exact = "x".repeat(40);
  assert.equal(aliasValidationError("hl1Alias", `  ${exact}  `), null);
});

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
