import assert from "node:assert/strict";
import test from "node:test";
import { examFieldsError } from "./examManagement.ts";

test("accepts a full metadata edit and an empty patch", () => {
  assert.equal(examFieldsError({
    name: "AWS SAP-C02", slug: "aws-sap-c02", subject: "Architecture", description: "Pro-level exam.",
    language: "en", passMarkPct: 75,
  }), null);
  assert.equal(examFieldsError({}), null);
});

test("null clears optional text and the pass mark", () => {
  assert.equal(examFieldsError({ subject: null, description: null, language: null, passMarkPct: null }), null);
});

test("rejects a slug outside the slug pattern", () => {
  for (const slug of ["AWS", "aws_sap", "aws--sap", "-aws", "", 7]) {
    assert.match(examFieldsError({ slug }) ?? "", /^slug /, `slug ${JSON.stringify(slug)}`);
  }
});

test("name is required to be non-blank text when present", () => {
  assert.equal(examFieldsError({ name: "  " }), "name cannot be empty");
  assert.equal(examFieldsError({ name: null }), "name must be a string");
});

test("text fields keep Admin MCP's length limits", () => {
  assert.equal(examFieldsError({ name: "n".repeat(200), language: "l".repeat(50), description: "d".repeat(2000) }), null);
  assert.equal(examFieldsError({ name: "n".repeat(201) }), "name must be at most 200 characters");
  assert.equal(examFieldsError({ subject: "s".repeat(201) }), "subject must be at most 200 characters");
  assert.equal(examFieldsError({ description: "d".repeat(2001) }), "description must be at most 2000 characters");
  assert.equal(examFieldsError({ language: "l".repeat(51) }), "language must be at most 50 characters");
  assert.equal(examFieldsError({ subject: 3 }), "subject must be a string");
});

test("pass mark must be a percentage", () => {
  assert.equal(examFieldsError({ passMarkPct: 0 }), null);
  assert.equal(examFieldsError({ passMarkPct: 100 }), null);
  for (const passMarkPct of [-1, 101, "70", Number.NaN]) {
    assert.match(examFieldsError({ passMarkPct }) ?? "", /^passMarkPct /, `passMarkPct ${String(passMarkPct)}`);
  }
});
