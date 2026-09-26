import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

// implementation — User MCP learning, history, and question discovery tools.
// Same harness shape as mcp-foundation.test.mjs (real worker entry + MCP SDK,
// bundled for Node via esbuild's "workerd" export condition, backed by an
// in-memory node:sqlite DB behind a D1-shaped shim) but, since these tools
// collectively touch nearly every table in the schema, seeded from every
// migration file rather than a curated subset (mcp-tokens.test.mjs's
// approach) so nothing is silently missing.
const [{ text }] = (await build({
  stdin: {
    contents: `export { default as worker } from './src/index.ts';
      export * from './src/mcp/credentials.ts';`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, format: "esm", platform: "node", conditions: ["workerd"], write: false,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
})).outputFiles;
const buildDir = await mkdtemp(join(tmpdir(), "prepdeck-mcp-user-learning-test-"));
after(() => rm(buildDir, { recursive: true, force: true }));
const bundlePath = join(buildDir, "worker.mjs");
await writeFile(bundlePath, text);
const { worker, issueMcpCredential } = await import(pathToFileURL(bundlePath).href);

// Every migration except 0002, which (unlike the rest) seeds real exam/
// question content rather than defining schema — including it would pollute
// every fixture with a pre-existing exam that trips up list/count assertions.
const migrationsDir = new URL("../../../migrations/", import.meta.url);
const migrationFiles = (await readdir(migrationsDir))
  .filter((n) => n.endsWith(".sql") && n !== "0002_seed_sap_c02_questions.sql")
  .sort();
const schema = (await Promise.all(migrationFiles.map((name) => readFile(new URL(name, migrationsDir), "utf8")))).join("\n");

const NO_SIDE_EFFECT_TABLES = ["attempts", "attempt_answers", "wrong_question_book", "bookmarks", "learning_progress", "annotations"];

// D1 documents a 100-bound-parameter limit per statement
// (https://developers.cloudflare.com/d1/platform/limits/). The real D1
// binding enforces it; a hand-rolled node:sqlite shim otherwise wouldn't,
// silently letting a query that binds e.g. one parameter per excluded id
// regress without any test noticing. Enforced here so any query built by
// the code under test that exceeds it fails loudly, the same way it would
// against real D1.
const D1_MAX_BOUND_PARAMETERS = 100;

async function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(schema);
  for (const [id, role] of [["alice", "user"], ["bob", "user"], ["admin", "admin"]]) {
    sqlite.prepare("INSERT INTO users (id, email, role, status, created_at) VALUES (?, ?, ?, 'active', ?)")
      .run(id, `${id}@example.test`, role, new Date().toISOString());
  }
  const queries = [];
  const DB = { prepare(sql) {
    const methodsFor = (args) => {
      if (args.length > D1_MAX_BOUND_PARAMETERS) {
        throw new Error(`D1_ERROR: too many SQL variables (${args.length} bound, ${D1_MAX_BOUND_PARAMETERS} max)`);
      }
      return {
        first: async () => { queries.push({ sql, args }); return sqlite.prepare(sql).get(...args) ?? null; },
        run: async () => { queries.push({ sql, args }); return { meta: { changes: sqlite.prepare(sql).run(...args).changes } }; },
        all: async () => { queries.push({ sql, args }); return { results: sqlite.prepare(sql).all(...args) }; },
      };
    };
    return { bind: (...args) => methodsFor(args), ...methodsFor([]) };
  } };
  DB.batch = async (statements) => {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  };
  const kvStore = new Map();
  const env = {
    DB, ENVIRONMENT: "production", APP_BASE_URL: "https://prepdeck.test", AUTH_MODE: "cookie",
    KV: {
      get: async (key, type) => { const v = kvStore.get(key); return v === undefined ? null : (type === "json" ? JSON.parse(v) : v); },
      put: async (key, value) => { kvStore.set(key, value); },
      delete: async (key) => { kvStore.delete(key); },
    },
    RATE_LIMITER: { idFromName: (key) => key, get: () => ({ fetch: async () => Response.json({ allowed: true, retryAfter: 60 }) }) },
    BUCKET: { put: async () => {}, get: async () => null, list: async () => ({ objects: [], truncated: false }), delete: async () => {} },
    IMPORT_VALIDATE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    IMPORT_EXECUTE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  const expiresAt = Date.now() + 60_000;
  const alice = await issueMcpCredential(DB, { userId: "alice", audience: "user", name: "alice's token", expiresAt });
  const bob = await issueMcpCredential(DB, { userId: "bob", audience: "user", name: "bob's token", expiresAt });
  return { sqlite, DB, env, kvStore, queries, alice, bob };
}

function rpc(env, token, method, params, options = {}) {
  const headers = new Headers({
    "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25", "CF-Connecting-IP": "192.0.2.1",
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers,
  });
  return worker.fetch(new Request(`${env.APP_BASE_URL}/mcp`, {
    method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), env);
}

async function payload(response) {
  const body = await response.text();
  if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    return JSON.parse(body.split("\n").find((line) => line.startsWith("data: ")).slice(6));
  }
  return JSON.parse(body);
}

async function callUserTool(f, token, name, args = {}) {
  const result = (await payload(await rpc(f.env, token, "tools/call", { name, arguments: args }))).result;
  assert.equal(result.isError, undefined, `${name} unexpectedly failed: ${JSON.stringify(result)}`);
  return result.structuredContent.data;
}

async function callUserToolExpectingError(f, token, name, args = {}) {
  const result = (await payload(await rpc(f.env, token, "tools/call", { name, arguments: args }))).result;
  assert.equal(result.isError, true, `${name} unexpectedly succeeded: ${JSON.stringify(result)}`);
  return result.structuredContent.error;
}

// --- Seed helpers (raw SQL — same style mcp-foundation.test.mjs uses to
// seed users directly) -------------------------------------------------------

function insertExam(f, { id, slug, name, archivedAt = null, passMarkPct = null }) {
  f.sqlite.prepare(
    "INSERT INTO exams (id, slug, name, created_at, archived_at, pass_mark_pct) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, slug, name, new Date().toISOString(), archivedAt, passMarkPct);
}

// implementation — tags no longer live in a tags_json column; register-if-missing
// against question_bank_tags (same case-insensitive identity the app uses)
// and link via question_tag_links instead.
function seedQuestionTags(f, questionId, tagNames) {
  const now = new Date().toISOString();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    const normalized = name.toLowerCase();
    let tag = f.sqlite.prepare("SELECT id FROM question_bank_tags WHERE normalized_name = ?").get(normalized);
    if (!tag) {
      const id = crypto.randomUUID();
      f.sqlite.prepare(
        "INSERT INTO question_bank_tags (id, name, normalized_name, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      ).run(id, name, normalized, now, now);
      tag = { id };
    }
    f.sqlite.prepare("INSERT OR IGNORE INTO question_tag_links (question_id, tag_id) VALUES (?, ?)").run(questionId, tag.id);
  }
}

let questionSeq = 0;
function insertQuestion(f, {
  id, examId, type = "single_choice", stem, options = null, correctAnswers = ["a"],
  difficulty = null, tags = [], sequenceNumber,
}) {
  questionSeq += 1;
  const now = new Date().toISOString();
  f.sqlite.prepare(
    `INSERT INTO questions (id, exam_id, external_id, type, stem, options_json, correct_answers_json, explanation,
       difficulty, points, created_at, updated_at, sequence_number, revision, answer_revision)
     VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, 1, ?, ?, ?, 1, 1)`,
  ).run(id, examId, type, stem, options ? JSON.stringify(options) : null, JSON.stringify(correctAnswers),
    difficulty, now, now, sequenceNumber ?? questionSeq);
  seedQuestionTags(f, id, tags);
}

function insertAttempt(f, {
  id, userId, examId, mode = "practice", startedAt, completedAt = null, score = null,
  totalQuestions = null, questionIds = [],
}) {
  f.sqlite.prepare(
    `INSERT INTO attempts (id, user_id, exam_id, mode, started_at, completed_at, duration_seconds, score,
       total_questions, question_ids_json, time_limit_seconds, draft_answers_json, flagged_json)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL)`,
  ).run(id, userId, examId, mode, startedAt, completedAt, score, totalQuestions, JSON.stringify(questionIds));
}

function insertAttemptAnswer(f, { id, attemptId, questionId, selectedAnswer = [], isCorrect, answeredAt }) {
  f.sqlite.prepare(
    `INSERT INTO attempt_answers (id, attempt_id, question_id, selected_answer_json, is_correct, time_spent_seconds, answered_at, answer_revision, graded_answers_json)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 1, NULL)`,
  ).run(id, attemptId, questionId, JSON.stringify(selectedAnswer), isCorrect ? 1 : 0, answeredAt);
}

function insertWrong(f, { userId, questionId, wrongCount = 1, lastWrongAt, mastered = 0 }) {
  f.sqlite.prepare(
    "INSERT INTO wrong_question_book (user_id, question_id, wrong_count, last_wrong_at, mastered) VALUES (?, ?, ?, ?, ?)",
  ).run(userId, questionId, wrongCount, lastWrongAt, mastered);
}

function insertBookmark(f, { userId, questionId, createdAt }) {
  f.sqlite.prepare("INSERT INTO bookmarks (user_id, question_id, created_at) VALUES (?, ?, ?)")
    .run(userId, questionId, createdAt);
}

function insertAnnotation(f, { id, userId, questionId, style = "hl1", createdAt }) {
  f.sqlite.prepare(
    `INSERT INTO annotations (id, user_id, question_id, target_type, target_ref, range_start, range_end, style, note, created_at, updated_at)
     VALUES (?, ?, ?, 'stem', NULL, 0, 5, ?, NULL, ?, ?)`,
  ).run(id, userId, questionId, style, createdAt, createdAt);
}

function dumpTables(f) {
  return Object.fromEntries(NO_SIDE_EFFECT_TABLES.map((t) => [t, f.sqlite.prepare(`SELECT * FROM ${t}`).all()]));
}

// --- Cross-user isolation ----------------------------------------------------

test("implementation: every tool scopes strictly to the caller — one user's attempts, bookmarks, wrong-book, and annotations never leak to another", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1", stem: "Alice question" });
  insertQuestion(f, { id: "q2", examId: "exam1", stem: "Bob question" });

  insertAttempt(f, { id: "a-alice", userId: "alice", examId: "exam1", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:05:00.000Z", score: 100, totalQuestions: 1, questionIds: ["q1"] });
  insertAttemptAnswer(f, { id: "aa-alice", attemptId: "a-alice", questionId: "q1", selectedAnswer: ["a"], isCorrect: true, answeredAt: "2026-01-01T00:04:00.000Z" });
  insertAttempt(f, { id: "a-bob", userId: "bob", examId: "exam1", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:05:00.000Z", score: 0, totalQuestions: 1, questionIds: ["q2"] });
  insertAttemptAnswer(f, { id: "aa-bob", attemptId: "a-bob", questionId: "q2", selectedAnswer: ["b"], isCorrect: false, answeredAt: "2026-01-01T00:04:00.000Z" });

  insertWrong(f, { userId: "alice", questionId: "q1", lastWrongAt: "2026-01-02T00:00:00.000Z" });
  insertWrong(f, { userId: "bob", questionId: "q2", lastWrongAt: "2026-01-02T00:00:00.000Z" });
  insertBookmark(f, { userId: "alice", questionId: "q1", createdAt: "2026-01-03T00:00:00.000Z" });
  insertBookmark(f, { userId: "bob", questionId: "q2", createdAt: "2026-01-03T00:00:00.000Z" });
  insertAnnotation(f, { id: "an-alice", userId: "alice", questionId: "q1", createdAt: "2026-01-04T00:00:00.000Z" });
  insertAnnotation(f, { id: "an-bob", userId: "bob", questionId: "q2", createdAt: "2026-01-04T00:00:00.000Z" });

  const aliceAttempts = await callUserTool(f, f.alice.token, "user_list_attempts", {});
  assert.deepEqual(aliceAttempts.items.map((a) => a.id), ["a-alice"]);
  const bobAttempts = await callUserTool(f, f.bob.token, "user_list_attempts", {});
  assert.deepEqual(bobAttempts.items.map((a) => a.id), ["a-bob"]);

  // alice cannot fetch bob's attempt by id (not_found, not a different code —
  // existence isn't leaked, mirroring loadOwnAttempt's rationale in routes/attempts.ts).
  assert.equal((await callUserToolExpectingError(f, f.alice.token, "user_get_attempt", { id: "a-bob" })).code, "not_found");
  const aliceOwn = await callUserTool(f, f.alice.token, "user_get_attempt", { id: "a-alice" });
  assert.equal(aliceOwn.attempt.id, "a-alice");

  const aliceWrong = await callUserTool(f, f.alice.token, "user_get_wrong_questions", {});
  assert.deepEqual(aliceWrong.items.map((e) => e.question.id), ["q1"]);
  const aliceBookmarks = await callUserTool(f, f.alice.token, "user_get_bookmarked_questions", {});
  assert.deepEqual(aliceBookmarks.items.map((e) => e.question.id), ["q1"]);
  const aliceAnnotations = await callUserTool(f, f.alice.token, "user_list_annotations", {});
  assert.deepEqual(aliceAnnotations.items.map((a) => a.id), ["an-alice"]);

  const bobWrong = await callUserTool(f, f.bob.token, "user_get_wrong_questions", {});
  assert.deepEqual(bobWrong.items.map((e) => e.question.id), ["q2"]);
  const bobAnnotationsForQ1 = await callUserTool(f, f.bob.token, "user_get_annotations_for_question", { questionId: "q1" });
  assert.deepEqual(bobAnnotationsForQ1.items, []); // bob has no annotation on alice's question

  const aliceOverview = await callUserTool(f, f.alice.token, "user_get_learning_overview", {});
  assert.deepEqual(aliceOverview.exams.map((e) => e.examId), ["exam1"]);
  assert.equal(aliceOverview.exams[0].totalAttempted, 1);
  const bobProgress = await callUserTool(f, f.bob.token, "user_get_exam_progress", { examId: "exam1" });
  assert.equal(bobProgress.bookmarkedCount, 1);
  assert.equal(bobProgress.activeWrongCount, 1);
});

// --- Filter coverage ----------------------------------------------------------

test("implementation: get_practice_candidates ANDs unattemptedOnly/wrongOnly/bookmarkedOnly and respects type", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1", type: "single_choice", stem: "q1" }); // wrong + bookmarked, unattempted
  insertQuestion(f, { id: "q2", examId: "exam1", type: "single_choice", stem: "q2" }); // wrong only
  insertQuestion(f, { id: "q3", examId: "exam1", type: "true_false", stem: "q3" }); // bookmarked only, wrong type
  insertWrong(f, { userId: "alice", questionId: "q1", lastWrongAt: "2026-01-01T00:00:00.000Z" });
  insertWrong(f, { userId: "alice", questionId: "q2", lastWrongAt: "2026-01-01T00:00:00.000Z" });
  insertBookmark(f, { userId: "alice", questionId: "q1", createdAt: "2026-01-01T00:00:00.000Z" });
  insertBookmark(f, { userId: "alice", questionId: "q3", createdAt: "2026-01-01T00:00:00.000Z" });

  // wrongOnly + bookmarkedOnly (AND) -> only q1 satisfies both.
  const both = await callUserTool(f, f.alice.token, "user_get_practice_candidates", {
    examId: "exam1", wrongOnly: true, bookmarkedOnly: true, limit: 10,
  });
  assert.deepEqual(both.questions.map((q) => q.id), ["q1"]);

  // type filter excludes q3 even though it's bookmarked.
  const typed = await callUserTool(f, f.alice.token, "user_get_practice_candidates", {
    examId: "exam1", bookmarkedOnly: true, type: "true_false", limit: 10,
  });
  assert.deepEqual(typed.questions.map((q) => q.id), ["q3"]);

  // unattemptedOnly excludes nothing here (none attempted yet) but combined
  // with wrongOnly still yields exactly {q1, q2}.
  const unattemptedWrong = await callUserTool(f, f.alice.token, "user_get_practice_candidates", {
    examId: "exam1", unattemptedOnly: true, wrongOnly: true, limit: 10,
  });
  assert.deepEqual(new Set(unattemptedWrong.questions.map((q) => q.id)), new Set(["q1", "q2"]));
});

test("implementation: get_questions_for_review's source parameter selects wrong, bookmarked, or both", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1", stem: "q1" });
  insertQuestion(f, { id: "q2", examId: "exam1", stem: "q2" });
  insertWrong(f, { userId: "alice", questionId: "q1", lastWrongAt: "2026-01-01T00:00:00.000Z" });
  insertBookmark(f, { userId: "alice", questionId: "q2", createdAt: "2026-01-01T00:00:00.000Z" });

  const wrongOnly = await callUserTool(f, f.alice.token, "user_get_questions_for_review", { examId: "exam1", source: "wrong", limit: 10 });
  assert.deepEqual(wrongOnly.questions.map((q) => q.id), ["q1"]);
  const bookmarkedOnly = await callUserTool(f, f.alice.token, "user_get_questions_for_review", { examId: "exam1", source: "bookmarked", limit: 10 });
  assert.deepEqual(bookmarkedOnly.questions.map((q) => q.id), ["q2"]);
  const bothSources = await callUserTool(f, f.alice.token, "user_get_questions_for_review", { examId: "exam1", source: "both", limit: 10 });
  assert.deepEqual(new Set(bothSources.questions.map((q) => q.id)), new Set(["q1", "q2"]));

  // Never leaks the answer key — these are pre-practice candidate pools.
  for (const q of bothSources.questions) assert.equal("correctAnswers" in q, false);
});

test("implementation: get_wrong_questions' includeMastered toggle", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1", stem: "q1" });
  insertQuestion(f, { id: "q2", examId: "exam1", stem: "q2" });
  insertWrong(f, { userId: "alice", questionId: "q1", lastWrongAt: "2026-01-01T00:00:00.000Z", mastered: 0 });
  insertWrong(f, { userId: "alice", questionId: "q2", lastWrongAt: "2026-01-01T00:00:00.000Z", mastered: 1 });

  const active = await callUserTool(f, f.alice.token, "user_get_wrong_questions", { examId: "exam1" });
  assert.deepEqual(active.items.map((e) => e.question.id), ["q1"]);
  const withMastered = await callUserTool(f, f.alice.token, "user_get_wrong_questions", { examId: "exam1", includeMastered: true });
  assert.deepEqual(new Set(withMastered.items.map((e) => e.question.id)), new Set(["q1", "q2"]));
});

// --- Strict dedup for get_recommended_questions ------------------------------

test("implementation: get_recommended_questions never returns the same question twice, even across sources", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  // q1 is BOTH wrong-booked and bookmarked — a naive union could double-count it.
  insertQuestion(f, { id: "q1", examId: "exam1", stem: "q1" });
  insertQuestion(f, { id: "q2", examId: "exam1", stem: "q2" });
  insertWrong(f, { userId: "alice", questionId: "q1", lastWrongAt: "2026-01-01T00:00:00.000Z" });
  insertBookmark(f, { userId: "alice", questionId: "q1", createdAt: "2026-01-01T00:00:00.000Z" });
  insertBookmark(f, { userId: "alice", questionId: "q2", createdAt: "2026-01-01T00:00:00.000Z" });

  const recommended = await callUserTool(f, f.alice.token, "user_get_recommended_questions", { examId: "exam1", limit: 5 });
  const ids = recommended.questions.map((q) => q.id);
  assert.deepEqual(ids, [...new Set(ids)], "no duplicate ids across the blended wrong/bookmarked/unattempted passes");
  assert.deepEqual(new Set(ids), new Set(["q1", "q2"]));
});

// --- Pagination stability (same timestamp) -----------------------------------

test("implementation: get_bookmarked_questions paginates stably when bookmarks share a timestamp", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  const ids = ["q1", "q2", "q3", "q4", "q5"];
  for (const id of ids) insertQuestion(f, { id, examId: "exam1", stem: id });
  for (const id of ids) insertBookmark(f, { userId: "alice", questionId: id, createdAt: "2026-01-01T00:00:00.000Z" });

  const seen = [];
  let offset = 0;
  for (let i = 0; i < 10; i++) {
    const page = await callUserTool(f, f.alice.token, "user_get_bookmarked_questions", { examId: "exam1", limit: 2, offset });
    seen.push(...page.items.map((e) => e.question.id));
    if (page.nextOffset == null) break;
    offset = page.nextOffset;
  }
  assert.deepEqual(seen, ids, "walking every page yields each id exactly once, in a stable order");
});

test("implementation: list_annotations paginates stably when annotations share a timestamp", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1", stem: "q1" });
  const annIds = ["an1", "an2", "an3", "an4"];
  for (const id of annIds) insertAnnotation(f, { id, userId: "alice", questionId: "q1", createdAt: "2026-01-01T00:00:00.000Z" });

  const seen = [];
  let offset = 0;
  for (let i = 0; i < 10; i++) {
    const page = await callUserTool(f, f.alice.token, "user_list_annotations", { limit: 2, offset });
    seen.push(...page.items.map((a) => a.id));
    if (page.nextOffset == null) break;
    offset = page.nextOffset;
  }
  assert.deepEqual(seen, annIds);
});

// --- Visibility ---------------------------------------------------------------

test("implementation: archived exams are reachable by id but excluded from list_exams", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Active" });
  insertExam(f, { id: "exam2", slug: "exam-2", name: "Archived", archivedAt: "2026-01-01T00:00:00.000Z" });

  const list = await callUserTool(f, f.alice.token, "user_list_exams", {});
  assert.deepEqual(list.exams.map((e) => e.id), ["exam1"]);

  const archived = await callUserTool(f, f.alice.token, "user_get_exam", { id: "exam2" });
  assert.equal(archived.exam.id, "exam2");
});

test("implementation: get_question 404s when the questionId/examId pair don't correspond", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertExam(f, { id: "exam2", slug: "exam-2", name: "Exam Two" });
  insertQuestion(f, { id: "q1", examId: "exam1", stem: "q1" });

  const ok = await callUserTool(f, f.alice.token, "user_get_question", { examId: "exam1", id: "q1" });
  assert.equal(ok.question.id, "q1");
  assert.equal(
    (await callUserToolExpectingError(f, f.alice.token, "user_get_question", { examId: "exam2", id: "q1" })).code,
    "not_found",
  );
});

test("implementation: user_search_questions/user_get_question return the full answer key (confirmed product decision)", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1", stem: "q1", correctAnswers: ["a"] });

  const got = await callUserTool(f, f.alice.token, "user_get_question", { examId: "exam1", id: "q1" });
  assert.deepEqual(got.question.correctAnswers, ["a"]);
  const found = await callUserTool(f, f.alice.token, "user_search_questions", { examId: "exam1" });
  assert.deepEqual(found.questions[0].correctAnswers, ["a"]);
});

// --- Bounding -------------------------------------------------------------------

test("implementation: get_learning_stats paginates mockScoreHistory instead of returning it unbounded", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One", passMarkPct: 70 });
  for (let i = 0; i < 5; i++) {
    insertAttempt(f, {
      id: `mock-${i}`, userId: "alice", examId: "exam1", mode: "mock",
      startedAt: `2026-01-0${i + 1}T00:00:00.000Z`, completedAt: `2026-01-0${i + 1}T01:00:00.000Z`,
      score: 50 + i, totalQuestions: 10, questionIds: [],
    });
  }
  const page1 = await callUserTool(f, f.alice.token, "user_get_learning_stats", { examId: "exam1", limit: 2, offset: 0 });
  assert.equal(page1.mockScoreHistory.length, 2);
  assert.equal(page1.mockScoreHistoryNextOffset, 2);
  const page2 = await callUserTool(f, f.alice.token, "user_get_learning_stats", { examId: "exam1", limit: 2, offset: 2 });
  assert.equal(page2.mockScoreHistory.length, 2);
  const page3 = await callUserTool(f, f.alice.token, "user_get_learning_stats", { examId: "exam1", limit: 2, offset: 4 });
  assert.equal(page3.mockScoreHistory.length, 1);
  assert.equal(page3.mockScoreHistoryNextOffset, null);
  const allIds = [...page1.mockScoreHistory, ...page2.mockScoreHistory, ...page3.mockScoreHistory].map((m) => m.attemptId);
  assert.deepEqual(allIds, ["mock-0", "mock-1", "mock-2", "mock-3", "mock-4"]);
});

test("implementation: get_attempt paginates its breakdown for attempts with many questions", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  const questionIds = [];
  for (let i = 0; i < 5; i++) {
    const id = `q${i}`;
    questionIds.push(id);
    insertQuestion(f, { id, examId: "exam1", stem: id, sequenceNumber: i + 1 });
  }
  insertAttempt(f, {
    id: "attempt1", userId: "alice", examId: "exam1", mode: "mock",
    startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T01:00:00.000Z",
    score: 100, totalQuestions: 5, questionIds,
  });
  for (const id of questionIds) {
    insertAttemptAnswer(f, { id: `aa-${id}`, attemptId: "attempt1", questionId: id, selectedAnswer: ["a"], isCorrect: true, answeredAt: "2026-01-01T00:30:00.000Z" });
  }

  const page1 = await callUserTool(f, f.alice.token, "user_get_attempt", { id: "attempt1", breakdownLimit: 2, breakdownOffset: 0 });
  assert.equal(page1.breakdown.length, 2);
  assert.equal(page1.breakdownNextOffset, 2);
  assert.deepEqual(page1.breakdown.map((b) => b.questionId), ["q0", "q1"]);
  const page3 = await callUserTool(f, f.alice.token, "user_get_attempt", { id: "attempt1", breakdownLimit: 2, breakdownOffset: 4 });
  assert.equal(page3.breakdown.length, 1);
  assert.equal(page3.breakdownNextOffset, null);
  assert.equal(page1.attempt.id, "attempt1");
  // passed recomputed against the exam's pass mark (no pass_mark_pct set -> null)
  assert.equal(page1.passed, null);
});

// --- No-side-effect reads -----------------------------------------------------

test("implementation: reads never mutate attempts, attempt_answers, wrong_question_book, bookmarks, learning_progress, or annotations", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One", passMarkPct: 70 });
  insertQuestion(f, { id: "q1", examId: "exam1", stem: "q1" });
  insertQuestion(f, { id: "q2", examId: "exam1", stem: "q2" });
  insertAttempt(f, { id: "a1", userId: "alice", examId: "exam1", mode: "practice", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:10:00.000Z", score: 100, totalQuestions: 1, questionIds: ["q1"] });
  insertAttemptAnswer(f, { id: "aa1", attemptId: "a1", questionId: "q1", selectedAnswer: ["a"], isCorrect: true, answeredAt: "2026-01-01T00:05:00.000Z" });
  insertWrong(f, { userId: "alice", questionId: "q2", lastWrongAt: "2026-01-01T00:00:00.000Z" });
  insertBookmark(f, { userId: "alice", questionId: "q1", createdAt: "2026-01-01T00:00:00.000Z" });
  insertAnnotation(f, { id: "an1", userId: "alice", questionId: "q1", createdAt: "2026-01-01T00:00:00.000Z" });
  f.sqlite.prepare("INSERT INTO learning_progress (user_id, exam_id, last_sequence_number, updated_at) VALUES (?, ?, ?, ?)")
    .run("alice", "exam1", 1, "2026-01-01T00:00:00.000Z");

  const before = dumpTables(f);

  // A representative mix of successful reads, an invalid-input call, and a
  // cross-user (not_found) call — mcp_credentials' last-used-at bump and the
  // stats-cache KV write are legitimate, already-known side effects and are
  // intentionally excluded from this table-content comparison.
  await callUserTool(f, f.alice.token, "user_list_attempts", {});
  await callUserTool(f, f.alice.token, "user_get_attempt", { id: "a1" });
  await callUserTool(f, f.alice.token, "user_get_wrong_questions", {});
  await callUserTool(f, f.alice.token, "user_get_bookmarked_questions", {});
  await callUserTool(f, f.alice.token, "user_list_annotations", {});
  await callUserTool(f, f.alice.token, "user_get_learning_overview", {});
  await callUserTool(f, f.alice.token, "user_get_exam_progress", { examId: "exam1" });
  await callUserTool(f, f.alice.token, "user_get_learning_stats", { examId: "exam1" });
  await callUserTool(f, f.alice.token, "user_get_recommended_questions", { examId: "exam1", limit: 5 });
  await callUserToolExpectingError(f, f.alice.token, "user_search_questions", { examId: "exam1", type: "not_a_real_type" });
  await callUserToolExpectingError(f, f.bob.token, "user_get_attempt", { id: "a1" }); // cross-user, not_found

  assert.deepEqual(dumpTables(f), before, "no read tool call may change stored attempts/answers/wrong-book/bookmarks/progress/annotations");
});

// --- Regressions from implementation review (D1 parameter-budget and unbounded-window bugs) ---

test("implementation review: get_recommended_questions stays within D1's parameter budget even when the wrong-book pass alone nearly fills the request", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  const allIds = [];
  for (let i = 0; i < 100; i++) {
    const id = `q${i}`;
    allIds.push(id);
    insertQuestion(f, { id, examId: "exam1", stem: id, sequenceNumber: i + 1 });
  }
  // 98 of the 100 questions are wrong-booked — the wrong-book pass alone
  // returns 98 candidates, so the SUBSEQUENT bookmarked/unattempted passes
  // must exclude all 98 of them. Before the json_each() fix, that exclusion
  // was one bound SQL parameter per excluded id, which combined with examId/
  // userId/limit would have exceeded D1's documented 100-parameter cap for
  // this entirely ordinary, schema-valid request.
  for (let i = 0; i < 98; i++) insertWrong(f, { userId: "alice", questionId: `q${i}`, lastWrongAt: "2026-01-01T00:00:00.000Z" });

  const result = await callUserTool(f, f.alice.token, "user_get_recommended_questions", { examId: "exam1", limit: 100 });
  const ids = result.questions.map((q) => q.id);
  assert.equal(ids.length, 100, "wrong-book (98) + the 2 remaining unattempted questions fill the requested 100");
  assert.deepEqual(ids, [...new Set(ids)], "no duplicates across passes");
  assert.deepEqual(new Set(ids), new Set(allIds));
});

test("implementation review: get_learning_overview bounds its exam-metadata lookup to one parameter regardless of how many exams are represented", async (t) => {
  const f = await fixture(t);
  // 105 distinct exams, each touched only via a bookmark — enough to blow
  // past D1's 100-bound-parameter limit on a naive `WHERE id IN (?,?,...)`
  // lookup of every represented exam's metadata, which ran BEFORE the
  // MAX_OVERVIEW_EXAMS=50 truncation could ever reduce the working set.
  const examCount = 105;
  for (let i = 0; i < examCount; i++) {
    const examId = `ov-exam-${i}`;
    insertExam(f, { id: examId, slug: `ov-exam-${i}`, name: `Overview Exam ${i}` });
    insertQuestion(f, { id: `ov-q-${i}`, examId, stem: `q${i}` });
    insertBookmark(f, { userId: "alice", questionId: `ov-q-${i}`, createdAt: "2026-01-01T00:00:00.000Z" });
  }

  const overview = await callUserTool(f, f.alice.token, "user_get_learning_overview", { days: 84 });
  assert.equal(overview.exams.length, 50, "bounded to MAX_OVERVIEW_EXAMS after ranking every represented exam");
  assert.equal(overview.truncated, true);
});

test("implementation review: get_learning_stats' accuracyTrend keeps the LATEST activity, not the oldest, once history exceeds the cap", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1", stem: "q1" });

  const totalDays = 400; // > MAX_TREND_POINTS (366)
  const startMs = Date.parse("2025-01-01T00:00:00.000Z");
  const dateAt = (i) => new Date(startMs + i * 86_400_000).toISOString().slice(0, 10);
  for (let i = 0; i < totalDays; i++) {
    const day = dateAt(i);
    insertAttempt(f, {
      id: `trend-${i}`, userId: "alice", examId: "exam1", mode: "practice",
      startedAt: `${day}T00:00:00.000Z`, completedAt: `${day}T00:00:00.000Z`,
      score: 100, totalQuestions: 1, questionIds: ["q1"],
    });
    insertAttemptAnswer(f, {
      id: `trend-aa-${i}`, attemptId: `trend-${i}`, questionId: "q1",
      selectedAnswer: ["a"], isCorrect: true, answeredAt: `${day}T00:00:00.000Z`,
    });
  }

  const stats = await callUserTool(f, f.alice.token, "user_get_learning_stats", { examId: "exam1", limit: 1, offset: 0 });
  assert.equal(stats.accuracyTrend.length, 366);
  assert.equal(stats.accuracyTrendTruncated, true);
  // The retained window is the LATEST 366 of the 400 days (indices 34..399,
  // 0-indexed from the oldest) — not the earliest 366 (indices 0..365), which
  // an ascending-order slice(0, cap) would have kept instead.
  assert.equal(stats.accuracyTrend[0].date, dateAt(34), "oldest day kept is the 366th-from-the-end, not day zero");
  assert.equal(stats.accuracyTrend[365].date, dateAt(399), "the most recent day is present and last");
  // Still in ascending chronological order within the kept window.
  const dates = stats.accuracyTrend.map((p) => p.date);
  assert.deepEqual(dates, [...dates].sort());
});

test("implementation review: get_learning_stats and get_exam_progress bound their reads at the SQL layer instead of computing full history", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One", passMarkPct: 70 });
  insertQuestion(f, { id: "q1", examId: "exam1", stem: "q1" });
  const totalMocks = 500;
  for (let i = 0; i < totalMocks; i++) {
    const day = `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`;
    insertAttempt(f, {
      id: `mock-${i}`, userId: "alice", examId: "exam1", mode: "mock",
      startedAt: `${day}T00:00:00.000Z`, completedAt: `${day}T01:00:00.000Z`,
      score: 50, totalQuestions: 1, questionIds: ["q1"],
    });
  }

  const stats = await callUserTool(f, f.alice.token, "user_get_learning_stats", { examId: "exam1", limit: 2, offset: 0 });
  assert.equal(stats.mockScoreHistory.length, 2);
  assert.equal(stats.mockScoreHistoryNextOffset, 2);

  // Inspect the actual bound SQL: the mock-history query's LIMIT parameter
  // must be small (limit + 1), not the full 500-row history — proving the
  // bound is applied inside the query, not by fetching everything and
  // slicing it in the Worker afterward.
  const mockQuery = f.queries.filter((q) => q.sql.includes("mode = 'mock'")).at(-1);
  assert.ok(mockQuery, "expected a mock-history query to have run");
  assert.equal(mockQuery.args.at(-2), 3, "LIMIT bound should be mockLimit + 1 (3), not the full row count");

  await callUserTool(f, f.alice.token, "user_get_exam_progress", { examId: "exam1" });

  // Neither tool goes through the REST dashboard's cached, full-history
  // computeExamStats/getOrComputeExamStats path — a KV write would mean it
  // materialized (and cached) the entire history just to answer a bounded
  // or summary-only request.
  assert.equal(f.kvStore.size, 0, "get_learning_stats/get_exam_progress must not use the full-history KV cache");
});

test("issue #40: the learning overview counts graded answers of a practice session that was never ended", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1", type: "single_choice", stem: "q1" });
  insertQuestion(f, { id: "q2", examId: "exam1", type: "single_choice", stem: "q2" });
  insertAttempt(f, { id: "open", userId: "alice", examId: "exam1", startedAt: "2026-01-01T00:00:00.000Z", questionIds: ["q1", "q2"] });
  insertAttemptAnswer(f, { id: "aa1", attemptId: "open", questionId: "q1", isCorrect: true, answeredAt: "2026-01-01T00:01:00.000Z" });
  insertAttemptAnswer(f, { id: "aa2", attemptId: "open", questionId: "q2", isCorrect: false, answeredAt: "2026-01-01T00:02:00.000Z" });
  // An open mock has no graded answers yet and must still not count.
  insertAttempt(f, { id: "mock", userId: "alice", examId: "exam1", mode: "mock", startedAt: "2026-01-02T00:00:00.000Z", questionIds: ["q1"] });

  const overview = await callUserTool(f, f.alice.token, "user_get_learning_overview", {});
  assert.deepEqual(overview.exams.map((e) => [e.examId, e.totalAttempted, e.overallAccuracyPct, e.lastAttemptAt]),
    [["exam1", 2, 50, "2026-01-01T00:02:00.000Z"]]);
});
