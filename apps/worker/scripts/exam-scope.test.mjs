import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Hono } from "hono";
async function bundle(path) {
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"] });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const [{ practiceCatalogRouter }, { examAttemptsRouter }, { bookmarksRouter }, { wrongBookMasteredRouter }, { annotationsRouter }, { notesRouter }] = await Promise.all([
  bundle("../src/routes/practice.ts"), bundle("../src/routes/attempts.ts"), bundle("../src/routes/bookmarks.ts"), bundle("../src/routes/wrongBook.ts"), bundle("../src/routes/annotations.ts"), bundle("../src/routes/notes.ts")]);

function setup() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, dir), "utf8"));
  for (const id of ["u1", "u2"]) db.prepare("INSERT INTO users(id,email,created_at) VALUES (?,?,?)").run(id, `${id}@test`, "2026-09-09");
  for (const exam of ["A", "B", "empty"]) db.prepare("INSERT INTO exams(id,slug,name,created_at) VALUES (?,?,?,?)").run(exam, exam, exam, "2026-09-09");
  for (const id of ["A1", "A2", "A3", "B1", "B2", "B3"]) {
    db.prepare("INSERT INTO questions(id,exam_id,type,stem,correct_answers_json,created_at,updated_at,sequence_number) VALUES (?,?, 'fill_blank', ?, '[\"yes\"]', 'now', 'now', ?)").run(id, id[0], id, Number(id[1]));
  }
  for (const [user, ids] of [["u1", ["A1", "A2", "B1", "B2", "B3"]], ["u2", ["A3", "B3"]]]) for (const id of ids) {
    db.prepare("INSERT INTO bookmarks VALUES (?,?,'now')").run(user, id);
    db.prepare("INSERT INTO wrong_question_book VALUES (?,?,2,'now',0)").run(user, id);
  }
  db.exec("UPDATE wrong_question_book SET mastered=1 WHERE user_id='u1' AND question_id='A2'");
  for (const user of ["u1", "u2"]) for (const q of ["A1", "B1"]) {
    db.prepare("INSERT INTO annotations VALUES (?,?,?,'stem',NULL,0,2,'hl1',NULL,'now','now')").run(`${user}-${q}`, user, q);
    for (const visibility of ["private", "shared"]) db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,'now','now')").run(`${user}-${q}-${visibility}`, user, q, 'A note', visibility);
  }
  const cache = new Map();
  const DB = { prepare(sql) { let values = []; return {
    bind(...args) { values = args; return this; },
    async first() { return db.prepare(sql).get(...values) ?? null; },
    async all() { return { results: db.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }; }
  }; } };
  const env = { DB, KV: { get: async key => cache.has(key) ? JSON.parse(cache.get(key)) : null, put: async (key, value) => cache.set(key, value), delete: async key => cache.delete(key) } };
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: c.req.header("x-user") ?? "u1", role: "user" }); await next(); });
  app.route("/exams/:examId/practice-catalog", practiceCatalogRouter);
  app.route("/exams/:examId/attempts", examAttemptsRouter);
  app.route("/questions/:questionId/bookmark", bookmarksRouter);
  app.route("/questions/:questionId/mastered", wrongBookMasteredRouter);
  app.route("/annotations", annotationsRouter);
  app.route("/notes", notesRouter);
  const request = async (path, user = "u1", method = "GET", body) => {
    const response = await app.request(`https://test${path}`, { method, headers: { "x-user": user, "Content-Type": "application/json" }, body: body && JSON.stringify(body) }, env);
    return { status: response.status, body: await response.json() };
  };
  return { db, cache, request };
}

test("catalog isolates two users and exams, including shared question-cache hits", async t => {
  const { db, cache, request } = setup(); t.after(() => db.close());
  for (const [user, exam, expected, wrong] of [
    ["u1", "A", ["A1", "A2"], ["A1"]], ["u1", "B", ["B1", "B2", "B3"], ["B1", "B2", "B3"]],
    ["u2", "A", ["A3"], ["A3"]], ["u2", "B", ["B3"], ["B3"]], ["u1", "empty", [], []]
  ]) {
    const { status, body } = await request(`/exams/${exam}/practice-catalog`, user);
    assert.equal(status, 200); assert.deepEqual(body.bookmarkedIds.sort(), expected);
    assert.deepEqual(body.wrongEntries.map(x => x.questionId).sort(), wrong);
    assert.ok([...body.bookmarkedIds, ...body.wrongEntries.map(x => x.questionId), ...body.attemptedIds].every(id => body.questions.some(q => q.id === id)));
  }
  for (const payload of cache.values()) assert.ok(Array.isArray(JSON.parse(payload)), "only question arrays are cached");
  assert.equal((await request('/exams/missing/practice-catalog')).status, 404);
});

test("bulk practice accepts scoped bookmarks and rejects mixed-exam input", async t => {
  const { db, request } = setup(); t.after(() => db.close());
  const { body: catalog } = await request('/exams/A/practice-catalog');
  assert.equal((await request('/exams/A/attempts', 'u1', 'POST', { mode: 'practice', questionIds: catalog.bookmarkedIds })).status, 201);
  assert.equal((await request('/exams/A/attempts', 'u1', 'POST', { mode: 'practice', questionIds: ['A1', 'B1'] })).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM attempts WHERE user_id='u1'").get().n, 1);
});

test("bookmark and mastery writes affect only the authenticated user's target", async t => {
  const { db, request } = setup(); t.after(() => db.close());
  await request('/exams/B/practice-catalog'); // exercise reads after a cache fill
  await request('/questions/B3/bookmark', 'u1', 'DELETE');
  await request('/questions/B3/mastered', 'u1', 'PUT');
  assert.deepEqual((await request('/exams/B/practice-catalog')).body.bookmarkedIds, ['B1', 'B2']);
  const other = (await request('/exams/B/practice-catalog', 'u2')).body;
  assert.deepEqual(other.bookmarkedIds, ['B3']); assert.equal(other.wrongEntries[0].questionId, 'B3');
  assert.deepEqual((await request('/exams/A/practice-catalog')).body.bookmarkedIds, ['A1', 'A2']);
});


test("annotation filters and note visibility keep explicit exam and user scope", async t => {
  const { db, request } = setup(); t.after(() => db.close());
  for (const user of ['u1', 'u2']) for (const exam of ['A', 'B']) {
    const annotations = (await request(`/annotations?examId=${exam}&markType=hl1&sort=desc`, user)).body.annotations;
    assert.deepEqual(annotations.map(a => a.id), [`${user}-${exam}1`]);
    const notes = (await request(`/notes?examId=${exam}`, user)).body.notes;
    assert.equal(notes.length, 3);
    assert.ok(notes.every(n => n.questionId === `${exam}1` && (n.userId === user || n.visibility === 'shared')));
  }
  db.exec("UPDATE users SET show_shared_notes=0 WHERE id='u1'");
  assert.equal((await request('/notes?examId=A')).body.notes.length, 2);
  assert.equal((await request('/annotations')).body.annotations.length, 2); // explicit legacy account-wide contract
  assert.equal((await request('/annotations?examId=missing')).body.annotations.length, 0);
  assert.equal((await request('/notes?examId=missing')).body.notes.length, 0);
});
