import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Hono } from "hono";

const { outputFiles } = await build({
  stdin: {
    contents: `export * from './src/routes/attempts.ts';
      export * from './src/lib/authorizeIdentity.ts';
      export * from './src/lib/session.ts';
      export * from './src/routes/auth.ts';
      export * from './src/routes/ai.ts';
      export * from './src/routes/questions.ts';
      export * from './src/routes/imports.ts';
      export * from './src/lib/questionMutationAudit.ts';
      export * from './src/scheduled/pruneContentMutationAudit.ts';`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, platform: "browser", format: "esm", mainFields: ["browser", "module", "main"],
});
const {
  attemptsRouter, examAttemptsRouter, authorizeIdentity, authRouter,
  createSessionToken, verifySessionToken, aiGenerateRouter, questionAiExplanationsRouter,
  questionsRouter, importsRouter, AUDIT_TARGETS_PER_ROW,
  runContentMutationAuditPrune, AUDIT_RETENTION_MS,
} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
questionsRouter.onError((_error, c) => c.json({ error: "Fixture write failed" }, 500));

const migrations = new URL("../../../migrations/", import.meta.url);
const schema = readdirSync(migrations).filter((n) => n.endsWith(".sql") && !n.startsWith("0002_"))
  .sort().map((n) => readFileSync(new URL(n, migrations), "utf8")).join("\n");

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(schema);
  for (const id of ["alice", "bob"]) {
    sqlite.prepare("INSERT INTO users(id,email,role,status,created_at) VALUES (?,?,'user','active','2026-01-01')").run(id, `${id}@example.test`);
  }
  sqlite.exec("INSERT INTO exams(id,slug,name,created_at) VALUES ('exam','exam','Exam','2026-01-01')");
  for (let i = 0; i < 101; i++) {
    sqlite.prepare("INSERT INTO questions(id,exam_id,type,stem,correct_answers_json,sequence_number,created_at,updated_at) VALUES (?,'exam','fill_blank','Synthetic question','[\"yes\"]',?,'2026-01-01','2026-01-01')").run(`q${i}`, i + 1);
  }
  let readHook, batchHook;
  const DB = {
    prepare(sql) {
      const methods = (args) => {
        assert.ok(args.length <= 100, "D1 permits at most 100 bound parameters per statement");
        const select = /^\s*SELECT\b/i.test(sql);
        const execute = () => select
          ? { results: sqlite.prepare(sql).all(...args), meta: { changes: 0 } }
          : { results: [], meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } };
        return {
          execute,
          first: async () => {
            const row = sqlite.prepare(sql).get(...args) ?? null;
            if (readHook) await readHook(sql, row);
            return row;
          },
          run: async () => execute(),
          all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        };
      };
      return { bind: (...args) => methods(args), ...methods([]) };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      let results;
      try {
        results = statements.map((s) => s.execute());
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
      if (batchHook) { const hook = batchHook; batchHook = null; await hook(); }
      return results;
    },
  };
  const values = new Map();
  const deletedKeys = [];
  const env = {
    DB, AUTH_MODE: "cookie", SESSION_SECRET: "synthetic-test-session-key",
    KV: { get: async (k) => values.has(k) ? JSON.parse(values.get(k)) : null, put: async (k,v) => values.set(k,v), delete: async (k) => values.delete(k) },
    BUCKET: { delete: async (key) => { deletedKeys.push(key); }, put: async () => {}, list: async () => ({objects: [], truncated: false}) },
    IMPORT_VALIDATE_RATE_LIMITER: { limit: async () => ({success: true}) },
    IMPORT_EXECUTE_RATE_LIMITER: { limit: async () => ({success: true}) },
  };
  const app = new Hono();
  app.onError((_error, c) => c.json({ error: "Fixture request failed" }, 500));
  app.use("*", async (c, next) => { c.set("user", { id: c.req.header("x-user") ?? "alice", role: c.req.header("x-role") ?? "user" }); await next(); });
  app.route("/exams/:examId/attempts", examAttemptsRouter);
  app.route("/attempts", attemptsRouter);
  app.route("/generate", aiGenerateRouter);
  app.route("/questions/:questionId/ai-explanations", questionAiExplanationsRouter);
  app.route("/exams/:examId/questions", questionsRouter);
  app.route("/exams/:examId/import", importsRouter);
  const request = async (path, method = "GET", body, user = "alice", role = "user") => {
    const res = await app.request(`https://example.test${path}`, {
      method, headers: { "Content-Type": "application/json", "x-user": user, "x-role": role },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, { waitUntil: () => {}, passThroughOnException() {} });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  const synchronizeReads = (match) => {
    const ready = deferred(); let count = 0;
    readHook = async (sql) => {
      if (!match(sql) || count >= 2) return;
      if (++count === 2) ready.resolve();
      await ready.promise;
    };
  };
  return { sqlite, DB, env, request, values, deletedKeys, synchronizeReads,
    afterBatch: (hook) => { batchHook = hook; }, onRead: (hook) => { readHook = hook; } };
}

test("101-question mock starts and completes within D1's bound-parameter limit", async (t) => {
  const f = fixture(t);
  const start = await f.request("/exams/exam/attempts", "POST", { mode: "mock", questionIds: Array.from({ length: 101 }, (_, i) => `q${i}`) });
  assert.equal(start.status, 201);
  const result = await f.request(`/attempts/${start.body.attemptId}/complete`, "POST");
  assert.equal(result.status, 200);
  assert.equal(result.body.totalQuestions, 101);
  assert.equal(result.body.breakdown.length, 101);
});

test("concurrent mock starts keep a single active attempt", async (t) => {
  const f = fixture(t);
  // Park both requests on the last read before the write, so the guarded
  // INSERT is the only thing deciding the race — there is no preceding
  // "is one already open?" SELECT left for either to have won.
  f.synchronizeReads((sql) => sql.startsWith("SELECT COUNT(*) AS n FROM questions"));
  const result = await Promise.all([1,2].map(() => f.request("/exams/exam/attempts", "POST", { mode: "mock", questionIds: ["q0"] })));
  assert.deepEqual(result.map((r) => r.status).sort(), [201,409]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM attempts").get().n, 1);
  // The loser is told which attempt to resume, not just that it lost.
  assert.equal(result.find(r => r.status === 409).body.attemptId, f.sqlite.prepare("SELECT id FROM attempts").get().id);
});

test("an attempt cannot exceed the size its submission batch is bounded to", async (t) => {
  const f = fixture(t);
  // 201 DISTINCT ids: the cap applies after deduplication, and is checked
  // before the ownership lookup those ids would otherwise each have to pass.
  const tooMany = await f.request("/exams/exam/attempts", "POST", { mode: "mock", questionIds: Array.from({ length: 201 }, (_, i) => `q${i}`) });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /at most 200 questions/);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM attempts").get().n, 0);
  // Deduplication happens first: 201 ids naming 101 distinct questions is fine.
  assert.equal((await f.request("/exams/exam/attempts", "POST", { mode: "mock", questionIds: [...Array.from({ length: 101 }, (_, i) => `q${i}`), "q0"] })).status, 201);
});

test("flagging a question during submission does not invalidate it", async (t) => {
  const f = fixture(t);
  const start = await f.request("/exams/exam/attempts", "POST", { mode: "mock", questionIds: ["q0"] });
  const id = start.body.attemptId;
  await f.request(`/attempts/${id}/answers/q0`, "PUT", { selectedAnswer: ["yes"] });
  f.onRead(async (sql) => {
    if (sql !== "SELECT * FROM attempts WHERE id = ?") return;
    f.onRead(null);
    assert.equal((await f.request(`/attempts/${id}/flags/q0`, "PUT", { flagged: true })).status, 200);
  });
  // Flags are not graded, so unlike a draft answer they must not force a retry.
  const result = await f.request(`/attempts/${id}/complete`, "POST");
  assert.equal(result.status, 200);
  assert.equal(result.body.score, 100);
});

test("concurrent answers and flags preserve both question keys", async (t) => {
  const f = fixture(t);
  const start = await f.request("/exams/exam/attempts", "POST", { mode: "mock", questionIds: ["q0","q1"] });
  const id = start.body.attemptId;
  for (const [part, body] of [["answers", { selectedAnswer: ["yes"] }], ["flags", { flagged: true }]]) {
    f.synchronizeReads((sql) => sql === "SELECT * FROM attempts WHERE id = ?");
    const result = await Promise.all(["q0","q1"].map((qid) => f.request(`/attempts/${id}/${part}/${qid}`, "PUT", body)));
    assert.deepEqual(result.map((r) => r.status), [200,200]);
  }
  const row = f.sqlite.prepare("SELECT * FROM attempts WHERE id = ?").get(id);
  assert.deepEqual(JSON.parse(row.draft_answers_json), { q0: ["yes"], q1: ["yes"] });
  assert.deepEqual(JSON.parse(row.flagged_json), { q0: true, q1: true });
});

test("concurrent completion grades once and does not regrade after an answer correction", async (t) => {
  const f = fixture(t);
  const start = await f.request("/exams/exam/attempts", "POST", { mode: "mock", questionIds: ["q0"] });
  const id = start.body.attemptId;
  await f.request(`/attempts/${id}/answers/q0`, "PUT", { selectedAnswer: ["wrong"] });
  f.synchronizeReads((sql) => sql === "SELECT * FROM attempts WHERE id = ?");
  const results = await Promise.all([1,2].map(() => f.request(`/attempts/${id}/complete`, "POST")));
  assert.deepEqual(results.map((r) => r.status), [200,200]);
  assert.equal(f.sqlite.prepare("SELECT wrong_count FROM wrong_question_book").get().wrong_count, 1);
  f.sqlite.exec("UPDATE questions SET correct_answers_json='[\"wrong\"]', answer_revision=2 WHERE id='q0'");
  const retry = await f.request(`/attempts/${id}/complete`, "POST");
  assert.equal(retry.body.score, 0);
  assert.deepEqual(retry.body.breakdown[0].gradedAnswers, ["yes"]);
});

test("a draft saved after submission's read is retained and requires retry", async (t) => {
  const f = fixture(t);
  const start = await f.request("/exams/exam/attempts", "POST", { mode: "mock", questionIds: ["q0"] });
  const id = start.body.attemptId;
  f.onRead(async (sql) => {
    if (sql !== "SELECT * FROM attempts WHERE id = ?") return;
    f.onRead(null);
    assert.equal((await f.request(`/attempts/${id}/answers/q0`, "PUT", { selectedAnswer: ["yes"] })).status, 200);
  });
  assert.equal((await f.request(`/attempts/${id}/complete`, "POST")).status, 409);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM attempt_answers").get().n, 0);
  assert.equal((await f.request(`/attempts/${id}/complete`, "POST")).body.score, 100);
  assert.equal((await f.request(`/attempts/${id}/answers/q0`, "PUT", { selectedAnswer: [] })).status, 409);
});

test("concurrent practice answers cannot double-count a wrong answer", async (t) => {
  const f = fixture(t);
  const start = await f.request("/exams/exam/attempts", "POST", { mode: "practice", questionIds: ["q0"] });
  f.synchronizeReads((sql) => sql.startsWith("SELECT aa.is_correct"));
  const result = await Promise.all([1,2].map(() => f.request(`/attempts/${start.body.attemptId}/answers`, "POST", { questionId: "q0", selectedAnswer: ["wrong"] })));
  // Both callers are told the same recorded grading; only one row was written.
  assert.deepEqual(result.map((r) => r.status), [200,200]);
  assert.deepEqual(result.map((r) => r.body.isCorrect), [false,false]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM attempt_answers").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT wrong_count FROM wrong_question_book").get().wrong_count, 1);
});

test("a retried practice answer replays the stored grading instead of stranding the client", async (t) => {
  const f = fixture(t);
  const start = await f.request("/exams/exam/attempts", "POST", { mode: "practice", questionIds: ["q0"] });
  const id = start.body.attemptId;
  const first = await f.request(`/attempts/${id}/answers`, "POST", { questionId: "q0", selectedAnswer: ["yes"] });
  assert.equal(first.status, 200);
  assert.equal(first.body.isCorrect, true);

  // The answer key moves after grading. A replay has to stay consistent with
  // the isCorrect it already reported, so it answers from graded_answers_json.
  f.sqlite.exec("UPDATE questions SET correct_answers_json='[\"no\"]', answer_revision=2 WHERE id='q0'");
  const retry = await f.request(`/attempts/${id}/answers`, "POST", { questionId: "q0", selectedAnswer: ["yes"] });
  assert.equal(retry.status, 200);
  assert.deepEqual([retry.body.isCorrect, retry.body.correctAnswers, retry.body.answerRevision], [true, ["yes"], 1]);

  // Replaying is not revising: a different answer still cannot overwrite it.
  const revise = await f.request(`/attempts/${id}/answers`, "POST", { questionId: "q0", selectedAnswer: ["no"] });
  assert.equal(revise.body.isCorrect, true);
  assert.deepEqual(JSON.parse(f.sqlite.prepare("SELECT selected_answer_json s FROM attempt_answers").get().s), ["yes"]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM attempt_answers").get().n, 1);

  // A completed attempt has nothing to replay for an unanswered question.
  await f.request(`/attempts/${id}/complete`, "POST");
  assert.equal((await f.request(`/attempts/${id}/answers`, "POST", { questionId: "q1", selectedAnswer: ["yes"] })).status, 409);
});

for (const status of ["invited", "active"]) {
  test(`profile completion cannot reactivate a revoked ${status} user`, async (t) => {
    const f = fixture(t);
    f.sqlite.prepare("UPDATE users SET status=? WHERE id='alice'").run(status);
    const result = await authorizeIdentity(f.env, { provider: "google", subject: "synthetic-sub", email: "alice@example.test" }, async () => {
      f.sqlite.exec("UPDATE users SET status='revoked' WHERE id='alice'");
      return { name: "Alice", picture: null };
    });
    assert.equal(result.ok, false);
    assert.equal(f.sqlite.prepare("SELECT status FROM users WHERE id='alice'").get().status, "revoked");
    assert.equal(f.values.size, 0);
  });
}

test("activation caches the committed profile and role", async (t) => {
  const f = fixture(t);
  const result = await authorizeIdentity(f.env, { provider: "google", subject: "synthetic-sub", email: "alice@example.test" }, async () => {
    f.sqlite.exec("UPDATE users SET role='admin', display_name='Custom', avatar_url='/custom.png' WHERE id='alice'");
    return { name: "Provider", picture: "/provider.png" };
  });
  assert.deepEqual([result.user.role, result.user.displayName, result.user.avatarUrl], ["admin", "Custom", "/custom.png"]);
});

test("malformed cookies are unauthenticated and valid signed sessions still work", async (t) => {
  const f = fixture(t);
  for (const cookie of ["pd_session=%", "pd_session=alice.0.!", "pd_session=alice.0."]) {
    const result = await authRouter.request("https://example.test/me", { headers: { Cookie: cookie } }, f.env);
    assert.equal(result.status, 401);
  }
  const token = await createSessionToken("alice", 0, f.env);
  assert.deepEqual(await verifySessionToken(token, f.env), { userId: "alice", sessionVersion: 0 });
});

test("slow generation preserves a winning manual edit and returns actual ownership", async (t) => {
  const f = fixture(t);
  const gates = [deferred(), deferred()];
  const started = deferred(); let calls = 0;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    const index = calls++;
    if (calls === 2) started.resolve();
    return Response.json({ choices: [{ message: { content: await gates[index].promise } }] });
  };
  const payload = { questionId: "q0", provider: "openai", model: "synthetic", apiKey: "synthetic" };
  const first = f.request("/generate", "POST", payload, "alice");
  const second = f.request("/generate", "POST", { ...payload, force: true }, "bob");
  await started.promise;
  gates[0].resolve("Generated by Alice");
  assert.equal((await first).status, 200);
  assert.equal((await f.request("/questions/q0/ai-explanations/openai/synthetic", "PATCH", { content: "Corrected manually" })).status, 200);
  gates[1].resolve("Generated by Bob");
  const result = await second;
  assert.equal(result.status, 200);
  assert.equal(result.body.explanation.content, "Corrected manually");
  assert.equal(result.body.explanation.canManage, false);
  assert.equal(result.body.cached, true);
});

test("authorized force generation detects a manual edit made during the upstream request", async (t) => {
  const f = fixture(t);
  f.sqlite.exec("INSERT INTO ai_explanations(question_id,provider,model,content,generated_at,created_by,updated_at) VALUES ('q0','openai','synthetic','Original','2026-01-01','alice','2026-01-01')");
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    assert.equal((await f.request("/questions/q0/ai-explanations/openai/synthetic", "PATCH", { content: "Manual edit" })).status, 200);
    return Response.json({ choices: [{ message: { content: "Late regeneration" } }] });
  };
  const result = await f.request("/generate", "POST", { questionId: "q0", provider: "openai", model: "synthetic", apiKey: "synthetic", force: true });
  assert.equal(result.status, 409);
  assert.equal(f.sqlite.prepare("SELECT content FROM ai_explanations").get().content, "Manual edit");
});

test("manual authoring and imports persist actor, entry point, targets and outcomes without content", async (t) => {
  const f = fixture(t);
  const write = (path, method, body) => f.request(path, method, body, "alice", "admin");
  const payload = { type: "fill_blank", stem: "Private synthetic question", correctAnswers: ["yes"] };
  const created = await write("/exams/exam/questions", "POST", payload);
  assert.equal(created.status, 201);
  const q = created.body.question;
  assert.equal((await write(`/exams/exam/questions/${q.id}`, "PATCH", { expectedRevision: q.revision, stem: "Corrected synthetic question" })).status, 200);
  assert.equal((await write(`/exams/exam/questions/${q.id}`, "PATCH", { expectedRevision: q.revision, stem: "Stale edit" })).status, 409);
  assert.equal((await write(`/exams/exam/questions/${q.id}`, "DELETE")).status, 204);
  const file = { schemaVersion: "1.0", exam: { id: "exam", name: "Exam" }, questions: [{ ...payload, externalId: "IMPORTED" }] };
  assert.equal((await write("/exams/exam/import", "POST", file)).status, 201);
  assert.equal((await write("/exams/exam/import", "POST", file)).status, 201);
  const rows = f.sqlite.prepare("SELECT v.* FROM content_mutation_audit v JOIN question_mutation_audit_log q ON q.id=v.id ORDER BY q.rowid").all();
  assert.deepEqual(rows.map((r) => [r.entry_point,r.action,r.outcome]), [
    ["admin_api","create","success"], ["admin_api","update","success"], ["admin_api","update","failure"],
    ["admin_api","delete","success"], ["import_api","create","success"], ["import_api","update","skipped"],
  ]);
  assert.ok(rows.every((r) => r.admin_user_id === "alice" && JSON.parse(r.target_ids_json).length === 1));
  assert.doesNotMatch(JSON.stringify(rows), /Private synthetic|Corrected synthetic|Stale edit|Bearer/);
});

test("a thousand unchanged import rows aggregate into bounded audit records", async (t) => {
  const f = fixture(t);
  const file = { schemaVersion: "1.0", exam: { id: "exam", name: "Exam" }, questions: Array.from({ length: 1000 }, (_, index) => ({
    type: "fill_blank", stem: `Synthetic question ${index}`, correctAnswers: ["yes"], externalId: `IMPORT-${index}`,
  })) };
  assert.equal((await f.request("/exams/exam/import", "POST", file, "alice", "admin")).status, 201);
  const questionIds = f.sqlite.prepare("SELECT id FROM questions WHERE external_id LIKE 'IMPORT-%'").all().map(r => r.id);
  assert.equal(questionIds.length, 1000);
  const batchSizes = [];
  const batch = f.DB.batch.bind(f.DB);
  f.DB.batch = statements => { batchSizes.push(statements.length); return batch(statements); };
  const result = await f.request("/exams/exam/import", "POST", file, "alice", "admin");
  assert.equal(result.status, 201);
  assert.equal(result.body.skipped, 1000);

  // A no-op re-import must not cost one audit row per unchanged question: the
  // rows are collapsed, but every question is still named and accounted for.
  const skipped = f.sqlite.prepare("SELECT target_ids_json, detail_json FROM question_mutation_audit_log WHERE outcome='skipped'").all();
  const expectedRows = Math.ceil(1000 / AUDIT_TARGETS_PER_ROW);
  assert.ok(expectedRows < 1000, "aggregation has to actually collapse rows");
  assert.equal(skipped.length, expectedRows);
  assert.deepEqual(skipped.map(r => JSON.parse(r.detail_json)),
    Array(expectedRows).fill({ reason: "identical", count: AUDIT_TARGETS_PER_ROW }));
  const audited = skipped.flatMap(r => JSON.parse(r.target_ids_json));
  assert.deepEqual([...audited].sort(), [...questionIds].sort());
  assert.ok(batchSizes.every(count => count <= 50), "audit batches stay within D1_STATEMENTS_PER_BATCH");
});

test("failed authoring transaction leaves no question or successful audit", async (t) => {
  const f = fixture(t);
  f.sqlite.exec("CREATE TRIGGER reject_test_link BEFORE INSERT ON question_tag_links BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  const before = f.sqlite.prepare("SELECT COUNT(*) n FROM questions").get().n;
  const result = await f.request("/exams/exam/questions", "POST", { type: "fill_blank", stem: "New", correctAnswers: ["yes"], tags: ["fail"] }, "alice", "admin");
  assert.equal(result.status, 500);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM questions").get().n, before);
  assert.deepEqual(f.sqlite.prepare("SELECT outcome FROM question_mutation_audit_log").all().map((r) => r.outcome), ["failure"]);
});

test("audit retention prunes both sides of the unified view past the window", async (t) => {
  const f = fixture(t);
  const day = 24 * 60 * 60 * 1000;
  const nowMs = Date.UTC(2026, 8, 19);
  f.sqlite.prepare("INSERT INTO mcp_credentials(id,user_id,server,name,token_hash,created_at) VALUES ('cred','alice','admin','synthetic',?,1)")
    .run("a".repeat(64));
  const seed = (table, extra, values) => (id, ageDays) =>
    f.sqlite.prepare(`INSERT INTO ${table}(id,occurred_at,admin_user_id,${extra}action,exam_id,target_ids_json,outcome)
      VALUES (?,?,'alice',${values}'update','exam','[]','success')`).run(id, nowMs - ageDays * day);
  const seedBrowser = seed("question_mutation_audit_log", "entry_point,", "'admin_api',");
  const seedMcp = seed("admin_mcp_audit_log", "credential_id,tool,", "'cred','admin_update_question',");
  const window = AUDIT_RETENTION_MS / day;
  for (const [table, insert] of [["question_mutation_audit_log", seedBrowser], ["admin_mcp_audit_log", seedMcp]]) {
    insert(`${table}-fresh`, 1);
    insert(`${table}-edge`, window - 1);
    insert(`${table}-expired`, window + 1);
  }

  const result = await runContentMutationAuditPrune(f.env, () => nowMs);
  assert.equal(result.deleted, 2);
  // Both entry points age out together: a view that unioned a pruned table
  // with an unpruned one would under-report one of them for the same period.
  const remaining = f.sqlite.prepare("SELECT id FROM content_mutation_audit ORDER BY id").all().map(r => r.id);
  assert.deepEqual(remaining, [
    "admin_mcp_audit_log-edge", "admin_mcp_audit_log-fresh",
    "question_mutation_audit_log-edge", "question_mutation_audit_log-fresh",
  ]);
  // Idempotent: a second sweep over an already-pruned table is a no-op.
  assert.deepEqual(await runContentMutationAuditPrune(f.env, () => nowMs), { deleted: 0 });
});
