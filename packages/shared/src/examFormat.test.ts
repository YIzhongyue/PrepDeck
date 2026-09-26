// The official mock format: admin input checks, the formats Mock setup offers,
// and the pass rule scaled to a mock's length.

import assert from "node:assert/strict";
import test from "node:test";
import {
  effectivePassMarkPct, isMockPassed, mockFormatOptions, officialFormatError, requiredCorrectFor,
  type OfficialMockFormat
} from "./examFormat.ts";

const SAP: OfficialMockFormat = { questionCount: 75, timeLimitMinutes: 180, passCorrectCount: 54 };

test("officialFormatError accepts a whole format or null and names the first bad field", () => {
  assert.equal(officialFormatError(null), null);
  assert.equal(officialFormatError(SAP), null);
  assert.match(officialFormatError({ ...SAP, questionCount: 0 })!, /questionCount/);
  assert.match(officialFormatError({ ...SAP, questionCount: 201 })!, /questionCount/);
  assert.match(officialFormatError({ ...SAP, timeLimitMinutes: 1.5 })!, /timeLimitMinutes/);
  assert.match(officialFormatError({ ...SAP, passCorrectCount: 76 })!, /passCorrectCount/);
  assert.match(officialFormatError({ questionCount: 75, timeLimitMinutes: 180 })!, /passCorrectCount/);
  assert.match(officialFormatError("75")!, /object/);
});

test("the pass count scales to the mock's length, rounding up", () => {
  assert.equal(requiredCorrectFor(SAP, 75), 54);
  assert.equal(requiredCorrectFor(SAP, 38), 28); // 27.36
  assert.equal(requiredCorrectFor(SAP, 20), 15); // 14.4
  assert.equal(requiredCorrectFor({ questionCount: 76, timeLimitMinutes: 1, passCorrectCount: 38 }, 38), 19, "exact ratios do not round up");
  assert.equal(requiredCorrectFor(SAP, 1), 1);
  assert.equal(requiredCorrectFor(null, 20), null);
});

test("an official format takes precedence over the percentage rule", () => {
  const rule = { passMarkPct: 90, officialFormat: SAP };
  assert.equal(isMockPassed(rule, { correctCount: 54, totalQuestions: 75, score: 72 }), true);
  assert.equal(isMockPassed(rule, { correctCount: 53, totalQuestions: 75, score: 71 }), false);
  assert.equal(isMockPassed({ passMarkPct: 70, officialFormat: null }, { correctCount: 14, totalQuestions: 20, score: 70 }), true);
  assert.equal(isMockPassed({ passMarkPct: null, officialFormat: null }, { correctCount: 20, totalQuestions: 20, score: 100 }), null);
  assert.equal(effectivePassMarkPct(rule), 72);
  assert.equal(effectivePassMarkPct({ passMarkPct: 65, officialFormat: null }), 65);
});

test("mock formats derive from the official format at its pace", () => {
  assert.deepEqual(mockFormatOptions(SAP).map(f => [f.id, f.questionCount, f.timeLimitMinutes]), [
    ["full", 75, 180], ["half", 38, 90], ["sprint", 20, 50]
  ]);
  assert.deepEqual(mockFormatOptions({ questionCount: 30, timeLimitMinutes: 60, passCorrectCount: 21 }).map(f => f.id), ["full", "half"],
    "no sprint when it would be most of the exam");
  assert.deepEqual(mockFormatOptions(null).map(f => f.id), ["sprint"]);
});
