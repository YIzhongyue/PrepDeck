import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { Hono } from "hono";

// implementation — User MCP Knowledge Points tools. Same harness shape as
// mcp-user-learning.test.mjs (real worker entry + MCP SDK, bundled for Node
// via esbuild's "workerd" export condition, backed by an in-memory
// node:sqlite DB behind a D1-shaped shim), extended with a lightweight REST
// app mounting the same three knowledgePoints* route modules directly (same
// technique as mcp-tokens.test.mjs) so REST-level regressions and a
// REST+MCP mixed scenario can be exercised against the exact same
// underlying database, proving the shared lib layer (lib/knowledgePoint*.ts)
// behaves identically regardless of caller.
const [{ text }] = (await build({
  stdin: {
    contents: `export { default as worker } from './src/index.ts';
      export * from './src/mcp/credentials.ts';
      export { knowledgePointsRouter } from './src/routes/knowledgePoints.ts';
      export { knowledgePointGroupsRouter } from './src/routes/knowledgePointGroups.ts';
      export { knowledgePointTagsRouter } from './src/routes/knowledgePointTags.ts';
      export { kpImagesRouter } from './src/routes/kpImages.ts';`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, format: "esm", platform: "node", conditions: ["workerd"], write: false,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
})).outputFiles;
const buildDir = await mkdtemp(join(tmpdir(), "prepdeck-mcp-user-kp-test-"));
after(() => rm(buildDir, { recursive: true, force: true }));
const bundlePath = join(buildDir, "worker.mjs");
await writeFile(bundlePath, text);
const { worker, issueMcpCredential, knowledgePointsRouter, knowledgePointGroupsRouter, knowledgePointTagsRouter, kpImagesRouter } = await import(pathToFileURL(bundlePath).href);

const migrationsDir = new URL("../../../migrations/", import.meta.url);
const migrationFiles = (await readdir(migrationsDir))
  .filter((n) => n.endsWith(".sql") && n !== "0002_seed_sap_c02_questions.sql")
  .sort();
const schema = (await Promise.all(migrationFiles.map((name) => readFile(new URL(name, migrationsDir), "utf8")))).join("\n");

const NO_SIDE_EFFECT_TABLES = ["attempts", "attempt_answers", "wrong_question_book", "bookmarks", "learning_progress"];
const D1_MAX_BOUND_PARAMETERS = 100;

const restApp = new Hono();
restApp.use("*", async (c, next) => {
  c.set("user", { id: c.req.header("x-user"), role: "user" });
  await next();
});
restApp.route("/api/knowledge-points", knowledgePointsRouter);
restApp.route("/api/knowledge-point-groups", knowledgePointGroupsRouter);
restApp.route("/api/knowledge-point-tags", knowledgePointTagsRouter);
// implementation — mounted so the cross-user attachment-isolation test below can
// exercise the actual protected route an MCP-returned image ref points at,
// not just the MCP tool call that returns the ref.
restApp.route("/api/kp-images", kpImagesRouter);

async function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(schema);
  for (const [id, role] of [["alice", "user"], ["bob", "user"], ["admin", "admin"]]) {
    sqlite.prepare("INSERT INTO users (id, email, role, status, created_at) VALUES (?, ?, ?, 'active', ?)")
      .run(id, `${id}@example.test`, role, new Date().toISOString());
  }
  const DB = { prepare(sql) {
    const methodsFor = (args) => {
      if (args.length > D1_MAX_BOUND_PARAMETERS) {
        throw new Error(`D1_ERROR: too many SQL variables (${args.length} bound, ${D1_MAX_BOUND_PARAMETERS} max)`);
      }
      return {
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
        run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        // Real D1's db.batch() supports mixed read/write statements and
        // returns populated `.results` for a SELECT the same way `.all()`
        // does — see mcp/adapter.ts's listNotes, which batches a row read
        // with a revision read for one consistent snapshot. `_isSelect`
        // lets DB.batch below pick the matching execution path per
        // statement instead of always using `.run()` (whose `{meta:{changes}}`
        // shape has no room for rows).
        _isSelect: /^\s*select\b/i.test(sql),
      };
    };
    return { bind: (...args) => methodsFor(args), ...methodsFor([]) };
  } };
  DB.batch = async (statements) => {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await (statement._isSelect ? statement.all() : statement.run()));
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  };
  const r2Objects = new Map();
  const BUCKET = {
    put: async (key, value) => { r2Objects.set(key, value); },
    get: async (key) => (r2Objects.has(key) ? { body: r2Objects.get(key) } : null),
    delete: async (key) => { r2Objects.delete(key); },
    list: async () => ({ objects: [], truncated: false }),
  };
  const env = {
    DB, BUCKET, ENVIRONMENT: "production", APP_BASE_URL: "https://prepdeck.test", AUTH_MODE: "cookie",
    KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    RATE_LIMITER: { idFromName: (key) => key, get: () => ({ fetch: async () => Response.json({ allowed: true, retryAfter: 60 }) }) },
    IMPORT_VALIDATE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    IMPORT_EXECUTE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  const expiresAt = Date.now() + 60_000;
  const alice = await issueMcpCredential(DB, { userId: "alice", audience: "user", name: "alice's token", expiresAt });
  const bob = await issueMcpCredential(DB, { userId: "bob", audience: "user", name: "bob's token", expiresAt });
  return { sqlite, DB, env, r2Objects, alice, bob };
}

// A stateful rate-limiter stub that actually counts per key (unlike the
// fixture's default always-allow stub) — used only by the rate-limit test.
function statefulRateLimiter() {
  const counts = new Map();
  return { idFromName: (key) => key, get: (key) => ({
    fetch: async (_url, init) => {
      const { max } = JSON.parse(init.body);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return Response.json({ allowed: count <= max, retryAfter: 60 });
    },
  }) };
}

function rpc(env, token, method, params) {
  const headers = new Headers({
    "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25", "CF-Connecting-IP": "192.0.2.1",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

async function callTool(f, token, name, args = {}) {
  const result = (await payload(await rpc(f.env, token, "tools/call", { name, arguments: args }))).result;
  assert.equal(result.isError, undefined, `${name} unexpectedly failed: ${JSON.stringify(result)}`);
  return result.structuredContent.data;
}

async function callToolExpectingError(f, token, name, args = {}) {
  const result = (await payload(await rpc(f.env, token, "tools/call", { name, arguments: args }))).result;
  assert.equal(result.isError, true, `${name} unexpectedly succeeded: ${JSON.stringify(result)}`);
  return result.structuredContent.error;
}

async function listTools(f, token) {
  return (await payload(await rpc(f.env, token, "tools/list", {}))).result.tools.map((t) => t.name);
}

async function restRequest(f, userId, method, path, body) {
  const response = await restApp.request(`https://prepdeck.test${path}`, {
    method, headers: { "x-user": userId, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }, f.env);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// --- Seed helpers -------------------------------------------------------------

function insertExam(f, { id, slug, name }) {
  f.sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)").run(id, slug, name, new Date().toISOString());
}

function insertQuestion(f, { id, examId, stem = id }) {
  const now = new Date().toISOString();
  f.sqlite.prepare(
    `INSERT INTO questions (id, exam_id, external_id, type, stem, options_json, correct_answers_json, explanation,
       difficulty, points, created_at, updated_at, sequence_number, revision, answer_revision)
     VALUES (?, ?, NULL, 'single_choice', ?, NULL, '["a"]', NULL, NULL, 1, ?, ?, 1, 1, 1)`
  ).run(id, examId, stem, now, now);
}

let kpSeq = 0;
function insertKnowledgePoint(f, { id, userId, groupId = null, title = "", bodyMarkdown = "", position, revision = 1, createdAt, updatedAt }) {
  kpSeq += 1;
  const now = createdAt ?? new Date().toISOString();
  f.sqlite.prepare(
    `INSERT INTO knowledge_points (id, user_id, group_id, title, body_markdown, excerpt, mermaid_count, position, revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', 0, ?, ?, ?, ?)`
  ).run(id, userId, groupId, title, bodyMarkdown, position ?? kpSeq * 1024, revision, now, updatedAt ?? now);
}

function insertGroup(f, { id, userId, name, createdAt }) {
  const now = createdAt ?? new Date().toISOString();
  f.sqlite.prepare("INSERT INTO knowledge_point_groups (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, userId, name, now, now);
}

function insertTag(f, { id, userId, name, createdAt }) {
  const now = createdAt ?? new Date().toISOString();
  f.sqlite.prepare("INSERT INTO knowledge_point_tags (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, userId, name, now, now);
}

function linkTag(f, { knowledgePointId, tagId }) {
  f.sqlite.prepare("INSERT INTO knowledge_point_tag_links (knowledge_point_id, tag_id) VALUES (?, ?)").run(knowledgePointId, tagId);
}

function insertQuestionLink(f, { knowledgePointId, questionId, createdAt }) {
  f.sqlite.prepare("INSERT INTO knowledge_point_question_links (knowledge_point_id, question_id, created_at) VALUES (?, ?, ?)")
    .run(knowledgePointId, questionId, createdAt ?? new Date().toISOString());
}

function insertImage(f, { id, userId, knowledgePointId, r2ObjectKey, status = "attached" }) {
  const now = new Date().toISOString();
  f.sqlite.prepare(
    `INSERT INTO knowledge_point_images (id, user_id, knowledge_point_id, r2_object_key, content_type, byte_size, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'image/png', 100, ?, ?, ?)`
  ).run(id, userId, knowledgePointId, r2ObjectKey, status, now, now);
  f.r2Objects.set(r2ObjectKey, "fake-bytes");
}

function dumpTables(f) {
  return Object.fromEntries(NO_SIDE_EFFECT_TABLES.map((t) => [t, f.sqlite.prepare(`SELECT * FROM ${t}`).all()]));
}

// --- CRUD -----------------------------------------------------------------

test("implementation: create defaults to a blank note; get round-trips it", async (t) => {
  const f = await fixture(t);
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  assert.equal(created.knowledgePoint.title, "");
  assert.equal(created.knowledgePoint.bodyMarkdown, "");
  assert.equal(created.knowledgePoint.groupId, null);
  assert.equal(created.knowledgePoint.revision, 1);

  const fetched = await callTool(f, f.alice.token, "user_get_knowledge_point", { id: created.knowledgePoint.id });
  assert.deepEqual(fetched.knowledgePoint, created.knowledgePoint);
});

test("implementation: create with an owned group succeeds; with another user's group id, not_found", async (t) => {
  const f = await fixture(t);
  insertGroup(f, { id: "g-alice", userId: "alice", name: "Alice Group" });
  insertGroup(f, { id: "g-bob", userId: "bob", name: "Bob Group" });

  const ok = await callTool(f, f.alice.token, "user_create_knowledge_point", { groupId: "g-alice" });
  assert.equal(ok.knowledgePoint.groupId, "g-alice");

  const err = await callToolExpectingError(f, f.alice.token, "user_create_knowledge_point", { groupId: "g-bob" });
  assert.equal(err.code, "not_found");
});

test("implementation: create can seed title/body/tags/linked questions atomically", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1" });
  insertTag(f, { id: "t-existing", userId: "alice", name: "AWS" });

  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {
    title: "SCPs vs IAM", bodyMarkdown: "A comparison.",
    tagNames: ["aws", "Needs Review"], linkedQuestionIds: ["q1"],
  });
  assert.equal(created.knowledgePoint.title, "SCPs vs IAM");
  assert.equal(created.knowledgePoint.bodyMarkdown, "A comparison.");
  // "aws" matches the existing "AWS" tag case-insensitively; "Needs Review" is newly minted.
  assert.deepEqual(new Set(created.knowledgePoint.tags.map((t) => t.name)), new Set(["AWS", "Needs Review"]));
  assert.deepEqual(created.knowledgePoint.linkedQuestions.map((q) => q.questionId), ["q1"]);

  const tagCount = f.sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_point_tags WHERE user_id = 'alice'").get().n;
  assert.equal(tagCount, 2, "reused the existing AWS tag rather than minting a duplicate");
});

test("implementation: create rejects a nonexistent linked question or an invalid tag name before writing anything", async (t) => {
  const f = await fixture(t);
  assert.equal((await callToolExpectingError(f, f.alice.token, "user_create_knowledge_point", { linkedQuestionIds: ["missing"] })).code, "not_found");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_points").get().n, 0, "no partial note left behind");

  assert.equal((await callToolExpectingError(f, f.alice.token, "user_create_knowledge_point", { tagNames: ["   "] })).code, "invalid_input");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_points").get().n, 0);
});

test("implementation: update requires a matching baseRevision and never silently overwrites a stale write", async (t) => {
  const f = await fixture(t);
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", { title: "Original", bodyMarkdown: "Body v1" });
  const id = created.knowledgePoint.id;

  const updated = await callTool(f, f.alice.token, "user_update_knowledge_point", { id, baseRevision: 1, title: "Updated", bodyMarkdown: "Body v2" });
  assert.notEqual(updated.knowledgePoint.revision, 1, "revision must change on a successful update (opaque token, not necessarily 1+1)");
  assert.equal(updated.knowledgePoint.title, "Updated");

  // Same (now stale) baseRevision again — must be rejected, not silently applied.
  const conflict = await callToolExpectingError(f, f.alice.token, "user_update_knowledge_point", { id, baseRevision: 1, title: "Attacker overwrite", bodyMarkdown: "Body v3" });
  assert.equal(conflict.code, "conflict");

  const latest = await callTool(f, f.alice.token, "user_get_knowledge_point", { id });
  assert.equal(latest.knowledgePoint.title, "Updated", "the stale update must not have overwritten the successful one");
  assert.equal(latest.knowledgePoint.revision, updated.knowledgePoint.revision);
});

test("implementation: update supports partial edits and tri-state groupId (omit/null/id)", async (t) => {
  const f = await fixture(t);
  insertGroup(f, { id: "g1", userId: "alice", name: "Group One" });
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", { title: "T1", bodyMarkdown: "B1" });
  const id = created.knowledgePoint.id;

  // groupId omitted: content changes, group stays null.
  const r1 = await callTool(f, f.alice.token, "user_update_knowledge_point", { id, baseRevision: 1, title: "T2" });
  assert.equal(r1.knowledgePoint.title, "T2");
  assert.equal(r1.knowledgePoint.bodyMarkdown, "B1", "omitted bodyMarkdown left unchanged");
  assert.equal(r1.knowledgePoint.groupId, null);

  // groupId explicit string: moves to that group, content unaffected by omission.
  const r2 = await callTool(f, f.alice.token, "user_update_knowledge_point", { id, baseRevision: r1.knowledgePoint.revision, groupId: "g1" });
  assert.equal(r2.knowledgePoint.groupId, "g1");
  assert.equal(r2.knowledgePoint.title, "T2");

  // groupId explicit null: moves back to Ungrouped.
  const r3 = await callTool(f, f.alice.token, "user_update_knowledge_point", { id, baseRevision: r2.knowledgePoint.revision, groupId: null });
  assert.equal(r3.knowledgePoint.groupId, null);
});

test("implementation: update to another user's group id is not_found, and the note's own group is unchanged", async (t) => {
  const f = await fixture(t);
  insertGroup(f, { id: "g-bob", userId: "bob", name: "Bob Group" });
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  const err = await callToolExpectingError(f, f.alice.token, "user_update_knowledge_point", { id: created.knowledgePoint.id, baseRevision: 1, groupId: "g-bob" });
  assert.equal(err.code, "not_found");
  const after = await callTool(f, f.alice.token, "user_get_knowledge_point", { id: created.knowledgePoint.id });
  assert.equal(after.knowledgePoint.groupId, null);
  assert.equal(after.knowledgePoint.revision, 1, "the failed group move must not have bumped revision");
});

test("implementation: two legitimate sequential updates each reconcile images against their own body, never a stale one", async (t) => {
  const f = await fixture(t);
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  const id = created.knowledgePoint.id;
  insertImage(f, { id: "img1", userId: "alice", knowledgePointId: id, r2ObjectKey: "kp-images/alice/img1", status: "attached" });
  insertImage(f, { id: "img2", userId: "alice", knowledgePointId: id, r2ObjectKey: "kp-images/alice/img2", status: "attached" });

  // Update 1: body still references img1, drops img2. Revisions are opaque
  // (not sequential integers), so the next baseRevision is whatever this
  // call returns, never assumed.
  const r1 = await callTool(f, f.alice.token, "user_update_knowledge_point", { id, baseRevision: 1, bodyMarkdown: "See /api/kp-images/img1" });
  const statusesAfter1 = Object.fromEntries(r1.knowledgePoint.images.map((im) => [im.id, im.status]));
  assert.equal(statusesAfter1.img1, "attached");
  assert.equal(statusesAfter1.img2, "orphaned");

  // Update 2 (a second, independently valid update): body now references img2 instead.
  const r2 = await callTool(f, f.alice.token, "user_update_knowledge_point", { id, baseRevision: r1.knowledgePoint.revision, bodyMarkdown: "See /api/kp-images/img2" });
  const statusesAfter2 = Object.fromEntries(r2.knowledgePoint.images.map((im) => [im.id, im.status]));
  assert.equal(statusesAfter2.img2, "attached", "update 2's own body reference must win");
  assert.equal(statusesAfter2.img1, "orphaned");
});

test("implementation: delete removes the note but never its group, tags, or linked question", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1" });
  insertGroup(f, { id: "g1", userId: "alice", name: "Group One" });
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", { groupId: "g1", tagNames: ["Tag1"], linkedQuestionIds: ["q1"] });
  const id = created.knowledgePoint.id;

  await callTool(f, f.alice.token, "user_delete_knowledge_point", { id });
  assert.equal((await callToolExpectingError(f, f.alice.token, "user_get_knowledge_point", { id })).code, "not_found");

  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_point_groups WHERE id = 'g1'").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_point_tags WHERE user_id = 'alice'").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM questions WHERE id = 'q1'").get().n, 1);
});

// --- Ownership --------------------------------------------------------------

test("implementation: cross-user access to a note, group, or tag reads as not_found, never a different code", async (t) => {
  const f = await fixture(t);
  insertGroup(f, { id: "g-bob", userId: "bob", name: "Bob Group" });
  insertTag(f, { id: "t-bob", userId: "bob", name: "Bob Tag" });
  const bobNote = await callTool(f, f.bob.token, "user_create_knowledge_point", {});
  const id = bobNote.knowledgePoint.id;

  for (const [name, args] of [
    ["user_get_knowledge_point", { id }],
    ["user_update_knowledge_point", { id, baseRevision: 1, title: "hack" }],
    ["user_delete_knowledge_point", { id }],
    ["user_reorder_knowledge_points", { id, beforeId: null, expectedOrderRevision: 1 }],
    ["user_link_knowledge_point_question", { id, questionId: "q1" }],
    ["user_rename_knowledge_point_group", { id: "g-bob", name: "Renamed" }],
    ["user_delete_knowledge_point_group", { id: "g-bob" }],
    ["user_rename_knowledge_point_tag", { id: "t-bob", name: "Renamed" }],
    ["user_delete_knowledge_point_tag", { id: "t-bob" }],
  ]) {
    const err = await callToolExpectingError(f, f.alice.token, name, args);
    assert.equal(err.code, "not_found", `${name} should be not_found for another user's resource`);
  }

  const bobStillThere = await callTool(f, f.bob.token, "user_get_knowledge_point", { id });
  assert.equal(bobStillThere.knowledgePoint.title, "", "alice's failed attempts must not have touched bob's note");
});

test("implementation: list/search never surface another user's notes, and Admin MCP has no Knowledge Point tools", async (t) => {
  const f = await fixture(t);
  await callTool(f, f.alice.token, "user_create_knowledge_point", { title: "Alice note" });
  await callTool(f, f.bob.token, "user_create_knowledge_point", { title: "Bob note" });

  const aliceList = await callTool(f, f.alice.token, "user_list_knowledge_points", {});
  assert.deepEqual(aliceList.items.map((i) => i.title), ["Alice note"]);
  const aliceSearch = await callTool(f, f.alice.token, "user_search_knowledge_points", { q: "note" });
  assert.deepEqual(aliceSearch.items.map((i) => i.title), ["Alice note"]);

  const adminTools = await listTools(f, f.alice.token); // user token; admin catalog checked separately below
  assert.ok(adminTools.some((n) => n.startsWith("user_")));
  const adminCredential = await issueMcpCredential(f.DB, { userId: "admin", audience: "admin", name: "admin token", expiresAt: Date.now() + 60_000 });
  const adminToolsResponse = await worker.fetch(new Request(`${f.env.APP_BASE_URL}/admin-mcp`, {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25", "CF-Connecting-IP": "192.0.2.1", Authorization: `Bearer ${adminCredential.token}`,
    }),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }), f.env);
  const adminToolNames = (await payload(adminToolsResponse)).result.tools.map((t) => t.name);
  assert.ok(adminToolNames.every((n) => !n.includes("knowledge_point")), "Admin MCP must expose zero Knowledge Point tools");
});

// --- Filters ------------------------------------------------------------------

test("implementation: list filters by group, ungrouped, tags (AND), search text, and sort", async (t) => {
  const f = await fixture(t);
  insertGroup(f, { id: "g1", userId: "alice", name: "Group One" });
  insertTag(f, { id: "t1", userId: "alice", name: "aws" });
  insertTag(f, { id: "t2", userId: "alice", name: "networking" });
  insertKnowledgePoint(f, { id: "n1", userId: "alice", groupId: "g1", title: "AWS note", bodyMarkdown: "" });
  insertKnowledgePoint(f, { id: "n2", userId: "alice", groupId: null, title: "Ungrouped note", bodyMarkdown: "" });
  insertKnowledgePoint(f, { id: "n3", userId: "alice", groupId: "g1", title: "Both tags", bodyMarkdown: "" });
  linkTag(f, { knowledgePointId: "n1", tagId: "t1" });
  linkTag(f, { knowledgePointId: "n3", tagId: "t1" });
  linkTag(f, { knowledgePointId: "n3", tagId: "t2" });

  const byGroup = await callTool(f, f.alice.token, "user_list_knowledge_points", { groupId: "g1" });
  assert.deepEqual(new Set(byGroup.items.map((i) => i.id)), new Set(["n1", "n3"]));

  const ungrouped = await callTool(f, f.alice.token, "user_list_knowledge_points", { ungrouped: true });
  assert.deepEqual(ungrouped.items.map((i) => i.id), ["n2"]);

  const bothTags = await callTool(f, f.alice.token, "user_list_knowledge_points", { tagIds: ["t1", "t2"] });
  assert.deepEqual(bothTags.items.map((i) => i.id), ["n3"], "AND semantics — n1 has only t1");

  const search = await callTool(f, f.alice.token, "user_search_knowledge_points", { q: "AWS" });
  assert.deepEqual(search.items.map((i) => i.id), ["n1"]);

  const err = await callToolExpectingError(f, f.alice.token, "user_list_knowledge_points", { sort: "sideways" });
  assert.equal(err.code, "invalid_input");
});

test("implementation: get_knowledge_points_for_question reuses the list filter and stays owner-scoped", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1" });
  const aliceNote = await callTool(f, f.alice.token, "user_create_knowledge_point", { linkedQuestionIds: ["q1"] });
  await callTool(f, f.bob.token, "user_create_knowledge_point", { linkedQuestionIds: ["q1"] });

  const result = await callTool(f, f.alice.token, "user_get_knowledge_points_for_question", { questionId: "q1" });
  assert.deepEqual(result.items.map((i) => i.id), [aliceNote.knowledgePoint.id]);
});

// --- Relationships --------------------------------------------------------------

test("implementation: link/unlink question is idempotent and never touches attempts/bookmarks/wrong-book/progress", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  insertQuestion(f, { id: "q1", examId: "exam1" });
  const before = dumpTables(f);
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  const id = created.knowledgePoint.id;

  await callTool(f, f.alice.token, "user_link_knowledge_point_question", { id, questionId: "q1" });
  const linkedTwice = await callTool(f, f.alice.token, "user_link_knowledge_point_question", { id, questionId: "q1" });
  assert.equal(linkedTwice.knowledgePoint.linkedQuestions.length, 1, "relinking is a no-op, not a duplicate");

  assert.equal((await callToolExpectingError(f, f.alice.token, "user_link_knowledge_point_question", { id, questionId: "missing" })).code, "not_found");

  await callTool(f, f.alice.token, "user_unlink_knowledge_point_question", { id, questionId: "q1" });
  assert.equal((await callToolExpectingError(f, f.alice.token, "user_unlink_knowledge_point_question", { id, questionId: "q1" })).code, "not_found");

  assert.deepEqual(dumpTables(f), before, "linking/unlinking must never create attempts or change study statistics");
});

test("implementation: linking a question beyond the cap is rejected, but relinking an existing one at-cap still succeeds", async (t) => {
  const f = await fixture(t);
  insertExam(f, { id: "exam1", slug: "exam-1", name: "Exam One" });
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  const id = created.knowledgePoint.id;
  const ids = [];
  for (let i = 0; i < 200; i++) {
    const qid = `q${i}`;
    ids.push(qid);
    insertQuestion(f, { id: qid, examId: "exam1" });
    insertQuestionLink(f, { knowledgePointId: id, questionId: qid });
  }
  insertQuestion(f, { id: "q-overflow", examId: "exam1" });

  assert.equal((await callToolExpectingError(f, f.alice.token, "user_link_knowledge_point_question", { id, questionId: "q-overflow" })).code, "invalid_input");
  // Re-linking one already in the set succeeds even though the note is at capacity.
  const relinked = await callTool(f, f.alice.token, "user_link_knowledge_point_question", { id, questionId: ids[0] });
  assert.equal(relinked.knowledgePoint.linkedQuestions.length, 200);
});

test("implementation: create_knowledge_point_tag attaches by name (find-or-create, case-insensitive, idempotent)", async (t) => {
  const f = await fixture(t);
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  const id = created.knowledgePoint.id;

  const first = await callTool(f, f.alice.token, "user_create_knowledge_point_tag", { id, name: "AWS" });
  assert.deepEqual(first.knowledgePoint.tags.map((t) => t.name), ["AWS"]);
  const again = await callTool(f, f.alice.token, "user_create_knowledge_point_tag", { id, name: "aws" });
  assert.equal(again.knowledgePoint.tags.length, 1, "case-insensitive match reuses the same tag, no duplicate catalog row");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_point_tags WHERE user_id = 'alice'").get().n, 1);
});

test("implementation: unlink_knowledge_point_tag detaches from one note without deleting the tag or its other links", async (t) => {
  const f = await fixture(t);
  insertTag(f, { id: "t1", userId: "alice", name: "Shared" });
  const n1 = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  const n2 = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  linkTag(f, { knowledgePointId: n1.knowledgePoint.id, tagId: "t1" });
  linkTag(f, { knowledgePointId: n2.knowledgePoint.id, tagId: "t1" });

  await callTool(f, f.alice.token, "user_unlink_knowledge_point_tag", { id: n1.knowledgePoint.id, tagId: "t1" });
  const n1After = await callTool(f, f.alice.token, "user_get_knowledge_point", { id: n1.knowledgePoint.id });
  assert.deepEqual(n1After.knowledgePoint.tags, []);
  const n2After = await callTool(f, f.alice.token, "user_get_knowledge_point", { id: n2.knowledgePoint.id });
  assert.deepEqual(n2After.knowledgePoint.tags.map((t) => t.id), ["t1"], "the tag itself and its other link survive");
});

test("implementation: delete_knowledge_point_tag removes it everywhere but never deletes the notes", async (t) => {
  const f = await fixture(t);
  insertTag(f, { id: "t1", userId: "alice", name: "Shared" });
  const n1 = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  linkTag(f, { knowledgePointId: n1.knowledgePoint.id, tagId: "t1" });

  await callTool(f, f.alice.token, "user_delete_knowledge_point_tag", { id: "t1" });
  const after = await callTool(f, f.alice.token, "user_get_knowledge_point", { id: n1.knowledgePoint.id });
  assert.deepEqual(after.knowledgePoint.tags, []);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_points").get().n, 1);
});

// --- Groups -----------------------------------------------------------------

test("implementation: group names are case-insensitively unique per user; deleting a group falls its notes back to Ungrouped", async (t) => {
  const f = await fixture(t);
  await callTool(f, f.alice.token, "user_create_knowledge_point_group", { name: "AWS" });
  assert.equal((await callToolExpectingError(f, f.alice.token, "user_create_knowledge_point_group", { name: "aws" })).code, "conflict");

  const group = await callTool(f, f.alice.token, "user_create_knowledge_point_group", { name: "Networking" });
  await callTool(f, f.alice.token, "user_rename_knowledge_point_group", { id: group.group.id, name: "networking-renamed" });
  assert.equal((await callToolExpectingError(f, f.alice.token, "user_rename_knowledge_point_group", { id: group.group.id, name: "AWS" })).code, "conflict");

  const note = await callTool(f, f.alice.token, "user_create_knowledge_point", { groupId: group.group.id });
  await callTool(f, f.alice.token, "user_delete_knowledge_point_group", { id: group.group.id });
  const after = await callTool(f, f.alice.token, "user_get_knowledge_point", { id: note.knowledgePoint.id });
  assert.equal(after.knowledgePoint.groupId, null, "ON DELETE SET NULL falls the note back to Ungrouped");
});

test("implementation: creating a tag beyond the per-note cap is rejected", async (t) => {
  const f = await fixture(t);
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  const id = created.knowledgePoint.id;
  for (let i = 0; i < 50; i++) {
    insertTag(f, { id: `t${i}`, userId: "alice", name: `tag${i}` });
    linkTag(f, { knowledgePointId: id, tagId: `t${i}` });
  }
  const err = await callToolExpectingError(f, f.alice.token, "user_create_knowledge_point_tag", { id, name: "overflow" });
  assert.equal(err.code, "invalid_input");
});

// --- Ordering / reorder -------------------------------------------------------

test("implementation: reorder rejects a stale expectedOrderRevision instead of silently applying it", async (t) => {
  const f = await fixture(t);
  insertKnowledgePoint(f, { id: "n1", userId: "alice", position: 1024 });
  insertKnowledgePoint(f, { id: "n2", userId: "alice", position: 2048 });
  insertKnowledgePoint(f, { id: "n3", userId: "alice", position: 3072 });

  // orderRevision is an opaque token (not a sequential integer) — a fresh
  // scope starts at 1, but every value after the first reorder is random,
  // so the test always reads the current value back rather than assuming
  // a predictable number like 2 or 3.
  const list1 = await callTool(f, f.alice.token, "user_list_knowledge_points", { ungrouped: true, sort: "custom" });
  assert.equal(list1.orderRevision, 1);
  const staleRevision = list1.orderRevision;

  // First reorder succeeds and bumps the scope's order revision to a new,
  // unpredictable value.
  await callTool(f, f.alice.token, "user_reorder_knowledge_points", { id: "n3", beforeId: "n1", expectedOrderRevision: staleRevision });
  const list2 = await callTool(f, f.alice.token, "user_list_knowledge_points", { ungrouped: true, sort: "custom" });
  assert.deepEqual(list2.items.map((i) => i.id), ["n3", "n1", "n2"]);
  assert.notEqual(list2.orderRevision, staleRevision);

  // Second reorder with the now-stale revision must be rejected, not silently applied.
  const conflict = await callToolExpectingError(f, f.alice.token, "user_reorder_knowledge_points", { id: "n2", beforeId: "n3", expectedOrderRevision: staleRevision });
  assert.equal(conflict.code, "conflict");
  const list3 = await callTool(f, f.alice.token, "user_list_knowledge_points", { ungrouped: true, sort: "custom" });
  assert.deepEqual(list3.items.map((i) => i.id), ["n3", "n1", "n2"], "the rejected reorder must not have changed the order");
  assert.equal(list3.orderRevision, list2.orderRevision, "a rejected reorder must not bump the order revision either");

  // Retrying with the current revision succeeds.
  await callTool(f, f.alice.token, "user_reorder_knowledge_points", { id: "n2", beforeId: "n3", expectedOrderRevision: list3.orderRevision });
  const list4 = await callTool(f, f.alice.token, "user_list_knowledge_points", { ungrouped: true, sort: "custom" });
  assert.deepEqual(list4.items.map((i) => i.id), ["n2", "n3", "n1"]);
});

test("implementation: reorder rejects a beforeId in a different group (invalid_input) or belonging to another user (not_found)", async (t) => {
  const f = await fixture(t);
  insertGroup(f, { id: "g1", userId: "alice", name: "Group One" });
  insertKnowledgePoint(f, { id: "n1", userId: "alice", groupId: "g1", position: 1024 });
  insertKnowledgePoint(f, { id: "n2", userId: "alice", groupId: null, position: 1024 });
  const bobNote = await callTool(f, f.bob.token, "user_create_knowledge_point", {});

  const crossGroup = await callToolExpectingError(f, f.alice.token, "user_reorder_knowledge_points", { id: "n1", beforeId: "n2", expectedOrderRevision: 1 });
  assert.equal(crossGroup.code, "invalid_input");

  const crossUser = await callToolExpectingError(f, f.alice.token, "user_reorder_knowledge_points", { id: "n1", beforeId: bobNote.knowledgePoint.id, expectedOrderRevision: 1 });
  assert.equal(crossUser.code, "not_found");
});

test("implementation: reorder falls back to rebalancing the whole scope when float precision is exhausted", async (t) => {
  const f = await fixture(t);
  // n1 and n2 are adjacent past float precision — no midpoint exists between them.
  insertKnowledgePoint(f, { id: "n1", userId: "alice", position: 1 });
  insertKnowledgePoint(f, { id: "n2", userId: "alice", position: 1 + Number.EPSILON });
  insertKnowledgePoint(f, { id: "n3", userId: "alice", position: 500 });

  const result = await callTool(f, f.alice.token, "user_reorder_knowledge_points", { id: "n3", beforeId: "n2", expectedOrderRevision: 1 });
  assert.ok(Number.isFinite(result.position));
  const list = await callTool(f, f.alice.token, "user_list_knowledge_points", { ungrouped: true, sort: "custom" });
  assert.deepEqual(list.items.map((i) => i.id), ["n1", "n3", "n2"], "n3 landed immediately before n2, as requested");
});

// --- Attachments --------------------------------------------------------------

test("implementation: image refs are returned for the owner and never leak to another user", async (t) => {
  const f = await fixture(t);
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  const id = created.knowledgePoint.id;
  insertImage(f, { id: "img1", userId: "alice", knowledgePointId: id, r2ObjectKey: "kp-images/alice/img1" });

  const own = await callTool(f, f.alice.token, "user_get_knowledge_point", { id });
  assert.deepEqual(own.knowledgePoint.images, [{ id: "img1", url: "/api/kp-images/img1", status: "attached" }]);

  const err = await callToolExpectingError(f, f.bob.token, "user_get_knowledge_point", { id });
  assert.equal(err.code, "not_found", "the whole detail — image refs included — must not leak to another user");
});

test("implementation: an MCP-returned image ref is only fetchable by its owner through the actual protected attachment route", async (t) => {
  const f = await fixture(t);
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  const id = created.knowledgePoint.id;
  insertImage(f, { id: "img1", userId: "alice", knowledgePointId: id, r2ObjectKey: "kp-images/alice/img1" });

  const detail = await callTool(f, f.alice.token, "user_get_knowledge_point", { id });
  const ref = detail.knowledgePoint.images[0];
  assert.equal(ref.url, "/api/kp-images/img1");

  // The owner can fetch the exact URL the MCP tool returned — this is the
  // real /api/kp-images route (routes/kpImages.ts), not a simulation of it.
  const own = await restApp.request(`https://prepdeck.test${ref.url}`, { headers: { "x-user": "alice" } }, f.env);
  assert.equal(own.status, 200);
  assert.equal(await own.text(), "fake-bytes");

  // A different authenticated user hitting the same MCP-returned URL is
  // forbidden, and the response never carries the private bytes.
  const other = await restApp.request(`https://prepdeck.test${ref.url}`, { headers: { "x-user": "bob" } }, f.env);
  assert.equal(other.status, 403);
  assert.ok(!(await other.text()).includes("fake-bytes"));
});

test("implementation: no image-upload tool exists on the User MCP catalog", async (t) => {
  const f = await fixture(t);
  const tools = await listTools(f, f.alice.token);
  assert.ok(!tools.some((n) => n.includes("image") || n.includes("upload")));
});

// --- Transport body limit ------------------------------------------------------

test("implementation: a ~200,000-character CJK-heavy body round-trips through the real MCP transport", async (t) => {
  const f = await fixture(t);
  const bigBody = "知識ポイント".repeat(Math.ceil(200_000 / 6)).slice(0, 200_000);
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", { bodyMarkdown: bigBody });
  assert.equal(created.knowledgePoint.bodyMarkdown.length, 200_000);

  const fetched = await callTool(f, f.alice.token, "user_get_knowledge_point", { id: created.knowledgePoint.id });
  const updated = await callTool(f, f.alice.token, "user_update_knowledge_point", {
    id: created.knowledgePoint.id, baseRevision: fetched.knowledgePoint.revision,
    title: "Long note", bodyMarkdown: fetched.knowledgePoint.bodyMarkdown,
  });
  assert.equal(updated.knowledgePoint.bodyMarkdown.length, 200_000, "saved back unmodified, not truncated or rejected by the transport cap");
});

// --- Write rate limiting --------------------------------------------------------

test("implementation: KP mutations are rate-limited separately from the blanket account quota, and a rejected write never lands", async (t) => {
  const f = await fixture(t);
  f.env.RATE_LIMITER = statefulRateLimiter();

  for (let i = 0; i < 30; i++) {
    await callTool(f, f.alice.token, "user_create_knowledge_point_group", { name: `Group ${i}` });
  }
  const err = await callToolExpectingError(f, f.alice.token, "user_create_knowledge_point_group", { name: "Group 30" });
  assert.equal(err.code, "rate_limited");
  // implementation — the limiter's own retryAfter must reach the caller.
  assert.equal(err.retryAfter, 60);

  const groupCount = f.sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_point_groups WHERE user_id = 'alice'").get().n;
  assert.equal(groupCount, 30, "the rejected 31st write must not have been persisted");
});

test("implementation: an unreachable KP-write limiter reports \"unavailable\", not the generic \"internal\", and still blocks the write", async (t) => {
  const f = await fixture(t);
  // Break only the KP-write-specific key — the blanket per-account quota
  // gate in mcp/routes.ts (a different key) must stay healthy, since this
  // test is about the operation-level limiter's own error contract, not
  // about the pre-dispatch account gate (already covered elsewhere).
  const baseGet = f.env.RATE_LIMITER.get;
  f.env.RATE_LIMITER.get = (key) => key === "mcp:user:alice:kp-write"
    ? { fetch: async () => { throw new Error("simulated KP-write-limiter outage"); } }
    : baseGet(key);

  const err = await callToolExpectingError(f, f.alice.token, "user_create_knowledge_point_group", { name: "Group during outage" });
  assert.equal(err.code, "unavailable");

  const groupCount = f.sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_point_groups WHERE user_id = 'alice'").get().n;
  assert.equal(groupCount, 0, "a write blocked by an unreachable limiter must not have been persisted");
});

// --- REST regressions and REST+MCP interop --------------------------------------

test("implementation (REST): stale-revision autosave still returns 409 revision_conflict with the latest content", async (t) => {
  const f = await fixture(t);
  const create = await restRequest(f, "alice", "POST", "/api/knowledge-points", { groupId: null });
  const id = create.body.knowledgePoint.id;
  await restRequest(f, "alice", "PUT", `/api/knowledge-points/${id}`, { baseRevision: 1, title: "V2", bodyMarkdown: "" });

  const conflict = await restRequest(f, "alice", "PUT", `/api/knowledge-points/${id}`, { baseRevision: 1, title: "V3 (stale)", bodyMarkdown: "" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "revision_conflict");
  assert.equal(conflict.body.latest.title, "V2");
});

test("implementation (REST): duplicate group/tag names still 409", async (t) => {
  const f = await fixture(t);
  await restRequest(f, "alice", "POST", "/api/knowledge-point-groups", { name: "AWS" });
  const dup = await restRequest(f, "alice", "POST", "/api/knowledge-point-groups", { name: "aws" });
  assert.equal(dup.status, 409);
});

test("implementation (REST): a detail read bounds tags/images/linked questions and flags truncation", async (t) => {
  const f = await fixture(t);
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  const id = created.knowledgePoint.id;
  for (let i = 0; i < 101; i++) {
    insertTag(f, { id: `t${i}`, userId: "alice", name: `tag${i}` });
    linkTag(f, { knowledgePointId: id, tagId: `t${i}` });
  }
  const detail = await restRequest(f, "alice", "GET", `/api/knowledge-points/${id}`);
  assert.equal(detail.body.knowledgePoint.tags.length, 100);
  assert.equal(detail.body.knowledgePoint.tagsTruncated, true);
});

test("implementation: create via REST, edit via MCP, read via REST — the shared lib behaves identically regardless of caller", async (t) => {
  const f = await fixture(t);
  const created = await restRequest(f, "alice", "POST", "/api/knowledge-points", {});
  const id = created.body.knowledgePoint.id;

  await callTool(f, f.alice.token, "user_update_knowledge_point", { id, baseRevision: 1, title: "Edited via MCP", bodyMarkdown: "Body via MCP" });

  const readBack = await restRequest(f, "alice", "GET", `/api/knowledge-points/${id}`);
  assert.equal(readBack.body.knowledgePoint.title, "Edited via MCP");
  assert.equal(readBack.body.knowledgePoint.bodyMarkdown, "Body via MCP");
  assert.notEqual(readBack.body.knowledgePoint.revision, 1, "REST sees the MCP-applied revision change");
});

// --- Review follow-up fixes ----------------------------------------------------
// A code-review pass on this PR's first commit found four real gaps, all
// fixed in a follow-up commit. Each test below reproduces the exact failure
// mode reported and confirms the fix.

test("implementation review: a REST reorder invalidates the order revision an MCP client is holding", async (t) => {
  const f = await fixture(t);
  insertKnowledgePoint(f, { id: "n1", userId: "alice", position: 1024 });
  insertKnowledgePoint(f, { id: "n2", userId: "alice", position: 2048 });

  const staleRevision = (await callTool(f, f.alice.token, "user_list_knowledge_points", { ungrouped: true, sort: "custom" })).orderRevision;

  const restReorder = await restRequest(f, "alice", "PATCH", "/api/knowledge-points/n2/reorder", { beforeId: "n1", expectedOrderRevision: staleRevision });
  assert.equal(restReorder.status, 200);

  const err = await callToolExpectingError(f, f.alice.token, "user_reorder_knowledge_points", { id: "n1", beforeId: "n2", expectedOrderRevision: staleRevision });
  assert.equal(err.code, "conflict", "a REST reorder must invalidate a revision an MCP client read beforehand");
});

test("implementation review: a REST group move invalidates both the source and destination scope revisions", async (t) => {
  const f = await fixture(t);
  insertGroup(f, { id: "g1", userId: "alice", name: "Group One" });
  insertKnowledgePoint(f, { id: "n1", userId: "alice", groupId: null, position: 1024 });

  const ungroupedRevision = (await callTool(f, f.alice.token, "user_list_knowledge_points", { ungrouped: true, sort: "custom" })).orderRevision;

  const restMove = await restRequest(f, "alice", "PATCH", "/api/knowledge-points/n1/group", { groupId: "g1" });
  assert.equal(restMove.status, 200);

  const err = await callToolExpectingError(f, f.alice.token, "user_reorder_knowledge_points", { id: "n1", beforeId: null, expectedOrderRevision: ungroupedRevision });
  assert.equal(err.code, "conflict", "moving a note out of Ungrouped via REST must invalidate Ungrouped's revision");
});

test("implementation review: deleting a group with member notes invalidates the Ungrouped scope revision", async (t) => {
  const f = await fixture(t);
  insertGroup(f, { id: "g1", userId: "alice", name: "Group One" });
  insertKnowledgePoint(f, { id: "n1", userId: "alice", groupId: "g1", position: 1024 });
  insertKnowledgePoint(f, { id: "n2", userId: "alice", groupId: null, position: 1024 });

  const ungroupedRevision = (await callTool(f, f.alice.token, "user_list_knowledge_points", { ungrouped: true, sort: "custom" })).orderRevision;

  const restDelete = await restRequest(f, "alice", "DELETE", "/api/knowledge-point-groups/g1");
  assert.equal(restDelete.status, 204);

  const err = await callToolExpectingError(f, f.alice.token, "user_reorder_knowledge_points", { id: "n2", beforeId: null, expectedOrderRevision: ungroupedRevision });
  assert.equal(err.code, "conflict", "n1 falling back into Ungrouped must invalidate that scope's revision");
});

test("implementation review: list reads its rows and order revision from one atomic batch, not two racing round trips", async (t) => {
  const f = await fixture(t);
  insertKnowledgePoint(f, { id: "n1", userId: "alice", position: 1024 });

  const realBatch = f.env.DB.batch;
  const batchCalls = [];
  f.env.DB.batch = async (statements) => {
    batchCalls.push(statements.length);
    return realBatch(statements);
  };

  await callTool(f, f.alice.token, "user_list_knowledge_points", { ungrouped: true, sort: "custom" });
  assert.deepEqual(
    batchCalls, [2],
    "rows and orderRevision must be read in one 2-statement batch — two separate round trips would leave a window where a concurrent reorder lands in between, producing rows and a revision from different moments"
  );
});

test("implementation review: creating a new tag survives a concurrent tag-name race instead of aborting the whole batch", async (t) => {
  const f = await fixture(t);
  const realBatch = f.env.DB.batch;
  let injected = false;
  f.env.DB.batch = (statements) => {
    if (!injected) {
      injected = true;
      // Simulate a concurrent request winning the race to create the same
      // normalized tag name, landing between createNote's own pre-batch
      // existing-tag lookup (which found nothing) and this batch's commit —
      // exactly the window the original bug lived in.
      const now = new Date().toISOString();
      f.sqlite.prepare("INSERT INTO knowledge_point_tags (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("competing-tag-id", "alice", "AWS", now, now);
    }
    return realBatch(statements);
  };

  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", { tagNames: ["AWS"] });
  assert.deepEqual(created.knowledgePoint.tags.map((t) => t.id), ["competing-tag-id"], "the note links to whichever tag row actually won the race, not a candidate id that never became real");
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_point_tags WHERE user_id = 'alice' AND name = 'AWS' COLLATE NOCASE").get().n,
    1, "no duplicate tag row from our own now-abandoned candidate insert"
  );
});

test("implementation review: image reconciliation stays within D1's parameter budget past 100 images, for both the attach and orphan transitions", async (t) => {
  const f = await fixture(t);
  const created = await callTool(f, f.alice.token, "user_create_knowledge_point", {});
  const id = created.knowledgePoint.id;
  const refs = [];
  for (let i = 0; i < 105; i++) {
    const imgId = `img${i}`;
    refs.push(`/api/kp-images/${imgId}`);
    insertImage(f, { id: imgId, userId: "alice", knowledgePointId: id, r2ObjectKey: `kp-images/alice/${imgId}`, status: "pending" });
  }
  const statusCounts = () => Object.fromEntries(
    f.sqlite.prepare("SELECT status, COUNT(*) AS n FROM knowledge_point_images WHERE knowledge_point_id = ? GROUP BY status").all(id).map((r) => [r.status, r.n])
  );

  // Attach transition: body references all 105 at once — one JSON-array
  // bind, not 105 individual bound parameters.
  const attached = await callTool(f, f.alice.token, "user_update_knowledge_point", { id, baseRevision: 1, bodyMarkdown: refs.join(" ") });
  assert.deepEqual(statusCounts(), { attached: 105 });

  // Orphan transition: body drops every reference at once.
  await callTool(f, f.alice.token, "user_update_knowledge_point", { id, baseRevision: attached.knowledgePoint.revision, bodyMarkdown: "no images referenced anymore" });
  assert.deepEqual(statusCounts(), { orphaned: 105 });
});
