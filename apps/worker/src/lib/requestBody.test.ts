import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { z } from "zod";
import { readBody, readUncheckedBody } from "./requestBody.ts";

const schema = z.object({ name: z.string("name is required").trim().min(1, "name is required") }, "Invalid JSON body");

const app = new Hono().post("/", async (c) => {
  const parsed = await readBody(c, schema);
  if (!parsed.ok) return parsed.response;
  return c.json({ name: parsed.data.name });
});

const post = (body: string) => app.request("/", { method: "POST", headers: { "Content-Type": "application/json" }, body });

test("a valid body reaches the handler as the schema's output", async () => {
  const response = await post(JSON.stringify({ name: "  Ada  " }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { name: "Ada" });
});

test("a failing body answers 400 with the first issue's message", async () => {
  const response = await post(JSON.stringify({ name: " " }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "name is required" });
});

test("a body that is not JSON is validated as null, so the schema's root message answers it", async () => {
  const response = await post("{not json");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
});

test("an unchecked body passes an object through and reads anything else as {}", async () => {
  const unchecked = new Hono().post("/", async (c) => c.json(await readUncheckedBody(c)));
  const read = async (body: string) => (await unchecked.request("/", { method: "POST", headers: { "Content-Type": "application/json" }, body })).json();
  assert.deepEqual(await read(JSON.stringify({ name: 5 })), { name: 5 });
  for (const body of ["null", "[\"name\"]", "\"text\"", "{not json"]) assert.deepEqual(await read(body), {});
});
