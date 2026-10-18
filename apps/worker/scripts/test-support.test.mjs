// The shared test support in tests/support/ that the Worker tests build on:
// the D1 shim has to keep D1's contract, or every test using it checks the
// wrong thing.
import assert from "node:assert/strict";
import test from "node:test";
import { createD1, D1_MAX_BOUND_PARAMETERS } from "../../../tests/support/d1.mjs";
import { migrationNames, openDatabase, SEED_MIGRATION } from "../../../tests/support/migrations.mjs";
import { importTs } from "../../../tests/support/bundle.mjs";

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
