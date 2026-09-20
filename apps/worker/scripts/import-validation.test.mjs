import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Hono } from "hono";

const [{ text }] = (await build({
  entryPoints: [fileURLToPath(new URL("../src/routes/imports.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], write: false,
})).outputFiles;
const { importsRouter } = await import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);
const app = new Hono();
app.use("*", async (c, next) => { c.set("user", { id: "admin", role: "admin" }); await next(); });
app.route("/exams/:examId/import", importsRouter);

function environment(existing = []) {
  const writes = [], archives = [], pending = [];
  return {
    writes, archives, pending,
    context: { waitUntil: (promise) => pending.push(promise), passThroughOnException() {} },
    bindings: {
      IMPORT_VALIDATE_RATE_LIMITER: { limit: async () => ({ success: true }) },
      IMPORT_EXECUTE_RATE_LIMITER: { limit: async () => ({ success: true }) },
      KV: { delete: async () => {} },
      BUCKET: {
        put: async (...args) => archives.push(args),
        list: async () => ({ objects: [], truncated: false }),
      },
      DB: {
        prepare(sql) {
          return {
            sql, values: [],
            bind(...values) { this.values = values; return this; },
            first: async () => sql.includes("MAX(sequence_number)") ? { max_seq: 4 } : { id: "exam" },
            all: async () => ({ results: existing }),
            run: async () => {},
          };
        },
        batch: async (statements) => writes.push(...statements),
      },
    },
  };
}
const question = { externalId: "Q1", type: "single_choice", stem: "Which value is even?",
  options: [{ id: "A", text: "2" }, { id: "B", text: "3" }], correctAnswers: ["A"] };
function request(path, questions, env) {
  return app.request(`https://test/exams/exam/import${path}`, {
    method: "POST", body: JSON.stringify({ schemaVersion: "1.0", exam: { id: "exam", name: "Exam" }, questions }),
    headers: { "Content-Type": "application/json" },
  }, env.bindings, env.context);
}

test("duplicate IDs invalidate the preview and cannot reach writes or archives", async () => {
  const env = environment();
  const preview = await request("/validate", [question, question], env);
  const result = await preview.json();
  assert.equal(result.valid, false);
  assert.deepEqual(result.duplicateExternalIdsInFile, ["Q1"]);
  for (const strategy of ["skip", "overwrite"]) {
    const response = await request(`?duplicateStrategy=${strategy}`, [question, question], env);
    assert.equal(response.status, 422);
  }
  assert.deepEqual(env.writes, []);
  assert.deepEqual(env.archives, []);
});

test("single-choice answer cardinality is enforced by the actual import endpoint", async () => {
  const env = environment();
  const response = await request("", [{ ...question, correctAnswers: ["A", "B"] }], env);
  assert.equal(response.status, 422);
  assert.deepEqual(env.writes, []);
});

for (const strategy of ["skip", "overwrite"]) {
  test(`legacy ${strategy} preserves a differing existing question and lists a conflict`, async () => {
    const env = environment([{ id: "existing-question", exam_id: "exam", external_id: "Q1", type: "single_choice", stem: "Edited stem",
      options_json: JSON.stringify(question.options), correct_answers_json: '["A"]', tags_json: '[]', points: 1,
      explanation: null, difficulty: null, revision: 2, answer_revision: 1, answer_revised_at: null, import_baseline_json: null }]);
    const response = await request(`?duplicateStrategy=${strategy}`, [question], env);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.created, 0);
    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.conflicts[0].questionId, "existing-question");
    assert.equal(result.conflicts[0].differences[0].field, "stem");
    assert.equal(env.writes.length, 1);
    assert.match(env.writes[0].sql, /^INSERT INTO question_mutation_audit_log/);
    assert.ok(env.writes[0].values.includes("failure"));
    assert.equal(env.archives.length, 1);
    await Promise.all(env.pending);
  });
}
