// Issue #47: statistics bucketed every answer by its UTC day, so a learner in
// Japan who studied at 07:30 saw it counted the day before, and their week
// reset at 09:00 on Monday. Days, weeks, windows and the cache now follow the
// account's time zone. These drive the real queries and routes on node:sqlite.
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
const [stats, cache, { settingsRouter }, { dailyEmailSettingsRouter }, email] = await Promise.all([
  bundle("../src/lib/learningStats.ts"), bundle("../src/lib/statsCache.ts"), bundle("../src/routes/settings.ts"),
  bundle("../src/routes/dailyEmailSettings.ts"), bundle("../src/scheduled/sendDailyReviewEmails.ts"),
]);

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);
const migrationNames = readdirSync(MIGRATIONS).filter(n => n.endsWith(".sql")).sort();
const migrate = (db, names) => { for (const name of names) db.exec(readFileSync(new URL(name, MIGRATIONS), "utf8")); };

function setup(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  migrate(db, migrationNames);
  db.exec(`INSERT INTO users (id,email,role,created_at) VALUES ('u','u@test','user','2026-01-01');
    INSERT INTO exams(id,slug,name,created_at) VALUES ('e','e','E','2026-01-01')`);
  for (const n of [1, 2, 3, 4]) {
    db.prepare(`INSERT INTO questions (id, exam_id, sequence_number, type, stem, options_json, correct_answers_json, created_at, updated_at)
      VALUES (?, 'e', ?, 'single_choice', 'S', '[{"id":"A","text":"a"},{"id":"B","text":"b"}]', '["A"]', '2026-01-01', '2026-01-01')`).run(`q${n}`, n);
  }
  const kv = new Map(), kvWrites = [];
  const DB = { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { const r = db.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; } };
  } };
  const KV = {
    async get(key, type) { const v = kv.get(key); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(key, value) { kvWrites.push(key); kv.set(key, value); },
    async delete(key) { kvWrites.push(`delete:${key}`); kv.delete(key); },
  };
  const env = { DB, KV };
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: "u", role: "user" }); await next(); });
  app.route("/settings", settingsRouter);
  app.route("/daily-email-settings", dailyEmailSettingsRouter);
  const request = async (path, method = "GET", body) => {
    const response = await app.request(`https://test${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: response.status, data: await response.json() };
  };
  let n = 0;
  // One practice attempt per answer, closed a few minutes after it.
  const answerAt = (at, questionId = "q1", correct = 1) => {
    const id = `a${++n}`;
    const closed = new Date(Date.parse(at) + 5 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO attempts (id, user_id, exam_id, mode, question_ids_json, started_at, completed_at, duration_seconds, total_questions, score)
      VALUES (?, 'u', 'e', 'practice', ?, ?, ?, 300, 1, ?)`).run(id, JSON.stringify([questionId]), at, closed, correct * 100);
    db.prepare(`INSERT INTO attempt_answers (id, attempt_id, question_id, selected_answer_json, is_correct, answered_at)
      VALUES (?, ?, ?, '["A"]', ?, ?)`).run(`${id}-aa`, id, questionId, correct, at);
  };
  const setTimeZone = tz => db.prepare("UPDATE users SET timezone = ? WHERE id = 'u'").run(tz);
  return { db, env, kvWrites, request, answerAt, setTimeZone };
}

const trend = result => result.accuracyTrend.map(p => [p.date, p.attempted]);

test("a 07:30 JST answer lands on that JST day in the trend, the heatmap and Study time", async t => {
  const { env, answerAt } = setup(t);
  answerAt("2026-09-26T22:30:00.000Z"); // Sunday 2026-09-27 07:30 in Tokyo
  const now = new Date("2026-09-27T03:00:00Z");

  const tokyo = await stats.computeExamStats(env.DB, "u", "e", now, "Asia/Tokyo");
  assert.equal(tokyo.timeZone, "Asia/Tokyo");
  assert.deepEqual(trend(tokyo), [["2026-09-27", 1]]);
  assert.deepEqual(trend(await stats.computeExamStats(env.DB, "u", "e", now, "UTC")), [["2026-09-26", 1]], "UTC still counts the day before");

  const activity = await stats.computeStudyActivity(env.DB, "u", { examId: "e", timeZone: "Asia/Tokyo", now });
  assert.equal(activity.timeZone, "Asia/Tokyo");
  assert.deepEqual(activity.days.map(d => [d.date, d.questionsAnswered, d.sessionsCompleted, d.durationSeconds]), [["2026-09-27", 1, 1, 300]]);

  const page = await stats.computeExamStatsPage(env.DB, "u", "e", { trendCap: 10, tagCap: 10, mockLimit: 5, mockOffset: 0, timeZone: "Asia/Tokyo" });
  assert.deepEqual(trend(page), [["2026-09-27", 1]], "the User MCP counts the same day");
});

test("the comparison windows and New this week start at local midnight", async t => {
  const { env, answerAt } = setup(t);
  // Monday 2026-09-21 01:00 in Tokyo, still Sunday the 20th in UTC.
  answerAt("2026-09-20T16:00:00.000Z", "q1");
  // Sunday 2026-09-20 23:00 in Tokyo: the previous window.
  answerAt("2026-09-20T14:00:00.000Z", "q2", 0);
  const now = new Date("2026-09-27T03:00:00Z"); // Sunday the 27th, 12:00 in Tokyo

  const tokyo = await stats.computeExamStats(env.DB, "u", "e", now, "Asia/Tokyo");
  assert.equal(tokyo.accuracyComparison.current.attempted, 1, "the last seven Tokyo days began at 00:00 on Monday the 21st");
  assert.equal(tokyo.accuracyComparison.previous.attempted, 1);
  assert.equal(tokyo.weeklyNewQuestions, 1);

  const utc = await stats.computeExamStats(env.DB, "u", "e", now, "UTC");
  assert.equal(utc.accuracyComparison.current, null, "in UTC both answers fall on the 20th, before the window");
  assert.equal(utc.weeklyNewQuestions, 0);
});

test("days follow DST in America/New_York", async t => {
  const { env, answerAt } = setup(t);
  answerAt("2026-03-08T04:30:00.000Z", "q1"); // Saturday the 7th, 23:30 EST
  answerAt("2026-03-09T04:30:00.000Z", "q2"); // Monday the 9th, 00:30 EDT (spring forward on the 8th)
  answerAt("2026-11-02T04:30:00.000Z", "q3"); // Sunday 1 November, 23:30 EST (fall back on the 1st)
  const now = new Date("2026-11-02T12:00:00Z");

  const ny = await stats.computeExamStats(env.DB, "u", "e", now, "America/New_York");
  assert.deepEqual(trend(ny), [["2026-03-07", 1], ["2026-03-09", 1], ["2026-11-01", 1]]);
  const utc = await stats.computeExamStats(env.DB, "u", "e", now, "UTC");
  assert.deepEqual(trend(utc), [["2026-03-08", 1], ["2026-03-09", 1], ["2026-11-02", 1]]);

  const activity = await stats.computeStudyActivity(env.DB, "u", { examId: "e", timeZone: "America/New_York", now, days: 365 });
  assert.deepEqual(activity.days.map(d => [d.date, d.questionsAnswered]), [["2026-03-07", 1], ["2026-03-09", 1], ["2026-11-01", 1]]);
});

test("the User MCP's bounded trend keeps whole local days", async t => {
  const { env, answerAt } = setup(t);
  // Three Tokyo days, the middle one made of answers in two UTC days.
  answerAt("2026-09-24T03:00:00.000Z", "q1");
  answerAt("2026-09-24T16:00:00.000Z", "q2"); // 25th 01:00 JST
  answerAt("2026-09-25T10:00:00.000Z", "q3"); // 25th 19:00 JST
  answerAt("2026-09-26T03:00:00.000Z", "q4");
  const page = await stats.computeExamStatsPage(env.DB, "u", "e", { trendCap: 2, tagCap: 10, mockLimit: 5, mockOffset: 0, timeZone: "Asia/Tokyo" });
  assert.deepEqual(trend(page), [["2026-09-25", 2], ["2026-09-26", 1]]);
  assert.equal(page.accuracyTrendTruncated, true);
});

test("the stats cache cannot serve one time zone's buckets to another", async t => {
  const { env, kvWrites, answerAt, setTimeZone } = setup(t);
  answerAt(new Date(Date.now() - 60 * 60 * 1000).toISOString());
  setTimeZone("Asia/Tokyo");
  const tokyo = await cache.getOrComputeExamStats(env, "u", "e");
  assert.equal(tokyo.timeZone, "Asia/Tokyo");
  setTimeZone("America/New_York");
  const ny = await cache.getOrComputeExamStats(env, "u", "e");
  assert.equal(ny.timeZone, "America/New_York", "a new zone is computed, not read from the Tokyo entry");
  assert.equal(kvWrites.length, 2);
  assert.ok(kvWrites[0].endsWith(":Asia/Tokyo") && kvWrites[1].endsWith(":America/New_York"), kvWrites.join());
  setTimeZone("Asia/Tokyo");
  assert.equal((await cache.getOrComputeExamStats(env, "u", "e")).timeZone, "Asia/Tokyo");
  assert.equal(kvWrites.length, 2, "switching back is served from the Tokyo entry");
  await cache.invalidateExamStats(env, "u", "e");
  assert.equal(kvWrites.at(-1), kvWrites[0].replace(/^/, "delete:"), "invalidation deletes the current zone's entry");
});

test("the account's time zone is set in Settings and shared with the daily email", async t => {
  const { request } = setup(t);
  assert.equal((await request("/settings")).data.timezone, null, "not chosen yet");
  assert.equal((await request("/daily-email-settings")).data.timezone, "UTC", "the email counts in UTC until then");

  assert.equal((await request("/settings", "PATCH", { timezone: "Mars/Olympus" })).status, 400);
  assert.equal((await request("/settings", "PATCH", { timezone: 9 })).status, 400);
  const saved = await request("/settings", "PATCH", { timezone: "asia/tokyo" });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.timezone, "Asia/Tokyo", "stored in Intl's spelling");
  assert.equal((await request("/daily-email-settings")).data.timezone, "Asia/Tokyo");

  const email = await request("/daily-email-settings", "PATCH", { enabled: true, timezone: "America/New_York" });
  assert.equal(email.data.timezone, "America/New_York");
  assert.equal((await request("/settings")).data.timezone, "America/New_York", "one zone for both");
  assert.equal((await request("/settings", "PATCH", { showSharedNotes: false })).data.timezone, "America/New_York", "other settings leave it alone");
});

test("the daily email is sent at its hour in the account's time zone", async t => {
  const { db, env, setTimeZone } = setup(t);
  db.exec(`UPDATE users SET status = 'active' WHERE id = 'u';
    INSERT INTO user_email_settings (user_id, enabled, questions_per_email, source, timezone, send_hour_local, created_at, updated_at)
    VALUES ('u', 1, 3, 'bm', 'UTC', 7, '2026-01-01', '2026-01-01')`);
  setTimeZone("Asia/Tokyo");
  // 07:10 in Tokyo, 22:10 in UTC. No bookmarks, so the day is claimed and skipped.
  const result = await email.runDailyReviewEmailDelivery(env, () => Date.parse("2026-09-26T22:10:00Z"));
  assert.equal(result.skipped, 1);
  assert.deepEqual(db.prepare("SELECT local_date FROM daily_review_email_deliveries").all().map(r => r.local_date), ["2026-09-27"]);
});

test("migration 0040 keeps a daily email zone the user chose", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const index = migrationNames.findIndex(n => n.startsWith("0040_"));
  migrate(db, migrationNames.slice(0, index));
  db.exec(`INSERT INTO users (id,email,role,created_at) VALUES ('chose','a@test','user','2026-01-01'), ('default','b@test','user','2026-01-01'), ('none','c@test','user','2026-01-01');
    INSERT INTO user_email_settings (user_id, enabled, timezone, created_at, updated_at) VALUES
      ('chose', 1, 'Asia/Tokyo', '2026-01-01', '2026-01-01'), ('default', 0, 'UTC', '2026-01-01', '2026-01-01')`);
  migrate(db, migrationNames.slice(index));
  assert.deepEqual(db.prepare("SELECT id, timezone FROM users ORDER BY id").all().map(r => [r.id, r.timezone]),
    [["chose", "Asia/Tokyo"], ["default", null], ["none", null]]);
});
