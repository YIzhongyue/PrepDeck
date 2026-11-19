import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Hono } from "hono";
import { importTs } from "../../../tests/support/bundle.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { openDatabase } from "../../../tests/support/migrations.mjs";
import { createBucket } from "../../../tests/support/r2.mjs";

const { examsRouter, examBadgesRouter } = await importTs(new URL("../src/routes/exams.ts", import.meta.url));
const image = readFileSync(new URL("../../../tests/fixtures/mcp-presentation/response-flow.png", import.meta.url));
const alternate = readFileSync(new URL("../../../tests/fixtures/mcp-presentation/boxed-risk.png", import.meta.url));
const customSource = { imageUrl: "https://certifications.example.test/other.png", issuerUrl: "https://certifications.example.test/exam" };

function fixture(t) {
  const db = openDatabase(t);
  db.exec("INSERT INTO exams(id,slug,name,created_at) VALUES ('nv','nca-aiio','NCA-AIIO','now'), ('aws','aws-exam','AWS Exam','now')");
  const bucket = createBucket();
  const env = { DB: createD1(db), BUCKET: bucket, EXAM_BADGE_IMAGE_HOSTS: "certifications.example.test" };
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: "u", role: c.req.header("x-role") ?? "admin" }); await next(); });
  app.route("/api/exams", examsRouter);
  app.route("/api/exam-badges", examBadgesRouter);
  const request = (path, init) => app.request(`https://prepdeck.test${path}`, init, env);
  const post = (path, body, role = "admin") => request(`/api/exams${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-role": role }, body: JSON.stringify(body),
  });
  const importBadge = async (id, body = {}) => (await (await post(`/${id}/badge/import`, body)).json()).badgeImport;
  const getExam = async id => (await (await request(`/api/exams/${id}`)).json()).exam;
  return { bucket, db, request, post, importBadge, getExam };
}

const png = (body = image) => new Response(body, { headers: { "Content-Type": "image/png" } });

test("backfills the built-in certification and creates an exam with a different persisted source", async t => {
  const { post, importBadge, request, getExam } = fixture(t);
  const downloads = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    downloads.push(url.href);
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers["User-Agent"], "PrepDeck exam badge importer");
    return png(url.hostname === "images.credly.com" ? image : alternate);
  });

  const source = (await (await request("/api/exams/nv/badge-source")).json()).source;
  assert.match(source.issuerUrl, /credly\.com\/org\/nvidia/);
  const seeded = await importBadge("nv");
  assert.equal(seeded.status, "imported");
  assert.equal((await getExam("nv")).badgeIconUrl, seeded.badgeIconUrl);
  assert.deepEqual(Buffer.from(await (await request(seeded.badgeIconUrl)).arrayBuffer()), image);
  assert.deepEqual(await importBadge("nv"), { ...seeded, status: "already_has_badge" });

  const response = await post("", { slug: "other-certification", name: "Other certification", badgeSource: customSource });
  assert.equal(response.status, 201);
  const { exam, badgeImport } = await response.json();
  assert.equal(badgeImport.status, "imported");
  assert.equal(exam.badgeIconUrl, badgeImport.badgeIconUrl);
  assert.deepEqual((await (await request(`/api/exams/${exam.id}/badge-source`)).json()).source, customSource);
  assert.deepEqual(Buffer.from(await (await request(exam.badgeIconUrl)).arrayBuffer()), alternate);
  assert.deepEqual(downloads, [source.imageUrl, customSource.imageUrl]);
});

test("unmapped creation, manual badge selection and access checks avoid a download", async t => {
  const { post, request } = fixture(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => png());
  const unmapped = await post("", { slug: "unmapped", name: "Unmapped" });
  assert.equal(unmapped.status, 201);
  assert.deepEqual((await unmapped.json()).badgeImport, { status: "missing_source" });
  const manual = await post("", { slug: "manual", name: "Manual", badgeSource: customSource, importBadge: false });
  assert.equal(manual.status, 201);
  const { exam, badgeImport } = await manual.json();
  assert.equal(badgeImport, undefined);
  assert.equal(exam.badgeIconUrl, null);
  assert.equal((await post("/nv/badge/import", {}, "user")).status, 403);
  assert.equal((await request("/api/exams/nv/badge-source", { headers: { "x-role": "user" } })).status, 403);
  assert.equal(fetch.mock.callCount(), 0);
});

test("a bad response leaves an exam created and its saved source available to retry", async t => {
  const { post, importBadge, request } = fixture(t);
  let response = () => new Response(null, { status: 503 });
  t.mock.method(globalThis, "fetch", async () => response());
  const created = await post("", { slug: "other-certification", name: "Other", badgeSource: customSource });
  assert.equal(created.status, 201);
  const { exam, badgeImport } = await created.json();
  assert.deepEqual(badgeImport, { status: "failed", reason: "download_failed" });
  assert.equal(exam.badgeIconUrl, null);

  response = () => new Response("not an image", { headers: { "Content-Type": "image/png" } });
  assert.deepEqual(await importBadge(exam.id), { status: "failed", reason: "invalid_image" });
  response = () => png(new Uint8Array(2 * 1024 * 1024 + 1));
  assert.deepEqual(await importBadge(exam.id), { status: "failed", reason: "image_too_large" });
  response = () => png();
  const retried = await importBadge(exam.id);
  assert.equal(retried.status, "imported");
  assert.equal((await request(retried.badgeIconUrl)).headers.get("Content-Type"), "image/png");
});

test("validates the source and every redirect before sending a request", async t => {
  const { post, importBadge } = fixture(t);
  let target = "https://other.example.test/thumbnail.png";
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    return url.pathname === "/thumbnail.png" ? png() : new Response(null, { status: 302, headers: { Location: target } });
  });
  const disallowed = await post("", { slug: "wrong-host", name: "Wrong host", badgeSource: { ...customSource, imageUrl: target } });
  assert.equal(disallowed.status, 400);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(await importBadge("nv"), { status: "failed", reason: "source_not_allowed" });
  assert.equal(fetch.mock.callCount(), 1);
  target = "/thumbnail.png";
  assert.equal((await importBadge("nv")).status, "imported");
  assert.equal(fetch.mock.callCount(), 3);
});

test("concurrent imports publish one badge and clean up the losing candidate", async t => {
  const { importBadge, bucket, getExam } = fixture(t);
  const bothDownloading = Promise.withResolvers();
  const finish = Promise.withResolvers();
  let downloads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++downloads === 2) bothDownloading.resolve();
    await finish.promise;
    return png();
  });
  const imports = [importBadge("nv"), importBadge("nv")];
  await bothDownloading.promise;
  finish.resolve();
  const results = await Promise.all(imports);
  assert.deepEqual(results.map(result => result.status).sort(), ["failed", "imported"]);
  assert.equal(bucket.objects.size, 1);
  assert.equal((await getExam("nv")).badgeIconUrl, results.find(result => result.status === "imported").badgeIconUrl);
});

test("a manual upload completed during an import is preserved", async t => {
  const { bucket, request, importBadge, getExam } = fixture(t);
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  t.mock.method(globalThis, "fetch", async () => { started.resolve(); await finish.promise; return png(); });
  const pending = importBadge("nv");
  await started.promise;
  const manual = await request("/api/exams/nv/badge", { method: "POST", headers: { "Content-Type": "image/png" }, body: alternate });
  finish.resolve();
  assert.equal(manual.status, 200);
  const { badgeIconUrl } = await manual.json();
  assert.deepEqual(await pending, { status: "failed", reason: "exam_changed" });
  assert.equal((await getExam("nv")).badgeIconUrl, badgeIconUrl);
  assert.deepEqual(Buffer.from(await (await request(badgeIconUrl)).arrayBuffer()), alternate);
  assert.equal(bucket.objects.size, 1);
});

test("legacy version URLs still work and replacing one requires an explicit action", async t => {
  const { bucket, db, request, importBadge } = fixture(t);
  const legacy = "/api/exam-badges/aws?v=1234567890000";
  db.prepare("UPDATE exams SET badge_icon_url = ? WHERE id = 'aws'").run(legacy);
  bucket.seed("exam-badges/aws", image, { httpMetadata: { contentType: "image/png" } });
  const fetch = t.mock.method(globalThis, "fetch", async () => png(alternate));
  assert.deepEqual(await importBadge("aws", { source: customSource }), { status: "already_has_badge", badgeIconUrl: legacy });
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(Buffer.from(await (await request(legacy)).arrayBuffer()), image);
  const replaced = await importBadge("aws", { replace: true });
  assert.equal(replaced.status, "imported");
  assert.deepEqual(Buffer.from(await (await request(replaced.badgeIconUrl)).arrayBuffer()), alternate);
});
