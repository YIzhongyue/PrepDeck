import assert from "node:assert/strict";
import test from "node:test";

import {
  IMPORT_BODY_MAX_BYTES,
  IMPORT_JSON_MAX_DEPTH,
  parseJsonBody,
  runD1Batches,
} from "../src/lib/importSecurity.ts";
import { IMPORT_LIMITS, validateImportFile } from "../../../packages/shared/src/import-validate.ts";

const question = (overrides = {}) => ({
  externalId: "q-1",
  type: "single_choice",
  stem: "Question?",
  options: [{ id: "A", text: "Answer" }],
  correctAnswers: ["A"],
  ...overrides,
});

const file = (questions) => ({ schemaVersion: "1.0", exam: { id: "exam", name: "Exam" }, questions });

test("parseJsonBody accepts a missing Content-Length", async () => {
  const result = await parseJsonBody(new Request("https://test/import", { method: "POST", body: "{}" }));
  assert.equal(result.ok, true);
});

test("parseJsonBody rejects forged Content-Length values", async () => {
  const request = new Request("https://test/import", {
    method: "POST",
    headers: { "content-length": "1" },
    body: "{}",
  });
  const result = await parseJsonBody(request);
  assert.deepEqual(result, { ok: false, status: 400, error: "Content-Length does not match the request body" });
});

test("parseJsonBody enforces its byte limit while streaming despite a small header", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(IMPORT_BODY_MAX_BYTES));
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
  const request = new Request("https://test/import", {
    method: "POST",
    headers: { "content-length": "1" },
    body,
    duplex: "half",
  });
  const result = await parseJsonBody(request);
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
});

test("parseJsonBody rejects deeply nested JSON", async () => {
  const raw = "[".repeat(IMPORT_JSON_MAX_DEPTH + 1) + "]".repeat(IMPORT_JSON_MAX_DEPTH + 1);
  const result = await parseJsonBody(new Request("https://test/import", { method: "POST", body: raw }));
  assert.equal(result.ok, false);
  assert.match(result.error, /nesting/);
});

test("validation bounds many small questions and duplicate ids", () => {
  const tooMany = Array.from({ length: IMPORT_LIMITS.maxQuestions + 1 }, (_, i) => question({ externalId: `q-${i}` }));
  const manyResult = validateImportFile(file(tooMany));
  assert.equal(manyResult.questionCount, IMPORT_LIMITS.maxQuestions + 1);
  assert.match(manyResult.issues[0].message, /at most/);

  const duplicateResult = validateImportFile(file([question(), question()]));
  assert.deepEqual(duplicateResult.duplicateExternalIdsInFile, ["q-1"]);
});

test("validation bounds question text, options, tags, and explanation", () => {
  const result = validateImportFile(file([question({
    stem: "s".repeat(IMPORT_LIMITS.maxStemLength + 1),
    options: Array.from({ length: IMPORT_LIMITS.maxOptions + 1 }, (_, i) => ({
      id: String(i),
      text: "o".repeat(IMPORT_LIMITS.maxOptionTextLength + 1),
    })),
    correctAnswers: ["0"],
    tags: Array.from({ length: IMPORT_LIMITS.maxTags + 1 }, () => "tag"),
    explanation: "e".repeat(IMPORT_LIMITS.maxExplanationLength + 1),
  })]));
  const paths = new Set(result.issues.map((issue) => issue.path));
  assert(paths.has("$.questions[0].stem"));
  assert(paths.has("$.questions[0].options"));
  assert(paths.has("$.questions[0].options[0].text"));
  assert(paths.has("$.questions[0].tags"));
  assert(paths.has("$.questions[0].explanation"));
});

test("D1 writes use fixed batches and stop after a mid-import failure", async () => {
  const sizes = [];
  const db = {
    async batch(statements) {
      sizes.push(statements.length);
      if (sizes.length === 2) throw new Error("D1 unavailable");
    },
  };
  await assert.rejects(() => runD1Batches(db, Array.from({ length: 120 }, () => ({}))), /D1 unavailable/);
  assert.deepEqual(sizes, [50, 50]);
});
