import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";
import { openDatabase } from "../../../tests/support/migrations.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { readFileSync } from "node:fs";

const { createRouter, notesRouter, questionNotesRouter } = await importTs([
  new URL("../src/context.ts", import.meta.url), new URL("../src/routes/notes.ts", import.meta.url),
]);

function fixture(t) {
  const db = openDatabase(t, false);
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT, avatar_url TEXT, show_shared_notes INTEGER);
    CREATE TABLE questions (id TEXT PRIMARY KEY, exam_id TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT, question_id TEXT, content TEXT, visibility TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO users VALUES ('viewer', NULL, NULL, 1), ('author', NULL, NULL, 1);
    INSERT INTO questions VALUES ('q', 'exam'), ('other-q', 'other');`);
  db.exec(readFileSync(new URL("../../../migrations/0048_notes_pagination_indexes.sql", import.meta.url), "utf8"));
  const insert = db.prepare("INSERT INTO notes VALUES (?, ?, ?, 'synthetic', ?, '2026-01-01', '2026-01-01')");
  for (let i = 0; i < 6; i++) insert.run(`n${i}`, "author", "q", "shared");
  insert.run("private-other", "author", "q", "private");
  insert.run("own", "viewer", "q", "private");
  insert.run("different-exam", "author", "other-q", "shared");
  const queries = [];
  const env = { DB: createD1(db, { onQuery: query => queries.push(query) }) };
  const app = createRouter();
  app.use("*", async (c, next) => { c.set("user", { id: "viewer", role: "user" }); await next(); });
  app.route("/api/notes", notesRouter);
  app.route("/api/questions/:questionId/notes", questionNotesRouter);
  return { db, queries, request: path => app.request(path, {}, env) };
}

for (const path of ["/api/notes?examId=exam", "/api/questions/q/notes?"]) {
  test(`bounded stable pages preserve visibility: ${path}`, async t => {
    const f = fixture(t);
    const ids = [];
    let cursor;
    do {
      const response = await f.request(`${path}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.ok(page.notes.length <= 2);
      ids.push(...page.notes.map(n => n.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(ids, ["n0", "n1", "n2", "n3", "n4", "n5", "own"]);
    assert.ok(f.queries.every(q => /LIMIT \?$/.test(q.sql) && q.args.at(-1) === 3));
  });
}

test("question and global order use seek indexes without a temporary sort", t => {
  const f = fixture(t);
  for (const [where, index] of [["question_id='q' AND", "idx_notes_question_page"], ["", "idx_notes_page"]]) {
    const plan = f.db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM notes WHERE ${where} (created_at, id) > ('2026-01-01', 'n1') ORDER BY created_at, id LIMIT 26`).all();
    assert.ok(plan.some(row => row.detail.includes(index)));
    assert.ok(plan.every(row => !row.detail.includes("TEMP B-TREE")));
  }
});

test("deleted cursor row and concurrent insert do not shift the next page", async t => {
  const f = fixture(t);
  const first = await (await f.request("/api/notes?examId=exam&limit=2")).json();
  f.db.exec("DELETE FROM notes WHERE id='n1'; INSERT INTO notes VALUES ('n25','author','q','synthetic','shared','2026-01-01','2026-01-01')");
  const second = await (await f.request(`/api/notes?examId=exam&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
  assert.deepEqual(second.notes.map(n => n.id), ["n2", "n25"]);
  const wrongScope = await f.request(`/api/questions/q/notes?cursor=${encodeURIComponent(first.nextCursor)}`);
  assert.equal(wrongScope.status, 400);
});

test("visibility is rechecked on every page; invalid pagination never queries D1", async t => {
  const f = fixture(t);
  const first = await (await f.request("/api/notes?examId=exam&limit=2")).json();
  f.db.exec("UPDATE users SET show_shared_notes=0 WHERE id='viewer'");
  const second = await (await f.request(`/api/notes?examId=exam&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
  assert.deepEqual(second.notes.map(n => n.id), ["own"]);
  const before = f.queries.length;
  for (const query of ["limit=0", "limit=26", "limit=1.5", "cursor=bad", `cursor=${"a".repeat(2049)}`]) {
    assert.equal((await f.request(`/api/notes?${query}`)).status, 400);
  }
  assert.equal(f.queries.length, before);
});
