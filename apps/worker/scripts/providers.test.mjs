import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Hono } from "hono";
import { importTs } from "../../../tests/support/bundle.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { applyMigrations, openDatabase } from "../../../tests/support/migrations.mjs";
import { createBucket } from "../../../tests/support/r2.mjs";

const bundle = path => importTs(new URL(path, import.meta.url));
const { providersRouter } = await bundle("../src/routes/providers.ts");
const { examsRouter } = await bundle("../src/routes/exams.ts");
const png = readFileSync(new URL("../../../tests/fixtures/mcp-presentation/response-flow.png", import.meta.url));

function fixture(t) {
  const db = openDatabase(t, false);
  db.exec("PRAGMA foreign_keys = ON");
  applyMigrations(db);
  db.exec("INSERT INTO providers(id,name,short_name,website_url,created_at) VALUES ('p','Provider','P','https://example.test','now')");
  db.exec("INSERT INTO exams(id,slug,name,created_at) VALUES ('e','exam','Exam','now')");
  db.exec("INSERT INTO questions(id,exam_id,type,stem,correct_answers_json,created_at,updated_at,sequence_number) VALUES ('q','e','fill_blank','Question','[\"answer\"]','now','now',1)");
  let beforeDelete;
  const DB = createD1(db, { onQuery({ sql, method }) {
    if (method === "run" && sql.startsWith("DELETE FROM providers ") && beforeDelete) { beforeDelete(); beforeDelete = null; }
  } });
  const BUCKET = createBucket();
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: "u", role: c.req.header("x-role") ?? "admin" }); await next(); });
  app.route("/providers", providersRouter);
  app.route("/exams", examsRouter);
  const request = async (path, method = "GET", body, role = "admin", contentType = "application/json") => {
    const response = await app.request(`https://test${path}`, {
      method, headers: { "Content-Type": contentType, "x-role": role },
      body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : body,
    }, { DB, BUCKET });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  return { db, request, bucket: BUCKET, raceDelete: (fn) => { beforeDelete = fn; }, failBucketDelete: () => { BUCKET.failures.delete = new Error("R2 unavailable"); } };
}

test("create and partial edit validate and normalize metadata without overwriting omitted fields", async t => {
  const { request } = fixture(t);
  const created = await request("/providers", "POST", { name: " New ", shortName: " N ", websiteUrl: " https://example.org " });
  assert.equal(created.status, 201);
  assert.equal(created.body.provider.name, "New");
  assert.equal(created.body.provider.archivedAt, null);
  let edited = await request("/providers/p", "PATCH", { name: " Renamed " });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.provider.name, "Renamed");
  assert.equal(edited.body.provider.shortName, "P");
  assert.equal(edited.body.provider.websiteUrl, "https://example.test");
  edited = await request("/providers/p", "PATCH", { shortName: " New short ", websiteUrl: " " });
  assert.equal(edited.body.provider.shortName, "New short");
  assert.equal(edited.body.provider.websiteUrl, null);
  assert.equal((await request("/providers/p", "PATCH", { websiteUrl: null })).status, 200);
  assert.equal((await request("/providers/missing", "PATCH", { name: "Valid" })).status, 404);
});

test("malformed edits and unsafe URLs return 400 and leave data unchanged", async t => {
  const { request, db } = fixture(t);
  const original = db.prepare("SELECT * FROM providers WHERE id='p'").get();
  for (const body of [null, [], "text", 12, {}, { name: null }, { name: " " }, { name: 5 }, { shortName: false },
    { shortName: "" }, { name: "x".repeat(201) }, { shortName: "x".repeat(81) }, { websiteUrl: 12 }, { websiteUrl: {} },
    { websiteUrl: "javascript:alert(1)" }, { websiteUrl: "ftp://example.test" }, { websiteUrl: "not a url" }, { archivedAt: "now" }, { iconUrl: "https://other.test" }]) {
    assert.equal((await request("/providers/p", "PATCH", body)).status, 400, JSON.stringify(body));
    assert.deepEqual(db.prepare("SELECT * FROM providers WHERE id='p'").get(), original);
  }
  for (const body of [null, [], { name: 3, shortName: "P" }, { name: "", shortName: "P" }, { name: "P", shortName: "P", websiteUrl: "javascript:alert(1)" }]) {
    assert.equal((await request("/providers", "POST", body)).status, 400);
  }
  assert.equal((await request("/providers/p", "PATCH", "{", "admin", "text/plain")).status, 400);
});

test("archive hides providers from normal lists while retaining exams, questions, and historical links; restore reverses it", async t => {
  const { request, db } = fixture(t);
  assert.equal((await request("/providers/p/exams/e", "PUT")).status, 204);
  const archived = await request("/providers/p/archive", "POST");
  assert.equal(archived.status, 200);
  assert.ok(archived.body.provider.archivedAt);
  assert.equal((await request("/providers/p/archive", "POST")).body.provider.archivedAt, archived.body.provider.archivedAt);
  assert.deepEqual((await request("/providers")).body.providers, []);
  assert.deepEqual((await request("/providers?includeArchived=true", "GET", undefined, "user")).body.providers, []);
  assert.equal((await request("/providers?includeArchived=true")).body.providers.length, 1);
  for (const role of ["user", "admin"]) {
    const exam = (await request("/exams", "GET", undefined, role)).body.exams.find(e => e.id === "e");
    assert.equal(exam.questionCount, 1);
    assert.deepEqual(exam.providers, []);
  }
  assert.equal((await request("/exams?includeArchived=true")).body.exams.find(e => e.id === "e").providers[0].id, "p");
  assert.equal((await request("/exams/e?includeArchived=true")).body.exam.providers[0].archivedAt, archived.body.provider.archivedAt);
  // A direct read follows the same rule as the list: archived provider links
  // are an admin-only view, so users (and plain reads) do not see them.
  for (const [path, role] of [["/exams/e", "admin"], ["/exams/e", "user"], ["/exams/e?includeArchived=true", "user"]]) {
    assert.deepEqual((await request(path, "GET", undefined, role)).body.exam.providers, [], `${role} ${path}`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM provider_exams").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM questions WHERE id='q'").get().n, 1);
  assert.equal((await request("/providers/p/exams/e", "PUT")).status, 409);
  assert.equal((await request("/providers/p/unarchive", "POST")).body.provider.archivedAt, null);
  assert.equal((await request("/providers")).body.providers.length, 1);
  assert.equal((await request("/exams")).body.exams.find(e => e.id === "e").providers[0].id, "p");
  for (const action of ["archive", "unarchive"]) assert.equal((await request(`/providers/missing/${action}`, "POST")).status, 404);
});

test("assignment is idempotent and reports why nothing was linked", async t => {
  const { request, db } = fixture(t);
  assert.equal((await request("/providers/p/exams/e", "PUT")).status, 204);
  assert.equal((await request("/providers/p/exams/e", "PUT")).status, 204);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM provider_exams").get().n, 1);
  db.exec("DELETE FROM provider_exams");
  db.exec("UPDATE providers SET archived_at='now' WHERE id='p'");
  assert.equal((await request("/providers/p/exams/e", "PUT")).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM provider_exams").get().n, 0);
});

test("a failed icon cleanup does not turn a completed delete into an error", async t => {
  const { request, db, bucket, failBucketDelete } = fixture(t);
  bucket.seed("provider-icons/p", png);
  failBucketDelete();
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal((await request("/providers/p", "DELETE")).status, 204);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM providers").get().n, 0);
  assert.equal(warn.mock.callCount(), 1);
});

test("delete refuses active and archived exam references, including a reference added at deletion time", async t => {
  const { request, db, bucket, raceDelete } = fixture(t);
  bucket.seed("provider-icons/p", png);
  raceDelete(() => db.exec("INSERT INTO provider_exams VALUES ('p','e')"));
  assert.equal((await request("/providers/p", "DELETE")).status, 409);
  db.exec("UPDATE exams SET archived_at='now' WHERE id='e'");
  await request("/providers/p/archive", "POST");
  const blocked = await request("/providers/p", "DELETE");
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Archive.*instead/i);
  assert.ok(bucket.objects.has("provider-icons/p"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM provider_exams").get().n, 1);
  await request("/providers/p/exams/e", "DELETE");
  assert.equal((await request("/providers/p", "DELETE")).status, 204);
  assert.equal(bucket.objects.has("provider-icons/p"), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM providers").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM questions WHERE id='q'").get().n, 1);
  assert.equal((await request("/providers/p", "DELETE")).status, 404);
});

test("icon replacement/removal use validated uploads and reject missing providers", async t => {
  const { request, bucket } = fixture(t);
  const upload = await request("/providers/p/icon", "POST", png, "admin", "image/png");
  assert.equal(upload.status, 200);
  assert.match(upload.body.iconUrl, /^\/api\/provider-icons\/p\?v=/);
  assert.ok(bucket.objects.has("provider-icons/p"));
  assert.equal((await request("/providers/p/icon", "POST", "fake", "admin", "image/png")).status, 400);
  assert.equal((await request("/providers/p/icon", "POST", "<svg/>", "admin", "image/svg+xml")).status, 400);
  assert.equal((await request("/providers/p/icon", "DELETE")).status, 204);
  assert.equal((await request("/providers")).body.providers[0].iconUrl, null);
  assert.equal(bucket.objects.has("provider-icons/p"), false);
  assert.equal((await request("/providers/missing/icon", "POST", png, "admin", "image/png")).status, 404);
  assert.equal((await request("/providers/missing/icon", "DELETE")).status, 404);
  assert.equal((await request("/providers/missing/exams/e", "PUT")).status, 404);
  assert.equal((await request("/providers/p/exams/missing", "PUT")).status, 404);
});

test("every provider mutation requires an administrator", async t => {
  const { request, db } = fixture(t);
  for (const [path, method, body] of [["/providers", "POST", { name: "N", shortName: "N" }],
    ["/providers/p", "PATCH", { name: "Changed" }], ["/providers/p", "DELETE"],
    ["/providers/p/archive", "POST"], ["/providers/p/unarchive", "POST"],
    ["/providers/p/icon", "POST"], ["/providers/p/icon", "DELETE"],
    ["/providers/p/exams/e", "PUT"], ["/providers/p/exams/e", "DELETE"]]) {
    assert.equal((await request(path, method, body, "user")).status, 403, `${method} ${path}`);
  }
  assert.equal(db.prepare("SELECT name FROM providers WHERE id='p'").get().name, "Provider");
});
