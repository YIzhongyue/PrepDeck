import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readBody, waitUntil } from "./browser-fixture.mjs";

const request = (body, type, { method = "POST", url = "/api/example" } = {}) =>
  Object.assign(Readable.from(body.length ? [Buffer.from(body)] : []), { method, url, headers: type ? { "content-type": type } : {} });

test("readBody parses JSON bodies, with or without a charset", async () => {
  assert.deepEqual((await readBody(request('{"a":1}', "application/json"))).payload, { a: 1 });
  assert.deepEqual((await readBody(request('{"a":1}', "application/json; charset=utf-8"))).payload, { a: 1 });
  assert.deepEqual((await readBody(request("", "application/json"))).payload, {});
});

test("readBody reads the form POST that starts sign-in instead of throwing (issue #83)", async () => {
  const body = await readBody(request("returnTo=%2Fexams%2Fexam%2Fmock", "application/x-www-form-urlencoded"));
  assert.equal(body.form.get("returnTo"), "/exams/exam/mock");
  assert.deepEqual(body.payload, { returnTo: "/exams/exam/mock" });
});

test("readBody leaves binary uploads alone and reads untyped JSON", async () => {
  const image = await readBody(request(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png"));
  assert.deepEqual(image.payload, {});
  assert.equal(image.raw.length, 4);
  assert.deepEqual((await readBody(request('{"b":2}'))).payload, { b: 2 });
  assert.deepEqual((await readBody(request("not json", "text/plain"))).payload, {});
});

test("readBody names the request when a body labelled JSON is not", async () => {
  await assert.rejects(readBody(request("returnTo=%2F", "application/json", { method: "PUT", url: "/api/settings" })),
    /PUT \/api\/settings sent a body labelled application\/json that is not JSON: returnTo=%2F/);
});

test("waitUntil returns the first value it accepts", async () => {
  let calls = 0;
  assert.equal(await waitUntil("the third call", () => ++calls >= 3 && calls, { interval: 1 }), 3);
  assert.deepEqual(await waitUntil("a zone", () => ({ timeZone: "Asia/Tokyo" }), { until: s => s.timeZone === "Asia/Tokyo" }), { timeZone: "Asia/Tokyo" });
});

test("waitUntil reports what it last read and the caller's context", async () => {
  await assert.rejects(waitUntil("the zone", () => ({ timeZone: null }), { until: s => s.timeZone, timeout: 20, interval: 5, describe: () => ["GET /api/settings"] }),
    error => error.message.includes("waiting for the zone") && error.message.includes('{"timeZone":null}') && error.message.includes('["GET /api/settings"]'));
  await assert.rejects(waitUntil("a page", () => { throw new Error("Target closed"); }, { timeout: 10, interval: 5 }), /reading it threw Target closed/);
});
