import assert from "node:assert/strict";
import test from "node:test";
import { dailyEmailSettingsValidationError } from "./dailyEmailSettings.ts";

test("undefined is valid (field simply not being updated)", () => {
  assert.equal(dailyEmailSettingsValidationError("questionsPerEmail", undefined), null);
});

test("enabled must be a boolean", () => {
  assert.equal(dailyEmailSettingsValidationError("enabled", true), null);
  assert.match(dailyEmailSettingsValidationError("enabled", "true") ?? "", /boolean/);
});

test("questionsPerEmail rejects out-of-range and non-integer values", () => {
  assert.equal(dailyEmailSettingsValidationError("questionsPerEmail", 1), null);
  assert.equal(dailyEmailSettingsValidationError("questionsPerEmail", 5), null);
  assert.match(dailyEmailSettingsValidationError("questionsPerEmail", 0) ?? "", /between 1 and 5/);
  assert.match(dailyEmailSettingsValidationError("questionsPerEmail", 6) ?? "", /between 1 and 5/);
  assert.match(dailyEmailSettingsValidationError("questionsPerEmail", 2.5) ?? "", /between 1 and 5/);
});

test("source must be one of the known codes", () => {
  assert.equal(dailyEmailSettingsValidationError("source", "wrong"), null);
  assert.equal(dailyEmailSettingsValidationError("source", "bm"), null);
  assert.equal(dailyEmailSettingsValidationError("source", "new"), null);
  assert.match(dailyEmailSettingsValidationError("source", "unattempted") ?? "", /must be one of/);
});

test("sendHourLocal rejects hours outside 0-23", () => {
  assert.equal(dailyEmailSettingsValidationError("sendHourLocal", 0), null);
  assert.equal(dailyEmailSettingsValidationError("sendHourLocal", 23), null);
  assert.match(dailyEmailSettingsValidationError("sendHourLocal", 24) ?? "", /between 0 and 23/);
  assert.match(dailyEmailSettingsValidationError("sendHourLocal", -1) ?? "", /between 0 and 23/);
});

test("timezone rejects unknown IANA names", () => {
  assert.equal(dailyEmailSettingsValidationError("timezone", "America/Los_Angeles"), null);
  assert.equal(dailyEmailSettingsValidationError("timezone", "UTC"), null);
  assert.match(dailyEmailSettingsValidationError("timezone", "Not/AZone") ?? "", /valid IANA/);
  assert.match(dailyEmailSettingsValidationError("timezone", "") ?? "", /valid IANA/);
});
