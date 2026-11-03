import { Hono } from "hono";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openDatabase } from "../../../tests/support/migrations.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { importTs } from "../../../tests/support/bundle.mjs";

const { flushRetiredImages, createNote, kpImagesRouter } = await importTs([new URL("../src/lib/knowledgePointImageRetirement.ts", import.meta.url), new URL("../src/lib/knowledgePointMutations.ts", import.meta.url), new URL("../src/routes/kpImages.ts", import.meta.url)]);
const quotaSql = readFileSync(new URL("../../../migrations/0047_knowledge_point_quotas.sql", import.meta.url), "utf8");
// Identical triggers with small numerical limits: no large uploads/row floods.
const smallQuotaSql = quotaSql.replaceAll("10000", "3").replaceAll("104857600", "12")
  .replaceAll("5000", "2").replaceAll("524288000", "10");
function setup(t, before = () => {}) {
  const db = openDatabase(t, { filter: name => name !== "0047_knowledge_point_quotas.sql" });
  db.exec("INSERT INTO users(id,email,role,status,created_at) VALUES('a','a@example.test','user','active','2026-01-01'),('b','b@example.test','user','active','2026-01-01')");
  before(db);
  db.exec(smallQuotaSql);
  return db;
}
function note(db, id, body = "", user = "a") {
  db.prepare("INSERT INTO knowledge_points(id,user_id,body_markdown,position,created_at,updated_at) VALUES(?,?,?,1,'2026','2026')").run(id,user,body);
}
function reserve(db,id,bytes,user="a") {
  return db.prepare("INSERT INTO knowledge_point_image_usage(id,user_id,r2_object_key,byte_size,upload_state,created_at) VALUES(?,?,?,?, 'uploading','2026')").run(id,user,`kp-images/${user}/${id}`,bytes);
}

test("notes count UTF-8 bytes, enforce exact boundaries and isolate accounts", t => {
  const db = setup(t);
  note(db,"n1","你好"); // 6 bytes
  note(db,"n2","abcdef");
  note(db,"n3");
  assert.throws(() => note(db,"n4"), /kp_quota_exceeded/);
  assert.throws(() => db.prepare("UPDATE knowledge_points SET body_markdown='a' WHERE id='n3'").run(), /kp_quota_exceeded/);
  note(db,"other","abcdefghijkl","b");
  db.prepare("DELETE FROM knowledge_points WHERE id='n1'").run();
  note(db,"n4","你好");
  assert.deepEqual({...db.prepare("SELECT note_count,body_bytes FROM knowledge_point_usage WHERE user_id='a'").get()}, {note_count:3,body_bytes:12});
});

test("existing overage is preserved and non-growing edits and deletes work", t => {
  const db = setup(t, db => note(db,"legacy","abcdefghijklmnop"));
  assert.equal(db.prepare("SELECT body_bytes FROM knowledge_point_usage WHERE user_id='a'").get().body_bytes,16);
  db.prepare("UPDATE knowledge_points SET title='rename',body_markdown='ponmlkjihgfedcba' WHERE id='legacy'").run();
  assert.throws(() => db.prepare("UPDATE knowledge_points SET body_markdown=body_markdown||'x' WHERE id='legacy'").run(),/kp_quota_exceeded/);
  db.prepare("UPDATE knowledge_points SET body_markdown='short' WHERE id='legacy'").run();
  db.prepare("DELETE FROM knowledge_points WHERE id='legacy'").run();
  assert.equal(db.prepare("SELECT body_bytes FROM knowledge_point_usage WHERE user_id='a'").get().body_bytes,0);
});

test("image reservations bound count and bytes before upload and survive failed deletion", async t => {
  const db = setup(t);
  reserve(db,"i1",6);
  reserve(db,"i2",4);
  assert.throws(() => reserve(db,"i3",0),/kp_image_quota_exceeded/);
  reserve(db,"other",10,"b");
  db.prepare("UPDATE knowledge_point_image_usage SET upload_state='ready' WHERE id='i1'").run();
  db.prepare("INSERT INTO knowledge_point_image_deletions(id,r2_object_key,queued_at) VALUES('i1','kp-images/a/i1',0)").run();
  const images=[{id:"i1",r2_object_key:"kp-images/a/i1"}];
  const DB=createD1(db);
  await flushRetiredImages(DB,{delete:async()=>{throw new Error("synthetic failure");}},images);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM knowledge_point_image_usage WHERE user_id='a'").get().n,2);
  await flushRetiredImages(DB,{delete:async()=>{}},images);
  await flushRetiredImages(DB,{delete:async()=>{}},images); // retry is idempotent
  assert.equal(db.prepare("SELECT COUNT(*) n FROM knowledge_point_image_usage WHERE user_id='a'").get().n,1);
  assert.throws(() => reserve(db,"too-big",7),/kp_image_quota_exceeded/);
  reserve(db,"replacement",6);
});

test("two concurrent creates cannot both consume the final note slot", async t => {
  const db=setup(t);
  note(db,"first"); note(db,"second");
  const results=await Promise.all([createNote(createD1(db),{userId:"a"}),createNote(createD1(db),{userId:"a"})]);
  assert.equal(results.filter(result=>result.ok).length,1);
  assert.equal(results.find(result=>!result.ok).reason,"quota_exceeded");
  assert.equal(db.prepare("SELECT note_count FROM knowledge_point_usage WHERE user_id='a'").get().note_count,3);
});
test("upload replays do not repeat PUT and an ambiguous attachment commit never retires a live image", async t => {
  const db = openDatabase(t);
  db.exec("INSERT INTO users(id,email,role,status,created_at) VALUES('a','a@example.test','user','active','2026')");
  note(db,"note");
  let first=true, puts=0, deletes=0;
  const DB=createD1(db,{afterBatch:()=>{if(first){first=false;throw new Error("committed but response lost");}}});
  const app=new Hono(); app.use("*",async(c,next)=>{c.set("user",{id:"a"});await next();}); app.route("/images",kpImagesRouter);
  const env={DB,BUCKET:{put:async()=>{puts++;},delete:async()=>{deletes++;}}};
  const body=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1kAAAAASUVORK5CYII=","base64");
  const send=(key,data=body)=>app.request("https://example.test/images/note",{method:"POST",headers:{"Content-Type":"image/png","Idempotency-Key":key},body:data},env);
  const firstResponse=await send("synthetic-upload-0001");
  assert.equal(firstResponse.status,201);
  const replay=await send("synthetic-upload-0001");
  assert.equal(replay.status,200);
  assert.equal((await replay.json()).image.id,(await firstResponse.json()).image.id);
  assert.equal(puts,1); assert.equal(deletes,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM knowledge_point_image_usage").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM knowledge_point_image_deletions").get().n,0);
  env.BUCKET.put=async()=>{puts++;throw new Error("ambiguous PUT");};
  assert.equal((await send("synthetic-upload-0002")).status,500);
  assert.equal((await send("synthetic-upload-0002")).status,409);
  assert.equal(puts,2,"retry must not repeat an uncertain PUT or reserve twice");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM knowledge_point_image_usage").get().n,2);
});
test("a delayed attachment commit after an empty recovery read never loses its R2 object", async t => {
  const db=openDatabase(t);
  db.exec("INSERT INTO users(id,email,role,status,created_at) VALUES('a','a@example.test','user','active','2026')");
  note(db,"note");
  const actual=createD1(db);
  let pending, deletes=0;
  const DB={...actual,batch:async statements=>{pending=statements;throw new Error("unknown commit outcome");}};
  const app=new Hono(); app.use("*",async(c,next)=>{c.set("user",{id:"a"});await next();}); app.route("/images",kpImagesRouter);
  const body=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1kAAAAASUVORK5CYII=","base64");
  const response=await app.request("https://example.test/images/note",{method:"POST",headers:{"Content-Type":"image/png","Idempotency-Key":"late-commit-test-0001"},body},
    {DB,BUCKET:{put:async()=>{},delete:async()=>{deletes++;}}});
  assert.equal(response.status,500);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM knowledge_point_images").get().n,0);
  assert.equal(db.prepare("SELECT upload_state FROM knowledge_point_image_usage").get().upload_state,"uploading");
  await actual.batch(pending);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM knowledge_point_images").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM knowledge_point_image_usage").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM knowledge_point_image_deletions").get().n,0);
  assert.equal(deletes,0);
});

test("concurrent image reservations cannot both claim the last byte or slot", async t => {
  const db=setup(t); const DB=createD1(db);
  reserve(db,"first",6);
  const results=await Promise.allSettled(["second","third"].map(id=>DB.prepare(
    "INSERT INTO knowledge_point_image_usage(id,user_id,r2_object_key,byte_size,upload_state,created_at) VALUES(?,'a',?,4,'uploading','2026')"
  ).bind(id,`kp-images/a/${id}`).run()));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(db.prepare("SELECT SUM(byte_size) n FROM knowledge_point_image_usage").get().n,10);
});

test("retirement commit with a lost response releases quota exactly once on retry", async t => {
  const db=setup(t); reserve(db,"i1",6);
  db.exec("UPDATE knowledge_point_image_usage SET upload_state='ready'; INSERT INTO knowledge_point_image_deletions(id,r2_object_key,queued_at) VALUES('i1','kp-images/a/i1',0)");
  let fail=true;
  const DB=createD1(db,{afterBatch:()=>{if(fail){fail=false;throw new Error("retirement response lost");}}});
  const images=[{id:"i1",r2_object_key:"kp-images/a/i1"}];
  await assert.rejects(flushRetiredImages(DB,{delete:async()=>{}},images));
  await flushRetiredImages(DB,{delete:async()=>{}},images);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM knowledge_point_image_usage").get().n,0);
  reserve(db,"new",10);
});
