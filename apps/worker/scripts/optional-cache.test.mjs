import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";
import { createKv } from "../../../tests/support/kv.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { openDatabase } from "../../../tests/support/migrations.mjs";
import { Hono } from "hono";
import { createBucket } from "../../../tests/support/r2.mjs";
import { createRateLimit } from "../../../tests/support/rate-limit.mjs";

const cache = await importTs(new URL("../src/lib/practiceCache.ts", import.meta.url));
const stats = await importTs(new URL("../src/lib/statsCache.ts", import.meta.url));
const { importsRouter } = await importTs(new URL("../src/routes/imports.ts", import.meta.url));

test("KV deletion failure preserves committed import, archive and durable log", async t => {
  const db = openDatabase(t);
  db.exec("INSERT INTO users(id,email,role,created_at) VALUES ('u','u@test','admin','2026-01-01'); INSERT INTO exams(id,slug,name,created_at) VALUES ('e','e','E','2026-01-01')");
  const env = { DB: createD1(db), KV: createKv({ failures: { delete: new Error("synthetic") } }), BUCKET: createBucket(), IMPORT_EXECUTE_RATE_LIMITER: createRateLimit() };
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: "u", role: "admin" }); await next(); });
  app.route("/exams/:examId/imports", importsRouter);
  const background = [];
  const response = await app.request("https://example.test/exams/e/imports", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schemaVersion: "1.0", exam: { id: "e", name: "E" }, questions: [{ type: "single_choice", stem: "Synthetic", options: [{ id: "A", text: "A" }, { id: "B", text: "B" }], correctAnswers: ["A"] }] }),
  }, env, { waitUntil(promise) { background.push(promise); } });
  assert.equal(response.status, 201, await response.clone().text());
  const result = await response.json();
  assert.equal(result.created, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM questions WHERE exam_id='e'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM import_logs WHERE exam_id='e'").get().n, 1);
  assert.ok(await env.BUCKET.get(result.r2ObjectKey));
  await Promise.all(background);
});

test("practice cache failures do not interrupt authoritative reads or invalidation", async () => {
  const KV = createKv({ failures: { get: new Error("synthetic"), put: new Error("synthetic"), delete: new Error("synthetic") } });
  const env = { KV };
  assert.deepEqual(await cache.getOrComputePracticeQuestions(env, "e", async () => []), []);
  await cache.invalidatePracticeQuestions(env, "e");
  // An invalidation failure puts this isolate into bounded authoritative fallback.
  let reads = 0;
  KV.get = async () => { reads++; return [{ id: "stale" }]; };
  assert.deepEqual(await cache.getOrComputePracticeQuestions(env, "e", async () => []), []);
  assert.equal(reads, 0);
});

test("concurrent practice refreshes and invalidations coalesce within an isolate", async () => {
  const KV = createKv();
  const env = { KV };
  let loads = 0;
  const load = async () => { loads++; await Promise.resolve(); return []; };
  await Promise.all(Array.from({ length: 8 }, () => cache.getOrComputePracticeQuestions(env, "e", load)));
  assert.equal(loads, 1);
  assert.equal(KV.writes.filter(w => w.method === "put").length, 1);
  await Promise.all(Array.from({ length: 8 }, () => cache.invalidatePracticeQuestions(env, "e")));
  assert.equal(KV.deletes.length, 3, "current and two rolling-deployment keys, once each");
});

test("a mutation during a catalog load prevents stale cache repopulation", async () => {
  const KV = createKv();
  const env = { KV };
  let finish;
  let started;
  const loading = new Promise(resolve => { started = resolve; });
  const read = cache.getOrComputePracticeQuestions(env, "e", () => {
    started();
    return new Promise(resolve => { finish = resolve; });
  });
  await loading;
  await cache.invalidatePracticeQuestions(env, "e");
  finish([{ id: "old" }]);
  await read;
  assert.equal(KV.writes.filter(w => w.method === "put").length, 0);
});

test("a pending old put settles before invalidation", async () => {
  const KV = createKv();
  const originalPut = KV.put.bind(KV);
  let finish;
  KV.put = async (...args) => { await new Promise(resolve => { finish = resolve; }); await originalPut(...args); };
  const env = { KV };
  const write = cache.setCachedPracticeQuestions(env, "e", [{ id: "old" }]);
  const invalidation = cache.invalidatePracticeQuestions(env, "e");
  finish();
  await Promise.all([write, invalidation]);
  assert.equal(await cache.getCachedPracticeQuestions(env, "e"), null);
});

test("a joining mutation drains a put that started after the first delete snapshot", async () => {
  const KV = createKv();
  const env = { KV };
  const originalDelete = KV.delete.bind(KV);
  const originalPut = KV.put.bind(KV);
  let releaseDelete;
  let reachedDelete;
  const deleting = new Promise(resolve => { reachedDelete = resolve; });
  KV.delete = async key => {
    if (key.startsWith('practice-questions:v3:') && !releaseDelete) {
      reachedDelete();
      await new Promise(resolve => { releaseDelete = resolve; });
    }
    await originalDelete(key);
  };
  const first = cache.invalidatePracticeQuestions(env, 'e');
  await deleting;
  let releasePut;
  KV.put = async (...args) => {
    await new Promise(resolve => { releasePut = resolve; });
    await originalPut(...args);
  };
  const writing = cache.setCachedPracticeQuestions(env, 'e', [{ id: 'between-mutations' }]);
  const second = cache.invalidatePracticeQuestions(env, 'e');
  releaseDelete();
  releasePut();
  await Promise.all([first, second, writing]);
  assert.equal(await cache.getCachedPracticeQuestions(env, 'e'), null);
  assert.equal(KV.store.has('practice-questions:v3:e'), false);
});

test("stats fallback uses D1 and coalesces concurrent fills without masking D1 errors", async t => {
  const db = openDatabase(t);
  db.exec("INSERT INTO users(id,email,role,created_at) VALUES ('u','u@test','user','2026-01-01'); INSERT INTO exams(id,slug,name,created_at) VALUES ('e','e','E','2026-01-01')");
  const KV = createKv({ failures: { get: new Error("synthetic"), put: new Error("synthetic") } });
  const env = { DB: createD1(db), KV };
  assert.equal((await stats.getOrComputeExamStats(env, "u", "e")).totalAnswers, 0);
  delete KV.failures.get;
  delete KV.failures.put;
  await Promise.all(Array.from({ length: 8 }, () => stats.getOrComputeExamStats(env, "u", "e")));
  assert.equal(KV.writes.length, 1);
  const broken = { ...env, DB: { prepare() { throw new Error("authoritative unavailable"); } } };
  await assert.rejects(stats.getOrComputeExamStats(broken, "u", "e"), /authoritative unavailable/);
});

test("stats marker distinguishes completions sharing a timestamp", async t => {
  const db = openDatabase(t);
  db.exec("INSERT INTO users(id,email,role,created_at) VALUES ('u','u@test','user','2026-01-01'); INSERT INTO exams(id,slug,name,created_at) VALUES ('e','e','E','2026-01-01')");
  const DB = createD1(db);
  const insert = db.prepare("INSERT INTO attempts(id,user_id,exam_id,mode,question_ids_json,started_at,completed_at) VALUES (?, 'u','e','practice','[]','2026-01-01','2026-01-01')");
  insert.run('a');
  const before = await stats.examActivityMarker(DB, 'u', 'e');
  insert.run('b');
  assert.notEqual(await stats.examActivityMarker(DB, 'u', 'e'), before);
});
