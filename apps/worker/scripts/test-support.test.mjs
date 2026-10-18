// The shared test support in tests/support/ that the Worker tests build on:
// the D1, KV, R2 and rate-limiter fakes have to keep their bindings'
// contracts, or every test using them checks the wrong thing.
import assert from "node:assert/strict";
import test from "node:test";
import { consumeRateLimit } from "../src/middleware/rateLimit.ts";
import { createBindings } from "../../../tests/support/bindings.mjs";
import { createD1, D1_MAX_BOUND_PARAMETERS } from "../../../tests/support/d1.mjs";
import { createKv, KV_MAX_VALUE_BYTES } from "../../../tests/support/kv.mjs";
import { migrationNames, openDatabase, SEED_MIGRATION } from "../../../tests/support/migrations.mjs";
import { importTs } from "../../../tests/support/bundle.mjs";
import { createBucket } from "../../../tests/support/r2.mjs";
import { createRateLimit, createRateLimiter } from "../../../tests/support/rate-limit.mjs";

function database(t, options) {
  const sqlite = openDatabase(t, false);
  sqlite.exec("CREATE TABLE items (id TEXT PRIMARY KEY, n INTEGER NOT NULL)");
  return { sqlite, DB: createD1(sqlite, options) };
}

test("bind returns a new statement, and an unbound statement runs directly", async t => {
  const { DB } = database(t);
  const insert = DB.prepare("INSERT INTO items (id, n) VALUES (?, ?)");
  const first = insert.bind("a", 1);
  insert.bind("b", 2);
  assert.equal((await first.run()).meta.changes, 1);
  assert.deepEqual((await DB.prepare("SELECT id FROM items").all()).results.map(row => ({ ...row })), [{ id: "a" }]);
  assert.equal(await DB.prepare("SELECT n FROM items WHERE id = ?").bind("a").first("n"), 1);
  assert.equal(await DB.prepare("SELECT n FROM items WHERE id = ?").bind("zzz").first(), null);
  assert.deepEqual(await DB.prepare("SELECT id, n FROM items").raw(), [["a", 1]]);
});

test("run reports changes, and RETURNING rows", async t => {
  const { DB } = database(t);
  const returned = await DB.prepare("INSERT INTO items (id, n) VALUES ('a', 1), ('b', 2) RETURNING id").run();
  assert.deepEqual(returned.results.map(r => r.id), ["a", "b"]);
  assert.equal(returned.meta.changes, 2);
  assert.equal((await DB.prepare("UPDATE items SET n = n + 1").run()).meta.changes, 2);
  assert.equal((await DB.prepare("SELECT * FROM items").run()).meta.changes, 0);
});

test("a batch applies every statement or none", async t => {
  const { DB } = database(t);
  const insert = DB.prepare("INSERT INTO items (id, n) VALUES (?, ?)");
  await assert.rejects(DB.batch([insert.bind("a", 1), insert.bind("a", 2)]));
  assert.deepEqual((await DB.prepare("SELECT * FROM items").all()).results, []);
  const results = await DB.batch([insert.bind("a", 1), insert.bind("b", 2)]);
  assert.deepEqual(results.map(r => r.meta.changes), [1, 1]);
});

test("onQuery sees every executed statement and can fail one; afterBatch follows the commit", async t => {
  const seen = [];
  let committed;
  const { sqlite, DB } = database(t, {
    onQuery(query) {
      seen.push(query);
      if (query.args[0] === "boom") throw new Error("unavailable");
    },
    afterBatch: queries => { committed = { queries, rows: sqlite.prepare("SELECT COUNT(*) AS n FROM items").get().n }; },
  });
  const insert = DB.prepare("INSERT INTO items (id, n) VALUES (?, ?)");
  assert.deepEqual(seen, [], "preparing and binding run nothing");
  await DB.batch([insert.bind("a", 1)]);
  await DB.prepare("SELECT * FROM items WHERE id = ?").bind("a").first();
  await assert.rejects(insert.bind("boom", 2).run(), /unavailable/);
  assert.deepEqual(seen.map(q => q.method), ["batch", "first", "run"]);
  assert.deepEqual(committed, { queries: [{ sql: insert.sql, args: ["a", 1], method: "batch" }], rows: 1 });
});

test("afterQuery runs between a read and its caller seeing the result", async t => {
  const { sqlite, DB } = database(t, {
    afterQuery({ method }) { if (method === "first") sqlite.exec("UPDATE items SET n = 2"); },
  });
  sqlite.exec("INSERT INTO items (id, n) VALUES ('a', 1)");
  assert.equal(await DB.prepare("SELECT n FROM items").first("n"), 1, "the read saw the database before the change");
  assert.equal(sqlite.prepare("SELECT n FROM items").get().n, 2);
});

test("a statement binding more parameters than D1 allows is refused", async t => {
  const { DB } = database(t);
  const placeholders = Array.from({ length: D1_MAX_BOUND_PARAMETERS + 1 }, () => "?").join(",");
  const values = Array.from({ length: D1_MAX_BOUND_PARAMETERS + 1 }, (_, i) => i);
  await assert.rejects(DB.prepare(`SELECT 1 WHERE 1 IN (${placeholders})`).bind(...values).all(), /at most 100 parameters/);
});

test("migrations apply in order, and can be narrowed", t => {
  const names = migrationNames();
  assert.equal(names[0], "0001_init.sql");
  assert.ok(names.includes(SEED_MIGRATION));
  assert.deepEqual(names, [...names].sort());
  const tables = sqlite => sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
  assert.ok(tables(openDatabase(t)).includes("mcp_oauth_grants"));
  assert.ok(!tables(openDatabase(t, { filter: name => name !== "0045_mcp_oauth.sql" })).includes("mcp_oauth_grants"));
  assert.ok(!tables(openDatabase(t, { only: ["0001_init.sql"] })).includes("mcp_credentials"));
  assert.deepEqual(tables(openDatabase(t, false)), []);
});

test("importTs bundles one module, several modules, or literal source", async () => {
  const { pct } = await importTs(new URL("../src/lib/learningStats.ts", import.meta.url));
  assert.equal(typeof pct, "function");
  const combined = await importTs([
    new URL("../src/lib/bodyLimit.ts", import.meta.url),
    new URL("../src/lib/unexpectedError.ts", import.meta.url),
  ]);
  assert.equal(typeof combined.jsonBodyLimit, "function");
  assert.equal(typeof combined.handleUnexpectedError, "function");
  const literal = await importTs({ contents: "export { jsonBodyLimit as limit } from './src/lib/bodyLimit.ts';", resolveDir: new URL("..", import.meta.url) });
  assert.equal(typeof literal.limit, "function");
  await assert.rejects(importTs(new URL("../src/lib/bodyLimit.ts", import.meta.url), { platform: "deno" }), /Unknown bundle platform/);
});

test("KV reads text by default and parses the json type, and records each write in order", async () => {
  const KV = createKv();
  assert.equal(await KV.get("missing"), null);
  assert.equal(await KV.get("missing", "json"), null);
  await KV.put("entry", JSON.stringify({ n: 1 }), { expirationTtl: 60 });
  assert.equal(await KV.get("entry"), '{"n":1}');
  assert.deepEqual(await KV.get("entry", "json"), { n: 1 });
  assert.deepEqual(await KV.get("entry", { type: "json" }), { n: 1 });
  await assert.rejects(KV.get("entry", "arrayBuffer"), /"text" and "json"/);
  await KV.delete("entry");
  await KV.delete("never-written");
  assert.equal(await KV.get("entry"), null);
  assert.deepEqual(KV.writes, [
    { method: "put", key: "entry", value: '{"n":1}', options: { expirationTtl: 60 } },
    { method: "delete", key: "entry" },
    { method: "delete", key: "never-written" },
  ]);
  assert.deepEqual(KV.deletes, ["entry", "never-written"]);
  KV.store.set("seeded", "[1]");
  assert.deepEqual(await KV.get("seeded", "json"), [1], "a test may seed the store directly");
});

test("KV refuses what Workers KV refuses: a TTL under a minute and a value over 25 MiB", async () => {
  const KV = createKv();
  await assert.rejects(KV.put("short", "v", { expirationTtl: 59 }), /at least 60 seconds/);
  // The characters fit but the UTF-8 bytes do not: KV counts bytes.
  await assert.rejects(KV.put("big", "界".repeat(KV_MAX_VALUE_BYTES / 3 + 1)), /at most/);
  assert.deepEqual(KV.writes, []);
  assert.equal(KV.store.size, 0);
});

test("a KV failure throws instead of running, records nothing, and can be lifted", async () => {
  const KV = createKv({ failures: { delete: new Error("KV unavailable") } });
  await KV.put("entry", "v");
  await assert.rejects(KV.delete("entry"), /KV unavailable/);
  assert.equal(await KV.get("entry"), "v");
  assert.deepEqual(KV.deletes, []);
  KV.failures.get = new Error("KV read unavailable");
  await assert.rejects(KV.get("entry"), /KV read unavailable/);
  KV.failures.delete = KV.failures.get = null;
  await KV.delete("entry");
  assert.deepEqual(KV.deletes, ["entry"]);
});

test("an R2 object keeps its metadata, and every read gets a fresh body", async () => {
  const BUCKET = createBucket();
  assert.equal(await BUCKET.get("missing"), null);
  assert.equal(await BUCKET.head("missing"), null);
  const put = await BUCKET.put("avatars/u", "héllo", { httpMetadata: { contentType: "text/plain" } });
  assert.equal(put.size, 6, "size is in bytes");
  const object = await BUCKET.get("avatars/u");
  assert.equal(object.key, "avatars/u");
  assert.equal(object.httpMetadata.contentType, "text/plain");
  assert.ok(object.uploaded instanceof Date);
  assert.equal(await new Response(object.body).text(), "héllo");
  assert.equal(await object.text(), "héllo", "a second read is not a drained stream");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  assert.equal(headers.get("Content-Type"), "text/plain");
  assert.equal((await BUCKET.head("avatars/u")).size, 6);
  // A stream can be read only once, so the bucket reads it when it is put.
  await BUCKET.put("streamed", new Blob([new Uint8Array([1, 2, 3])]).stream());
  assert.deepEqual(new Uint8Array(await (await BUCKET.get("streamed")).arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal(BUCKET.objects.get("avatars/u").body, "héllo", "a string body is kept as it was put");
});

test("R2 lists a prefix in key order, a page at a time", async () => {
  const BUCKET = createBucket();
  for (const key of ["imports/b/2", "imports/a/2", "imports/a/1", "other/1", "imports/a/3"]) await BUCKET.put(key, "{}");
  BUCKET.seed("imports/a/0", "{}", { uploaded: new Date(0) });
  const all = await BUCKET.list({ prefix: "imports/a/" });
  assert.deepEqual(all.objects.map(o => o.key), ["imports/a/0", "imports/a/1", "imports/a/2", "imports/a/3"]);
  assert.equal(all.truncated, false);
  assert.equal(all.cursor, undefined);
  assert.equal(all.objects[0].uploaded.getTime(), 0, "seed sets the upload time");
  const keys = [];
  let cursor;
  let pages = 0;
  do {
    const page = await BUCKET.list({ prefix: "imports/", limit: 2, cursor });
    keys.push(...page.objects.map(o => o.key));
    cursor = page.truncated ? page.cursor : undefined;
    pages++;
  } while (cursor);
  assert.deepEqual(keys, ["imports/a/0", "imports/a/1", "imports/a/2", "imports/a/3", "imports/b/2"]);
  assert.equal(pages, 3);
  await assert.rejects(BUCKET.list({ limit: 1001 }), /at most 1000/);
});

test("R2 deletes one key or many in one call, and records each call", async () => {
  const BUCKET = createBucket();
  for (const key of ["a", "b", "c"]) await BUCKET.put(key, "x");
  await BUCKET.delete("a");
  await BUCKET.delete(["b", "c", "never-written"]);
  assert.equal(BUCKET.objects.size, 0);
  assert.deepEqual(BUCKET.deleteCalls, [["a"], ["b", "c", "never-written"]]);
  assert.deepEqual(BUCKET.deleted, ["a", "b", "c", "never-written"]);
  await assert.rejects(BUCKET.delete(Array.from({ length: 1001 }, (_, i) => `k${i}`)), /at most 1000/);
});

test("an R2 failure throws instead of running, records nothing, and can be lifted", async () => {
  const BUCKET = createBucket({ failures: { delete: new Error("R2 unavailable") } });
  await BUCKET.put("a", "x");
  await assert.rejects(BUCKET.delete(["a"]), /R2 unavailable/);
  assert.ok(BUCKET.objects.has("a"));
  assert.deepEqual(BUCKET.deleteCalls, []);
  BUCKET.failures.put = new Error("R2 write unavailable");
  await assert.rejects(BUCKET.put("b", "x"), /R2 write unavailable/);
  assert.equal(BUCKET.objects.has("b"), false);
  BUCKET.failures.delete = null;
  await BUCKET.delete(["a"]);
  assert.deepEqual(BUCKET.deleted, ["a"]);
});

test("the RATE_LIMITER stub answers the Worker's own consumeRateLimit and records every request", async () => {
  const RATE_LIMITER = createRateLimiter();
  assert.equal(RATE_LIMITER.idFromName("write:ip:a"), "write:ip:a", "an id is its name");
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await consumeRateLimit({ RATE_LIMITER }, "write:ip:a", { windowSeconds: 60, max: 2 }), { allowed: true, retryAfter: 60 });
  }
  assert.deepEqual(RATE_LIMITER.calls, Array.from({ length: 3 }, () => ({ key: "write:ip:a", windowSeconds: 60, max: 2 })));
  assert.equal(RATE_LIMITER.counts.get("write:ip:a"), 3);
  // The stub takes a Request as well as a URL and init.
  const body = JSON.stringify({ windowSeconds: 1, max: 1 });
  const response = await RATE_LIMITER.get("k").fetch(new Request("https://rate-limiter/consume", { method: "POST", body }));
  assert.deepEqual(await response.json(), { allowed: true, retryAfter: 60 });
});

test("a counting RATE_LIMITER allows max requests per key, as the Durable Object does within a window", async () => {
  const RATE_LIMITER = createRateLimiter({ counting: true, retryAfter: 42 });
  const consume = key => consumeRateLimit({ RATE_LIMITER }, key, { windowSeconds: 60, max: 2 });
  assert.deepEqual([(await consume("a")).allowed, (await consume("a")).allowed, (await consume("b")).allowed], [true, true, true]);
  assert.deepEqual(await consume("a"), { allowed: false, retryAfter: 42 });
  assert.equal((await consume("b")).allowed, true, "keys count independently");
});

test("RATE_LIMITER.respond decides first, falls back when it returns nothing, and can fail the stub", async () => {
  const RATE_LIMITER = createRateLimiter({ respond: ({ key }) => (key === "denied" ? { allowed: false, retryAfter: 7 } : undefined) });
  const consume = key => consumeRateLimit({ RATE_LIMITER }, key, { windowSeconds: 60, max: 10 });
  assert.deepEqual(await consume("denied"), { allowed: false, retryAfter: 7 });
  assert.deepEqual(await consume("other"), { allowed: true, retryAfter: 60 });
  RATE_LIMITER.respond = ({ count }) => { if (count > 1) throw new Error("storage down"); };
  assert.equal((await consume("fresh")).allowed, true);
  await assert.rejects(consume("fresh"), /storage down/, "an unreachable object fails the request");
  assert.equal(RATE_LIMITER.calls.length, 4, "a failed request is still recorded");
});

test("a native rate-limit binding answers { success } and records each key", async () => {
  const limiter = createRateLimit();
  assert.deepEqual(await limiter.limit({ key: "admin:exam" }), { success: true });
  assert.deepEqual(await createRateLimit({ success: false }).limit({ key: "k" }), { success: false });
  limiter.respond = () => { throw new Error("limiter unreachable"); };
  await assert.rejects(limiter.limit({ key: "admin:exam" }), /limiter unreachable/);
  limiter.respond = () => ({ success: false });
  assert.deepEqual(await limiter.limit({ key: "admin:other" }), { success: false });
  assert.deepEqual(limiter.calls, [{ key: "admin:exam" }, { key: "admin:exam" }, { key: "admin:other" }]);
});

test("createBindings gives every call its own fakes", async () => {
  const [first, second] = [createBindings(), createBindings()];
  assert.deepEqual(Object.keys(first).sort(), ["BUCKET", "IMPORT_EXECUTE_RATE_LIMITER", "IMPORT_VALIDATE_RATE_LIMITER", "KV", "RATE_LIMITER"]);
  await first.KV.put("k", "v");
  await first.BUCKET.put("k", "v");
  await first.IMPORT_VALIDATE_RATE_LIMITER.limit({ key: "k" });
  assert.equal(second.KV.store.size, 0);
  assert.equal(second.BUCKET.objects.size, 0);
  assert.deepEqual(second.IMPORT_VALIDATE_RATE_LIMITER.calls, []);
  assert.notEqual(first.IMPORT_VALIDATE_RATE_LIMITER, first.IMPORT_EXECUTE_RATE_LIMITER);
});
