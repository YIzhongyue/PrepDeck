import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { createExamRequestSchema, officialFormatSchema, updateExamRequestSchema } from "./exams.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

const data = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

test("a body that is missing or not an object gets the route's own message", () => {
  for (const body of [null, "text", 42]) assert.equal(error(createExamRequestSchema, body), "slug and name are required");
});

test("exams: create needs a slug and a name before anything else is checked", () => {
  assert.equal(error(createExamRequestSchema, {}), "slug and name are required");
  assert.equal(error(createExamRequestSchema, { slug: "", name: "AWS" }), "slug and name are required");
  assert.equal(error(createExamRequestSchema, { slug: "aws", name: 0, subject: 3 }), "slug and name are required");
  assert.equal(error(createExamRequestSchema, { slug: 7, name: "AWS" }), "slug must be lowercase alphanumeric segments separated by hyphens");
  assert.equal(error(createExamRequestSchema, { slug: "aws", name: "  " }), "name cannot be empty");
  assert.deepEqual(data(createExamRequestSchema, { slug: "aws-sap-c02", name: "AWS SAP", extra: 1 }), { slug: "aws-sap-c02", name: "AWS SAP" });
});

test("exams: update fields", () => {
  const schema = updateExamRequestSchema;
  assert.equal(error(schema, {
    name: "AWS SAP-C02", slug: "aws-sap-c02", subject: "Architecture", description: "Pro-level exam.", language: "en", passMarkPct: 75,
  }), null);
  assert.equal(error(schema, {}), null);
  // null clears optional text and the pass mark.
  assert.equal(error(schema, { subject: null, description: null, language: null, passMarkPct: null }), null);
  for (const slug of ["AWS", "aws_sap", "aws--sap", "-aws", "", 7]) {
    assert.equal(error(schema, { slug }), "slug must be lowercase alphanumeric segments separated by hyphens", `slug ${JSON.stringify(slug)}`);
  }
  assert.equal(error(schema, { name: "  " }), "name cannot be empty");
  assert.equal(error(schema, { name: null }), "name must be a string");
  // Admin MCP's length limits.
  assert.equal(error(schema, { name: "n".repeat(200), language: "l".repeat(50), description: "d".repeat(2000) }), null);
  assert.equal(error(schema, { name: "n".repeat(201) }), "name must be at most 200 characters");
  assert.equal(error(schema, { subject: "s".repeat(201) }), "subject must be at most 200 characters");
  assert.equal(error(schema, { description: "d".repeat(2001) }), "description must be at most 2000 characters");
  assert.equal(error(schema, { language: "l".repeat(51) }), "language must be at most 50 characters");
  assert.equal(error(schema, { subject: 3 }), "subject must be a string");
  for (const passMarkPct of [0, 100]) assert.equal(error(schema, { passMarkPct }), null);
  for (const passMarkPct of [-1, 101, "70"]) {
    assert.equal(error(schema, { passMarkPct }), "passMarkPct must be a number from 0 to 100, or null", `passMarkPct ${String(passMarkPct)}`);
  }
  // Fields are checked in this order, the officialFormat last.
  assert.equal(error(schema, { slug: "BAD", name: null }), "slug must be lowercase alphanumeric segments separated by hyphens");
  assert.equal(error(schema, { passMarkPct: 101, officialFormat: "75" }), "passMarkPct must be a number from 0 to 100, or null");
});

test("the official mock format accepts a whole format or null and names the first bad field", () => {
  const SAP = { questionCount: 75, timeLimitMinutes: 180, passCorrectCount: 54 };
  assert.equal(error(officialFormatSchema, null), null);
  assert.equal(error(officialFormatSchema, SAP), null);
  assert.equal(error(officialFormatSchema, { ...SAP, questionCount: 0 }), "officialFormat.questionCount must be a whole number from 1 to 200");
  assert.equal(error(officialFormatSchema, { ...SAP, questionCount: 201 }), "officialFormat.questionCount must be a whole number from 1 to 200");
  assert.equal(error(officialFormatSchema, { ...SAP, timeLimitMinutes: 1.5 }), "officialFormat.timeLimitMinutes must be a whole number from 1 to 600");
  assert.equal(error(officialFormatSchema, { ...SAP, passCorrectCount: 76 }), "officialFormat.passCorrectCount must be a whole number from 1 to questionCount");
  assert.equal(error(officialFormatSchema, { questionCount: 75, timeLimitMinutes: 180 }), "officialFormat.passCorrectCount must be a whole number from 1 to questionCount");
  assert.equal(error(officialFormatSchema, "75"), "officialFormat must be an object or null");
  assert.equal(error(updateExamRequestSchema, { officialFormat: { ...SAP, timeLimitMinutes: 601 } }), "officialFormat.timeLimitMinutes must be a whole number from 1 to 600");
});
