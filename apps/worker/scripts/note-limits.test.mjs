// Issue #45: question notes and annotation notes had no length limit (a 1.9 MB
// shared note was stored and sent to every member; 5 MB reached D1 and came
// back as an unhandled SQLITE_TOOBIG 500). These drive the real routes on
// node:sqlite with the same body guard and error handler index.ts mounts.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

async function bundle(path) {
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"] });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const [notes, annotations, { jsonBodyLimit, JSON_BODY_MAX_BYTES }, { handleUnexpectedError, UNEXPECTED_ERROR_MESSAGE }, shared] = await Promise.all([
  bundle("../src/routes/notes.ts"), bundle("../src/routes/annotations.ts"), bundle("../src/lib/bodyLimit.ts"),
  bundle("../src/lib/unexpectedError.ts"), bundle("../../../packages/shared/src/index.ts"),
]);
const { MAX_NOTE_LENGTH, MAX_ANNOTATION_NOTE_LENGTH, MAX_ANNOTATION_STYLE_LENGTH } = shared;

function setup(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  db.exec(`INSERT INTO users (id,email,role,created_at) VALUES ('u','u@test','user','2026-09-09');
    INSERT INTO exams(id,slug,name,created_at) VALUES ('e','e','E','2026-09-09');
    INSERT INTO questions (id, exam_id, sequence_number, type, stem, options_json, correct_answers_json, created_at, updated_at)
      VALUES ('q','e',1,'single_choice','Stem','[{"id":"A","text":"a"},{"id":"B","text":"b"}]','["A"]','2026-09-09','2026-09-09')`);
  const DB = { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { const r = db.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; } };
  } };
  const app = new Hono();
  app.onError(handleUnexpectedError);
  app.use("*", async (c, next) => { c.set("user", { id: "u", role: "user" }); await next(); });
  for (const path of ["/questions/:questionId/notes/*", "/notes/*", "/questions/:questionId/annotations/*", "/annotations/*"]) app.use(path, jsonBodyLimit);
  app.route("/questions/:questionId/notes", notes.questionNotesRouter);
  app.route("/notes", notes.notesRouter);
  app.route("/questions/:questionId/annotations", annotations.questionAnnotationsRouter);
  app.route("/annotations", annotations.annotationsRouter);
  const request = async (path, method, body, init = {}) => {
    const response = await app.request(`https://test${path}`, { method, headers: { "Content-Type": "application/json" }, body: typeof body === "string" || body instanceof ReadableStream ? body : JSON.stringify(body), ...init }, { DB });
    return { status: response.status, data: await response.json() };
  };
  return { db, app, request };
}

test("a question note is at most MAX_NOTE_LENGTH characters, measured after trimming, on create and edit", async t => {
  const { db, request } = setup(t);
  const atLimit = await request("/questions/q/notes", "POST", { content: `  ${"x".repeat(MAX_NOTE_LENGTH)}\n`, visibility: "shared" });
  assert.equal(atLimit.status, 201, JSON.stringify(atLimit.data));
  const over = await request("/questions/q/notes", "POST", { content: "x".repeat(MAX_NOTE_LENGTH + 1), visibility: "shared" });
  assert.equal(over.status, 400);
  assert.match(over.data.error, /10,000 characters or fewer/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notes").get().n, 1, "the oversized note was not stored");
  const id = atLimit.data.note.id;
  assert.equal((await request(`/notes/${id}`, "PATCH", { content: "y".repeat(MAX_NOTE_LENGTH + 1) })).status, 400);
  assert.equal((await request(`/notes/${id}`, "PATCH", { content: "y".repeat(MAX_NOTE_LENGTH - 1) })).status, 200);
  assert.equal(db.prepare("SELECT length(content) AS n FROM notes").get().n, MAX_NOTE_LENGTH - 1);
});

test("an annotation note and style are bounded on create and edit", async t => {
  const { request } = setup(t);
  const mark = { targetType: "stem", rangeStart: 0, rangeEnd: 4, style: "hl1" };
  const created = await request("/questions/q/annotations", "POST", { ...mark, note: "n".repeat(MAX_ANNOTATION_NOTE_LENGTH) });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  for (const body of [{ ...mark, note: "n".repeat(MAX_ANNOTATION_NOTE_LENGTH + 1) }, { ...mark, style: "s".repeat(MAX_ANNOTATION_STYLE_LENGTH + 1) }]) {
    assert.equal((await request("/questions/q/annotations", "POST", body)).status, 400);
  }
  const id = created.data.annotation.id;
  const tooLong = await request(`/annotations/${id}`, "PATCH", { note: "n".repeat(MAX_ANNOTATION_NOTE_LENGTH + 1) });
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.data.error, /2,000 characters or fewer/);
  assert.equal((await request(`/annotations/${id}`, "PATCH", { note: "short" })).status, 200);
});

test("an oversized body is refused with a JSON 413 before it is parsed, with or without Content-Length", async t => {
  const { db, request } = setup(t);
  const huge = JSON.stringify({ content: "x".repeat(JSON_BODY_MAX_BYTES), visibility: "private" });
  const declared = await request("/questions/q/notes", "POST", huge);
  assert.equal(declared.status, 413);
  assert.match(declared.data.error, /Request body exceeds/);
  const chunks = [huge.slice(0, 40_000), huge.slice(40_000)];
  const streamed = await request("/questions/q/notes", "POST", new ReadableStream({ pull(controller) { const next = chunks.shift(); if (next) controller.enqueue(new TextEncoder().encode(next)); else controller.close(); } }), { duplex: "half" });
  assert.equal(streamed.status, 413);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notes").get().n, 0);
});

test("an unhandled error answers in JSON without internals; HTTP errors keep their own response", async t => {
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args));
  const app = new Hono();
  app.onError(handleUnexpectedError);
  const api = new Hono();
  api.post("/boom", () => { throw new Error("D1_ERROR: string or blob too big: SQLITE_TOOBIG"); });
  api.get("/gone", () => { throw new HTTPException(410, { message: "Gone" }); });
  app.route("/api", api);
  const boom = await app.request("https://test/api/boom", { method: "POST" });
  assert.equal(boom.status, 500);
  assert.deepEqual(await boom.json(), { error: UNEXPECTED_ERROR_MESSAGE });
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], "api.unhandled_error");
  assert.deepEqual(Object.keys(logged[0][1]).sort(), ["message", "method", "name", "route"]);
  assert.equal((await app.request("https://test/api/gone")).status, 410);
});
