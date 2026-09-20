import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Hono } from "hono";

const { outputFiles } = await build({
  stdin: {
    contents: `export * from './src/lib/knowledgePointMutations.ts';
      export * from './src/routes/knowledgePoints.ts';
      export * from './src/scheduled/cleanupKnowledgePointImages.ts';
      export * from './src/lib/knowledgePointImageRetirement.ts';`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, platform: "browser", format: "esm", mainFields: ["browser", "module", "main"],
});
const {
  applyNoteUpdate, knowledgePointsRouter, runKnowledgePointImageCleanup, deleteNote, MAX_DELETE_ATTEMPTS,
} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const migrations = new URL("../../../migrations/", import.meta.url);
const schema = readdirSync(migrations).filter((n) => n.endsWith(".sql") && !n.startsWith("0002_"))
  .sort().map((n) => readFileSync(new URL(n, migrations), "utf8")).join("\n");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(schema);
  for (const id of ["alice", "bob"]) {
    sqlite.prepare("INSERT INTO users(id,email,role,status,created_at) VALUES (?,?,'user','active','2026-01-01')").run(id, `${id}@example.test`);
  }
  sqlite.exec("INSERT INTO exams(id,slug,name,created_at) VALUES ('exam','exam','Exam','2026-01-01')");

  let batchHook;
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
    BUCKET: { delete: async (key) => { deletedKeys.push(...(Array.isArray(key) ? key : [key])); } },
  };
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: c.req.header("x-user") ?? "alice", role: "user" }); await next(); });
  app.route("/api/knowledge-points", knowledgePointsRouter);
  const request = async (path, method = "GET", body, user = "alice") => {
    const res = await app.request(`https://example.test${path}`, {
      method, headers: { "Content-Type": "application/json", "x-user": user },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
    return { status: res.status, body: await res.json() };
  };
  const insertNote = (id = "note", body = "![image](/api/kp-images/image)", status = "attached") => {
    sqlite.prepare("INSERT INTO knowledge_points(id,user_id,title,body_markdown,position,created_at,updated_at) VALUES (?,'alice','Note',?,1024,'2026-01-01','2026-01-01')").run(id, body);
    sqlite.prepare("INSERT INTO knowledge_point_images(id,user_id,knowledge_point_id,r2_object_key,content_type,byte_size,status,created_at,updated_at) VALUES (?,'alice',?,?,'image/png',1,?,'2026-01-01','2026-01-01')").run(id === "note" ? "image" : id, id, `key-${id}`, status);
  };
  return { sqlite, DB, env, request, values, deletedKeys, insertNote,
    afterBatch: (hook) => { batchHook = hook; } };
}

test("REST content and image status commit together across overlapping saves", async (t) => {
  const f = fixture(t); f.insertNote();
  f.afterBatch(async () => {
    const revision = f.sqlite.prepare("SELECT revision FROM knowledge_points WHERE id='note'").get().revision;
    const saved = await applyNoteUpdate(f.DB, { id: "note", userId: "alice", baseRevision: revision, title: "Note", bodyMarkdown: "![image](/api/kp-images/image)" });
    assert.equal(saved.ok, true);
  });
  assert.equal((await applyNoteUpdate(f.DB, { id: "note", userId: "alice", baseRevision: 1, title: "Note", bodyMarkdown: "removed" })).ok, true);
  assert.equal(f.sqlite.prepare("SELECT status FROM knowledge_point_images").get().status, "attached");
  assert.equal((await runKnowledgePointImageCleanup(f.env, () => Date.now() + 3 * 86400000)).deleted, 0);
  assert.deepEqual(f.deletedKeys, []);
});

test("cleanup preserves referenced images and durably retries failed object deletion", async (t) => {
  const f = fixture(t);
  f.insertNote("note", "![image](/api/kp-images/image)", "orphaned");
  f.insertNote("unused", "unused", "pending");
  f.env.BUCKET.delete = async () => { throw new Error("temporary object-store failure"); };
  assert.equal((await runKnowledgePointImageCleanup(f.env)).deleted, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM knowledge_point_images").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM knowledge_point_image_deletions").get().n, 1);
  f.env.BUCKET.delete = async (key) => { f.deletedKeys.push(...(Array.isArray(key) ? key : [key])); };
  assert.equal((await runKnowledgePointImageCleanup(f.env)).deleted, 1);
  assert.deepEqual(f.deletedKeys, ["key-unused"]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM knowledge_point_image_deletions").get().n, 0);
});

test("REST ordering returns snapshot tokens and rejects missing or stale revisions", async (t) => {
  const f = fixture(t); f.insertNote("one"); f.insertNote("two");
  const list = await f.request("/api/knowledge-points?ungrouped=true&sort=custom");
  assert.equal(list.status, 200);
  assert.equal(list.body.orderRevision, 1);
  // A malformed token is still rejected outright (these do not mutate).
  assert.equal((await f.request("/api/knowledge-points/one/reorder", "PATCH", { beforeId: null, expectedOrderRevision: 0 })).status, 400);
  assert.equal((await f.request("/api/knowledge-points/one/reorder", "PATCH", { beforeId: null, expectedOrderRevision: "x" })).status, 400);
  const body = { beforeId: null, expectedOrderRevision: list.body.orderRevision };
  assert.equal((await f.request("/api/knowledge-points/one/reorder", "PATCH", body)).status, 200);
  const position = f.sqlite.prepare("SELECT position FROM knowledge_points WHERE id='two'").get().position;
  assert.equal((await f.request("/api/knowledge-points/two/reorder", "PATCH", body)).status, 409);
  assert.equal(f.sqlite.prepare("SELECT position FROM knowledge_points WHERE id='two'").get().position, position);
  assert.equal((await f.request("/api/knowledge-points")).body.orderRevision, null);
  // Compatibility window (routes/knowledgePoints.ts): a tab still running the
  // previous bundle sends no token at all. That has to keep working rather
  // than hard-break every drag until the tab is reloaded.
  assert.equal((await f.request("/api/knowledge-points/two/reorder", "PATCH", { beforeId: null })).status, 200);
});

test("a permanently failing object cannot wedge the retirement queue", async (t) => {
  const f = fixture(t);
  f.insertNote("stuck", "unused", "pending");
  f.env.BUCKET.delete = async () => { throw new Error("permanent object-store failure"); };
  // Exhaust the retry budget for the one object that can never be deleted.
  for (let attempt = 0; attempt < MAX_DELETE_ATTEMPTS; attempt++) {
    assert.equal((await runKnowledgePointImageCleanup(f.env)).deleted, 0);
  }
  assert.equal(f.sqlite.prepare("SELECT attempts FROM knowledge_point_image_deletions").get().attempts, MAX_DELETE_ATTEMPTS);

  // A newly abandoned upload must still be collected, not queue behind it.
  f.insertNote("fresh", "unused", "pending");
  f.env.BUCKET.delete = async (key) => { f.deletedKeys.push(...(Array.isArray(key) ? key : [key])); };
  assert.equal((await runKnowledgePointImageCleanup(f.env)).deleted, 1);
  assert.deepEqual(f.deletedKeys, ["key-fresh"]);
  // The exhausted tombstone is left behind for an operator, not silently lost.
  assert.deepEqual(f.sqlite.prepare("SELECT id FROM knowledge_point_image_deletions").all().map(r => r.id), ["stuck"]);
});

test("every retirement path enqueues before dropping the row it describes", async (t) => {
  const f = fixture(t);
  f.insertNote("note", "![image](/api/kp-images/image)", "attached");
  // Deleting a note cascades its image rows away, so the tombstone has to be
  // written in the same batch or nothing remembers the R2 object afterwards.
  f.env.BUCKET.delete = async () => { throw new Error("temporary object-store failure"); };
  assert.equal(await deleteNote(f.DB, f.env.BUCKET, { id: "note", userId: "alice" }), true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM knowledge_points").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM knowledge_point_images").get().n, 0);
  assert.deepEqual(f.sqlite.prepare("SELECT id, r2_object_key FROM knowledge_point_image_deletions").all()
    .map(r => [r.id, r.r2_object_key]), [["image", "key-note"]]);

  // The sweep is what retries it; nothing about the note is needed any more.
  f.env.BUCKET.delete = async (key) => { f.deletedKeys.push(...(Array.isArray(key) ? key : [key])); };
  assert.equal((await runKnowledgePointImageCleanup(f.env)).deleted, 1);
  assert.deepEqual(f.deletedKeys, ["key-note"]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM knowledge_point_image_deletions").get().n, 0);
});

test("draining a page costs one object-store call, not one per image", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 25; i++) f.insertNote(`abandoned-${i}`, "unused", "pending");
  let calls = 0;
  f.env.BUCKET.delete = async (key) => { calls++; f.deletedKeys.push(...(Array.isArray(key) ? key : [key])); };
  assert.equal((await runKnowledgePointImageCleanup(f.env)).deleted, 25);
  assert.equal(calls, 1, "R2 takes the whole key list in one call");
  assert.equal(f.deletedKeys.length, 25);
});
