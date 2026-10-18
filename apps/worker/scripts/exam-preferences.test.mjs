import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { importTs } from "../../../tests/support/bundle.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { openDatabase } from "../../../tests/support/migrations.mjs";

const { examPreferencesRouter } = await importTs(new URL("../src/routes/examPreferences.ts", import.meta.url));

function fixture(t) {
  const db = openDatabase(t);
  for (const id of ["alice", "bob"]) {
    db.prepare("INSERT INTO users(id,email,created_at) VALUES (?,?,?)").run(id, `${id}@test`, "2026-09-20");
  }
  for (const id of ["A", "B"]) {
    db.prepare("INSERT INTO exams(id,slug,name,created_at) VALUES (?,?,?,?)").run(id, id, id, "2026-09-20");
  }
  const DB = createD1(db);
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: c.req.header("x-user") ?? "alice" }); await next(); });
  app.route("/exams/:examId/preferences", examPreferencesRouter);
  const request = async (patch, exam = "A", user = "alice") => {
    const response = await app.request(`https://test/exams/${exam}/preferences`, {
      method: patch === undefined ? "GET" : "PATCH",
      headers: { "Content-Type": "application/json", "x-user": user },
      body: patch === undefined ? undefined : JSON.stringify(patch),
    }, { DB });
    return { status: response.status, body: await response.json() };
  };
  return { request };
}

test("study-plan PATCH preserves omitted fields and clears only explicit nulls", async t => {
  const { request } = fixture(t);
  assert.deepEqual((await request()).body, { examId: "A", targetDate: null, weeklyGoalMinutes: null });
  await request({ targetDate: "2026-10-27", weeklyGoalMinutes: 15 });
  assert.deepEqual(await request({ targetDate: "2026-11-01" }), {
    status: 200, body: { examId: "A", targetDate: "2026-11-01", weeklyGoalMinutes: 15 },
  });
  for (const minutes of [45, 61]) {
    assert.deepEqual((await request({ weeklyGoalMinutes: minutes })).body,
      { examId: "A", targetDate: "2026-11-01", weeklyGoalMinutes: minutes });
  }
  assert.deepEqual((await request({ targetDate: null })).body,
    { examId: "A", targetDate: null, weeklyGoalMinutes: 61 });
  assert.deepEqual((await request({ weeklyGoalMinutes: null })).body,
    { examId: "A", targetDate: null, weeklyGoalMinutes: null });
});

test("study plans are isolated by user and exam", async t => {
  const { request } = fixture(t);
  await request({ targetDate: "2026-10-27", weeklyGoalMinutes: 480 });
  await request({ weeklyGoalMinutes: 60 }, "B");
  await request({ weeklyGoalMinutes: 120 }, "A", "bob");
  assert.equal((await request()).body.weeklyGoalMinutes, 480);
  assert.equal((await request(undefined, "B")).body.weeklyGoalMinutes, 60);
  assert.equal((await request(undefined, "A", "bob")).body.weeklyGoalMinutes, 120);
  assert.equal((await request(undefined, "missing")).status, 404);
  assert.equal((await request({ weeklyGoalMinutes: 15 }, "missing")).status, 404);
});

test("invalid study-plan writes leave the persisted values unchanged", async t => {
  const { request } = fixture(t);
  const original = { targetDate: "2026-10-27", weeklyGoalMinutes: 480 };
  await request(original);
  for (const invalid of [{}, { targetDate: "2026-02-31" }, { weeklyGoalMinutes: 14 },
    { weeklyGoalMinutes: 10081 }, { weeklyGoalMinutes: 15.5 }, { weeklyGoalMinutes: "15" }]) {
    assert.equal((await request(invalid)).status, 400);
    assert.deepEqual((await request()).body, { examId: "A", ...original });
  }
});
