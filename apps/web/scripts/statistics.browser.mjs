// implementation — the redesigned Statistics screen against a local, deterministic
// HTTP fixture. Optional integration suite: no real account, database or
// external API is used.
//
// Like settings.browser.mjs this compiles src/styles/untitled-ui.css with the
// standalone Tailwind CLI, because esbuild cannot process `@import
// "tailwindcss"`, `@theme` or `@plugin`, and the screen now paints badges,
// progress circles and charts through those bindings.
//
// What it proves, in order: the concept's hierarchy renders from real data and
// nothing from the screenshot is hardcoded; readiness, coverage, accuracy and
// the pass line stay four distinct figures; every empty/partial state has its
// own wording; the calls to action carry their full filter set into Practice;
// the charts have text alternatives; and all five schemes render at three
// widths without page overflow.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import("playwright");
const web = fileURLToPath(new URL("../", import.meta.url));

const tailwindOut = join(await mkdtemp(join(tmpdir(), "prepdeck-stats-")), "untitled-ui.css");
execFileSync(
  process.execPath,
  [resolve(web, "../../node_modules/@tailwindcss/cli/dist/index.mjs"), "-i", resolve(web, "src/styles/untitled-ui.css"), "-o", tailwindOut],
  { cwd: web, stdio: "pipe" }
);
const untitledUiCss = await readFile(tailwindOut, "utf8");

const { outputFiles } = await build({ stdin: { contents: `
  import React, { useEffect } from 'react'; import { createRoot } from 'react-dom/client';
  import { PrepDeckProvider, usePrepDeck } from './src/store/PrepDeckContext';
  import Dashboard from './src/screens/Dashboard';
  import './src/styles/tokens.css'; import './src/styles/app.css';

  function Fixture() { const app = usePrepDeck(); window.fixtureApp = app;
    useEffect(() => app.go('dash'), []);
    return <div data-pd-theme={app.state.theme} style={{minHeight:'100vh',background:'var(--color-bg)',color:'var(--color-text)',fontFamily:'var(--font-body)',padding:16}}>
      <Dashboard/>
    </div>;
  }
  createRoot(document.getElementById('root')).render(<PrepDeckProvider><Fixture/></PrepDeckProvider>);
`, loader: "tsx", resolveDir: web }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic",
  alias: { "@": resolve(web, "src") }, define: { "process.env.NODE_ENV": '"development"' } });

// --- Fixture data ---------------------------------------------------------
// Deliberately self-consistent (implementation, decision 5): the weekly bars, the
// total, the goal percentage and the session average all come from these same
// day rows, so no assertion below can pass against invented arithmetic.
const LONG_TAG = "Networking, Content Delivery and Hybrid Connectivity Design";
const EXAM_NAME = "AWS Certified Solutions Architect – Professional (SAP-C02)";

const bankQuestion = (id, tags, difficulty, sequenceNumber) => ({
  id, externalId: null, sequenceNumber, type: "single_choice", stem: `Question ${id}`,
  options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], chooseCount: 1, tags, difficulty, points: 1,
});

// 12 questions across four tags: 6 networking, 4 cost, 1 security, and one
// "Migration Planning" question nobody has answered — the evidence-floor case.
const QUESTIONS = [
  ...Array.from({ length: 6 }, (_, i) => bankQuestion(`n${i + 1}`, [LONG_TAG], i < 4 ? "hard" : "medium", i + 1)),
  ...Array.from({ length: 4 }, (_, i) => bankQuestion(`c${i + 1}`, ["Cost Optimization"], "medium", 7 + i)),
  bankQuestion("s1", ["Security & Identity"], "easy", 11),
  bankQuestion("s2", ["Migration Planning"], "easy", 12),
];
const ATTEMPTED = ["n1", "n2", "n3", "c1", "c2", "s1"];
const WRONG = [
  { questionId: "n1", wrongCount: 3, lastWrongAt: "2026-09-19T10:00:00Z" },
  { questionId: "n2", wrongCount: 1, lastWrongAt: "2026-09-18T10:00:00Z" },
  { questionId: "c1", wrongCount: 2, lastWrongAt: "2026-05-01T10:00:00Z" },
];

const ACTIVITY_DAYS = [
  { date: "2026-09-14", sessionsCompleted: 1, questionsAnswered: 8, durationSeconds: 2040, sessionsWithDuration: 1 },
  { date: "2026-09-16", sessionsCompleted: 2, questionsAnswered: 14, durationSeconds: 3120, sessionsWithDuration: 2 },
  // A day whose session recorded no duration at all: unavailable, not zero.
  { date: "2026-09-18", sessionsCompleted: 1, questionsAnswered: 6, durationSeconds: null, sessionsWithDuration: 0 },
  { date: "2026-09-19", sessionsCompleted: 2, questionsAnswered: 12, durationSeconds: 4200, sessionsWithDuration: 2 },
];
// 2040 + 3120 + 4200 = 9360s = 2h 36m, over five sessions that recorded one.
const RECORDED_SECONDS = 9360;

const fullStats = () => ({
  examId: "exam", schemaVersion: 2,
  totalAttempted: 6, attemptedInBank: 6, bankSize: 12,
  totalAnswers: 41, totalCorrect: 27, overallAccuracyPct: 66,
  passMarkPct: 75, weeklyNewQuestions: 4,
  accuracyComparison: {
    days: 7,
    current: { attempted: 20, correct: 15, accuracyPct: 75 },
    previous: { attempted: 21, correct: 12, accuracyPct: 57 },
    deltaPts: 18,
  },
  accuracyTrend: [
    { date: "2026-09-14", attempted: 8, correct: 4, accuracyPct: 50 },
    { date: "2026-09-16", attempted: 14, correct: 8, accuracyPct: 57 },
    { date: "2026-09-18", attempted: 6, correct: 4, accuracyPct: 67 },
    { date: "2026-09-19", attempted: 13, correct: 11, accuracyPct: 85 },
  ],
  byTag: [
    { tagId: "t-net", tag: LONG_TAG, attempted: 21, correct: 11, accuracyPct: 52 },
    { tagId: "t-cost", tag: "Cost Optimization", attempted: 14, correct: 9, accuracyPct: 64 },
    { tagId: "t-sec", tag: "Security & Identity", attempted: 6, correct: 5, accuracyPct: 83 },
  ],
  byDifficulty: [
    { difficulty: "hard", attempted: 20, correct: 10, accuracyPct: 50 },
    { difficulty: "medium", attempted: 15, correct: 12, accuracyPct: 80 },
    { difficulty: "easy", attempted: 6, correct: 5, accuracyPct: 83 },
  ],
  mockScoreHistory: [
    { attemptId: "m1", completedAt: "2026-09-05T10:00:00Z", score: 58, totalQuestions: 65, passed: false },
    { attemptId: "m2", completedAt: "2026-09-12T10:00:00Z", score: 82, totalQuestions: 65, passed: true },
  ],
  bestMock: { attemptId: "m2", completedAt: "2026-09-12T10:00:00Z", score: 82, totalQuestions: 65, passed: true },
  lastAttemptAt: "2026-09-19T10:00:00Z",
});

let stats = fullStats();
let activity = { days: ACTIVITY_DAYS, activeDayCount: 4, averageSessionSeconds: 1560, sessionsCompleted: 6, sessionsWithDuration: 5 };
let preferences = { examId: "exam", targetDate: null, weeklyGoalMinutes: null };
let statsStatus = 200;
let activityStatus = 200;
let preferencesStatus = 200;
let preferencesPatches = [];
const attemptRequests = [];
const requestCounts = { stats: 0, activity: 0, preferences: 0 };
const gates = {};

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    if (path === "/fixture.js" || path === "/fixture.css") {
      res.setHeader("Content-Type", path.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(outputFiles.find(f => f.path.endsWith(path.slice(1)))?.contents);
    }
    if (path === "/untitled-ui.css") { res.setHeader("Content-Type", "text/css"); return res.end(untitledUiCss); }
    if (!path.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      return res.end('<!doctype html><html data-pd-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<link rel="stylesheet" href="/untitled-ui.css"><link rel="stylesheet" href="/fixture.css">'
        + '</head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>');
    }
    let raw = Buffer.alloc(0); for await (const part of req) raw = Buffer.concat([raw, part]);
    const input = JSON.parse(raw.toString() || "{}");
    if (path === "/api/auth/me") return json(200, { user: { id: "me", displayName: "Example Student", email: "y@example.test", role: "user" } });
    if (path === "/api/exams") return json(200, { exams: [{ id: "exam", slug: "sap-c02", name: EXAM_NAME }] });
    if (path.includes("practice-catalog")) {
      return json(200, { questions: QUESTIONS, bookmarkedIds: [], wrongEntries: WRONG, attemptedIds: ATTEMPTED });
    }
    if (path === "/api/attempts/active") return json(200, { attempt: null });
    if (path === "/api/annotations") return json(200, { annotations: [] });
    if (path === "/api/notes") return json(200, { notes: [] });
    if (path.endsWith("/learning/progress")) return json(200, { progress: { lastSequenceNumber: null } });
    if (path.endsWith("/stats")) {
      requestCounts.stats++;
      await gates.stats;
      return json(statsStatus, statsStatus === 200 ? stats : { error: "boom" });
    }
    if (path === "/api/stats/activity") {
      requestCounts.activity++;
      await gates.activity;
      return json(activityStatus, activityStatus === 200 ? activity : { error: "boom" });
    }
    if (path.endsWith("/attempts") && req.method === "POST") {
      attemptRequests.push(input);
      return json(200, { attemptId: "practice-test" });
    }
    if (path.endsWith("/preferences")) {
      if (req.method === "PATCH") { preferencesPatches.push(input); preferences = { ...preferences, ...input }; }
      else {
        requestCounts.preferences++;
        await gates.preferences;
        if (preferencesStatus !== 200) return json(preferencesStatus, { error: "boom" });
      }
      return json(200, preferences);
    }
    if (path === "/api/settings") return json(200, { showSharedNotes: false, theme: null });
    if (path === "/api/annotation-settings") return json(200, { hl1Alias: "A", hl2Alias: "B", hl3Alias: "C" });
    if (path === "/api/daily-email-settings") return json(200, { enabled: false, questionsPerEmail: 3, source: "wrong", sendHourLocal: 8, timezone: "UTC" });
    return json(200, {});
  } catch (err) { res.writeHead(500); res.end(String(err)); }
});

await new Promise(done => server.listen(0, done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
// Keep UTC week/date assertions independent of the machine's current date.
await page.clock.setFixedTime(new Date("2026-09-19T12:00:00Z"));
const failures = [];
page.on("pageerror", err => failures.push(String(err)));

const THEMES = ["light", "cream", "sage", "clay", "dusk"];
const setTheme = theme => page.evaluate(t => window.fixtureApp.setTheme(t), theme);
const wait = async (check, label) => {
  for (let i = 0; i < 120; i++) { if (await check()) return; await page.waitForTimeout(50); }
  throw new Error(`timed out waiting for ${label}`);
};
const reload = async () => {
  await page.goto(base);
  await page.getByRole("heading", { name: /Good to see you/ }).waitFor();
  await page.getByRole("heading", { name: "Where to focus" }).waitFor();
  // The wrong book and the focus counts come from the practice catalog, which
  // loads independently of the stats request; without this the assertions
  // below race an empty workspace.
  await wait(() => page.evaluate(() => window.fixtureApp.state.workspaceStatus === "ready"), "the practice catalog");
  // Both chart cards are lazy chunks; wait for them so assertions never race
  // a Suspense fallback.
  await page.getByRole("heading", { name: "Accuracy trend" }).waitFor();
  await page.getByRole("heading", { name: "Study time" }).waitFor();
  await page.waitForTimeout(60);
};
// The exam date is a segmented React Aria field (components/base/date-picker),
// not a native `<input type="date">`, because the native control draws its
// placeholders and its calendar in the *browser's* UI language. So a date is
// typed into its month/day/year segments and removed with its own clear
// button, rather than filled as one string.
const setExamDate = async (value) => {
  const clear = page.getByRole("button", { name: /Clear date/ });
  if (await clear.count()) await clear.click();
  if (!value) return;
  const [year, month, day] = value.split("-");
  await page.getByRole("spinbutton", { name: /^month/ }).click();
  await page.keyboard.type(`${month}${day}${year}`);
  const group = page.getByRole("group", { name: "Exam date" });
  await wait(async () => (await group.innerText()).replace(/\s/g, "") === `${month}/${day}/${year}`,
    `the exam date to read ${value}`);
};

const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// Names what actually widened the page, which is otherwise a long hunt: only
// elements reaching past the viewport but inside the scroll width count, since
// anything further out is clipped by an ancestor and is not the cause.
const overflowHint = async () => {
  const culprits = await page.evaluate(() => Array.from(document.querySelectorAll("*"))
    .filter(el => {
      const right = el.getBoundingClientRect().right;
      return right > document.documentElement.clientWidth + 1 && right <= document.documentElement.scrollWidth + 1;
    })
    .slice(0, 5)
    .map(el => {
      const cls = typeof el.className === "string" ? el.className : el.className?.baseVal || "";
      return `${el.tagName}${cls ? "." + cls.split(/\s+/).slice(0, 2).join(".") : ""}@${Math.round(el.getBoundingClientRect().right)}px`;
    }));
  return culprits.length ? ` (widened by ${culprits.join(", ")})` : "";
};

const screenshotDir = process.env.STATISTICS_SCREENSHOTS || process.env.SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });

try {
  await reload();

  // --- The concept's hierarchy, from real data ----------------------------
  await page.getByRole("heading", { name: `Good to see you, Example Student` }).waitFor();
  await page.getByRole("heading", { name: EXAM_NAME }).waitFor();
  for (const card of ["Answered", "Accuracy", "Wrong book", "Best mock"]) {
    await page.getByRole("heading", { name: card, exact: true }).waitFor();
  }
  await page.getByRole("heading", { name: "Accuracy trend" }).waitFor();
  await page.getByRole("heading", { name: "Study time" }).waitFor();

  // --- Nothing from the screenshot is hardcoded ---------------------------
  const body = () => page.locator("body").innerText();
  const text = await body();
  assert.ok(text.includes("6 / 12"), "the Answered card shows the fixture's own 6 of 12, not the concept's 287/420");
  assert.ok(text.includes("66%"), "accuracy comes from the fixture");
  assert.ok(!text.includes("287") && !text.includes("420"), "no figure from the design concept survives as live data");
  assert.ok(!/\b71%\s*ready/i.test(text), "the concept's 71% readiness is not hardcoded");

  // --- Readiness, coverage, accuracy and the pass line stay distinct ------
  // 41 answers over 6 questions is below the evidence floor, so the ring shows
  // coverage, says so, and explains why.
  assert.ok(/Readiness needs at least 30 answered questions/.test(text), "readiness is withheld below its sample floor");
  assert.ok(text.includes("50%"), "the ring falls back to the fixture's 50% coverage");
  assert.ok(text.includes("vs 75% pass line"), "the pass line is the exam's own, shown separately from accuracy");
  const ring = page.getByRole("progressbar", { name: "Question bank covered", exact: true }).first();
  assert.match(await ring.getAttribute("aria-valuetext"), /^Readiness is not available yet/);

  // --- Delta chip is the API's window, not an invented comparison ---------
  assert.ok(text.includes("+18 pts"), "the accuracy delta is the API's own 7-day comparison");

  // --- Wrong book says severity, never a review schedule ------------------
  assert.ok(/3\s*saved/.test(text), "three unmastered wrong-book entries in the current bank");
  assert.ok(text.includes("missed more than once"), "the wrong book reports repeat misses");
  assert.ok(!/due (today|for review)/i.test(text), "nothing claims a review is due: PrepDeck has no scheduling model");

  // --- Best mock, from the same attempt the history lists -----------------
  assert.ok(text.includes("82%") && text.includes("Passed"), "the best mock is the fixture's 82% pass");
  assert.ok(text.includes("2 attempts"), "the attempt count is the real history length");

  // --- Charts carry names and a data alternative --------------------------
  const trendData = page.locator(".pd-stats-data summary").first();
  await trendData.waitFor();
  await trendData.click();
  await page.getByRole("table", { name: "Accuracy by active day" }).waitFor();
  assert.ok((await body()).includes("Last 4 active days"), "the trend labels the number of days it actually shows");

  // --- Study time: zero, unavailable and real durations read differently --
  const weekTable = page.getByRole("table", { name: "Recorded study time by day this week" });
  await page.locator(".pd-stats-data summary").nth(1).click();
  await weekTable.waitFor();
  const weekRows = await weekTable.locator("tbody tr").allInnerTexts();
  assert.equal(weekRows.length, 7, "a week always has seven rows");
  assert.ok(weekRows.some(r => r.startsWith("Fri") && r.includes("?")), "Friday's session recorded no duration and shows as unknown");
  assert.ok(weekRows.some(r => r.startsWith("Tue") && r.includes("—")), "Tuesday had no sessions and shows as nothing studied");
  assert.ok(weekRows.some(r => r.includes("1h 10m")), "Saturday's 4200s renders as 1h 10m");
  assert.ok((await body()).includes("2h 36m"), `the week total is the sum of the same rows (${RECORDED_SECONDS}s)`);

  // --- The study plan is the user's, and missing values prompt for one ----
  await page.getByRole("button", { name: "Set exam date" }).waitFor();
  await page.getByRole("button", { name: "Set weekly goal" }).waitFor();
  assert.ok(!/days left/.test(await body()), "no countdown is shown before a date is set");

  await page.getByRole("button", { name: "Set exam date" }).click();
  await page.getByRole("dialog", { name: "Study plan" }).waitFor();
  // The backdrop is `position: fixed`, so it must cover the viewport. It did
  // not: `.pd-stats` carried a forwards-filling `transform` animation, which
  // made it the containing block for fixed descendants and shrank the overlay
  // to the content column, leaving the sidebar live behind an open modal.
  const backdrop = await page.locator(".dialog-backdrop").boundingBox();
  const viewport = page.viewportSize();
  assert.deepEqual(
    { x: backdrop.x, y: backdrop.y, width: backdrop.width, height: backdrop.height },
    { x: 0, y: 0, width: viewport.width, height: viewport.height },
    "the modal backdrop covers the whole viewport, not just the content column",
  );

  await setExamDate("2026-10-27");
  await page.getByRole("spinbutton", { name: /Weekly study goal/ }).fill("8");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await wait(() => preferencesPatches.length === 1, "the study plan PATCH");
  assert.deepEqual(preferencesPatches[0], { targetDate: "2026-10-27", weeklyGoalMinutes: 480 }, "hours are persisted as minutes");
  // The date itself is formatted in the viewer's locale, so the assertion is
  // on the countdown the screen computes, not on a particular rendering of it.
  await page.getByText(/\d+ days left/).waitFor();
  await page.getByText(/% of goal/).waitFor();

  // --- The date field stays English whatever language the browser is in ---
  // A native `<input type="date">` takes its placeholders and its calendar
  // from the browser's UI language, not from `<html lang>`, so in a Chinese
  // Chrome it read 年/月/日 inside this English-only app. Its replacement
  // renders both itself, pinned to en-US — which only a non-English browser
  // can actually prove, hence the separate context.
  const zh = await browser.newPage({ viewport: { width: 1280, height: 1100 }, locale: "zh-CN" });
  try {
    await zh.clock.setFixedTime(new Date("2026-09-19T12:00:00Z"));
    await zh.goto(base);
    await zh.getByRole("button", { name: /Change your study plan/ }).click();
    await zh.getByRole("dialog", { name: "Study plan" }).waitFor();
    const dateGroup = zh.getByRole("group", { name: "Exam date" });
    assert.deepEqual(await dateGroup.getByRole("spinbutton").allInnerTexts(), ["10", "27", "2026"],
      "the saved date reads back as month/day/year, not as Chinese segments");

    await zh.getByRole("button", { name: /Choose date/ }).click();
    const calendar = zh.getByRole("application");
    await calendar.waitFor();
    assert.equal((await calendar.getByRole("heading").innerText()).trim(), "October 2026",
      "the calendar names the selected month in English");
    assert.deepEqual((await calendar.locator("th").allInnerTexts()).map(s => s.trim()),
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], "so do its weekday headers");
    // Catch-all: the day cells' accessible names are dates too ("Tuesday,
    // October 27, 2026"), so no Chinese may survive anywhere in the popup.
    const calendarText = await calendar.evaluate(el =>
      el.innerText + " " + Array.from(el.querySelectorAll("[aria-label]"), n => n.getAttribute("aria-label")).join(" "));
    assert.ok(!/[一-鿿]/.test(calendarText), "nothing in the calendar falls back to the browser's language");
  } finally {
    await zh.close();
  }

  // --- Focus rows: ranking, evidence and an action that matches its label -
  const rows = page.locator(".pd-stats-focus-row");
  assert.equal(await rows.count(), 3, "three tags preview before expanding");
  const firstRow = rows.first();
  assert.ok((await firstRow.innerText()).includes(LONG_TAG), "the weakest tag leads the list");
  assert.ok((await firstRow.innerText()).includes("weakest"), "status is a word, not only a colour");
  assert.ok((await firstRow.innerText()).includes("mostly hard"), "difficulty context comes from the eligible questions");
  // n1 and n2 are wrong, n4/n5/n6 are unseen -> 5 eligible.
  const practiceTag = firstRow.getByRole("button", { name: /^Practice \d+$/ });
  assert.equal((await practiceTag.innerText()).trim(), "Practice 5", "the button labels exactly what it would practise");

  // --- A call to action states its whole filter set -----------------------
  await practiceTag.click();
  await wait(async () => (await page.evaluate(() => window.fixtureApp.state.screen)) === "practice", "navigation into Practice");
  const practiceState = await page.evaluate(() => {
    const s = window.fixtureApp.state;
    return { screen: s.screen, stage: s.pStage, source: s.source, diff: s.diff, tags: s.tags, count: s.count };
  });
  assert.deepEqual(practiceState, { screen: "practice", stage: "setup", source: "focus", diff: "all", tags: [LONG_TAG], count: 5 },
    "every practice filter is set explicitly rather than inherited");
  const eligibleIds = ["n1", "n2", "n4", "n5", "n6"];
  assert.deepEqual(await page.evaluate(() => window.fixtureApp.pool().map(q => q.id).sort()), eligibleIds,
    "the actual pool excludes answered non-wrong n3");
  await page.evaluate(() => window.fixtureApp.startPractice());
  await wait(() => attemptRequests.length === 1, "the practice POST");
  assert.deepEqual(attemptRequests[0].questionIds.slice().sort(), eligibleIds,
    "the started attempt contains exactly the advertised eligible questions");

  await reload();
  await page.getByRole("button", { name: "Practice weak tags", exact: true }).click();
  await wait(async () => (await page.evaluate(() => window.fixtureApp.state.source)) === "focus", "weak-tag navigation");
  assert.deepEqual(await page.evaluate(() => window.fixtureApp.pool().map(q => q.id).sort()),
    ["c1", "c3", "c4", ...eligibleIds].sort(), "multi-tag practice uses the same union without answered c2/n3");

  const cardText = title => page.getByRole("heading", { name: title, exact: true })
    .locator("xpath=ancestor::section[1]").innerText();

  // --- Partial failure: one request down, the rest of the page intact -----
  statsStatus = 500;
  await reload();
  await page.getByRole("alert").getByText(/Could not load statistics/).waitFor();
  await page.getByRole("heading", { name: "Study time" }).waitFor();
  for (const title of ["Exam readiness", "Answered", "Accuracy", "Best mock", "Accuracy trend", "Where to focus"]) {
    assert.match(await cardText(title), /Unavailable/, `${title} does not pretend the failed response is zero`);
  }
  assert.ok(!(await body()).includes("No mock exams completed yet"));
  assert.match(await cardText("Wrong book"), /3\s*saved/, "catalog-derived data stays available");
  assert.match(await cardText("Study time"), /2h 36m/, "successful activity stays available");
  const beforeRetry = { ...requestCounts };
  statsStatus = 200;
  await page.getByRole("button", { name: "Retry" }).click();
  await wait(async () => (await body()).includes("vs 75% pass line"), "the retry re-fetches the failed request only");
  assert.deepEqual(requestCounts, { ...beforeRetry, stats: beforeRetry.stats + 1 });

  activityStatus = 500;
  await reload();
  assert.match(await cardText("Study time"), /Unavailable/);
  assert.ok(!(await body()).includes("No completed study sessions this week"));
  assert.equal(await page.locator(".pd-stats-heatmap").count(), 0, "missing activity must not paint a zero heatmap");
  assert.match(await cardText("Accuracy"), /66%/);
  activityStatus = 200;

  // A slow response must remain loading even when the other requests succeeded.
  let releaseStats, releaseActivity;
  gates.stats = new Promise(resolve => { releaseStats = resolve; });
  gates.activity = new Promise(resolve => { releaseActivity = resolve; });
  await reload();
  assert.match(await cardText("Answered"), /Loading/);
  assert.match(await cardText("Study time"), /Loading/);
  releaseStats(); releaseActivity();
  delete gates.stats; delete gates.activity;
  await wait(async () => (await cardText("Accuracy")).includes("66%"), "delayed statistics");
  await wait(async () => (await cardText("Study time")).includes("2h 36m"), "delayed activity");

  // Missing preferences are not permission to overwrite previously saved fields.
  preferences = { examId: "exam", targetDate: "2026-10-27", weeklyGoalMinutes: 480 };
  const patchesBeforeFailure = preferencesPatches.length;
  preferencesStatus = 500;
  await reload();
  assert.equal(await page.getByRole("button", { name: "Study plan unavailable" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: /Set exam date|Set weekly goal/ }).count(), 0);
  assert.match(await cardText("Study time"), /Weekly goal unavailable/);
  assert.match(await cardText("Study time"), /2h 36m/, "a plan failure does not hide activity");
  assert.equal(preferencesPatches.length, patchesBeforeFailure);
  preferencesStatus = 200;
  await page.getByRole("button", { name: "Retry" }).click();
  await page.getByRole("button", { name: /Change your study plan/ }).waitFor();

  let releasePreferences;
  gates.preferences = new Promise(resolve => { releasePreferences = resolve; });
  await reload();
  assert.equal(await page.getByRole("button", { name: "Loading study plan…" }).isDisabled(), true);
  assert.equal(await page.getByRole("dialog").count(), 0);
  releasePreferences(); delete gates.preferences;
  await page.getByRole("button", { name: /Change your study plan/ }).click();
  assert.equal(await page.getByRole("spinbutton", { name: /Weekly study goal/ }).inputValue(), "8");
  await setExamDate("2026-11-01");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await wait(() => preferencesPatches.length === patchesBeforeFailure + 1, "date-only PATCH");
  assert.deepEqual(preferencesPatches.at(-1), { targetDate: "2026-11-01" });
  assert.equal(preferences.weeklyGoalMinutes, 480, "retrying a failed read preserves the untouched goal");

  for (const minutes of [15, 45, 61]) {
    preferences = { examId: "exam", targetDate: "2026-10-27", weeklyGoalMinutes: minutes };
    await reload();
    await page.getByRole("button", { name: /Change your study plan/ }).click();
    const goal = page.getByRole("spinbutton", { name: /Weekly study goal/ });
    assert.equal(Math.round(Number(await goal.inputValue()) * 60), minutes, "hours round-trip to the stored minutes");
    await setExamDate("2026-11-01");
    const previousPatches = preferencesPatches.length;
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await wait(() => preferencesPatches.length === previousPatches + 1, "unchanged goal save");
    assert.deepEqual(preferencesPatches.at(-1), { targetDate: "2026-11-01" });
    assert.equal(preferences.weeklyGoalMinutes, minutes);
  }

  await page.getByRole("button", { name: /Change your study plan/ }).click();
  await page.getByRole("spinbutton", { name: /Weekly study goal/ }).fill("0.25");
  let previousPatches = preferencesPatches.length;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await wait(() => preferencesPatches.length === previousPatches + 1, "fractional-hour edit");
  assert.deepEqual(preferencesPatches.at(-1), { weeklyGoalMinutes: 15 });
  assert.equal(preferences.targetDate, "2026-11-01", "editing the goal preserves the date");

  await page.getByRole("button", { name: /Change your study plan/ }).click();
  await setExamDate("");
  await page.getByRole("spinbutton", { name: /Weekly study goal/ }).fill("");
  previousPatches = preferencesPatches.length;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await wait(() => preferencesPatches.length === previousPatches + 1, "intentional clear");
  assert.deepEqual(preferencesPatches.at(-1), { targetDate: null, weeklyGoalMinutes: null });

  // --- Empty and degenerate states ----------------------------------------
  stats = { ...fullStats(), bankSize: 0, attemptedInBank: 0, totalAttempted: 0, totalAnswers: 0, totalCorrect: 0,
    overallAccuracyPct: 0, passMarkPct: null, weeklyNewQuestions: 0,
    accuracyComparison: { days: 7, current: null, previous: null, deltaPts: null },
    accuracyTrend: [], byTag: [], byDifficulty: [], mockScoreHistory: [], bestMock: null, lastAttemptAt: null };
  activity = { days: [], activeDayCount: 0, averageSessionSeconds: 0, sessionsCompleted: 0, sessionsWithDuration: 0 };
  await reload();
  const emptyText = await body();
  assert.ok(/Answer some questions|no questions yet/i.test(emptyText), "an untouched exam explains itself");
  assert.ok(emptyText.includes("No mock exams completed yet"), "no mock history is stated, not blank");
  assert.ok(emptyText.includes("Complete a practice or mock session"), "an empty trend explains what would fill it");
  assert.ok(!/\+\d+ pts/.test(emptyText), "no delta chip without both comparison windows");
  assert.ok(!/pass line/.test(emptyText), "an exam without a pass mark shows no pass comparison anywhere");
  assert.equal(await page.getByRole("button", { name: "Practice weak tags" }).isDisabled(), true,
    "the weak-tag action is disabled when no tag qualifies");

  // A single trend point still renders rather than throwing.
  stats = { ...fullStats(), accuracyTrend: [{ date: "2026-09-19", attempted: 5, correct: 3, accuracyPct: 60 }] };
  activity = { days: ACTIVITY_DAYS, activeDayCount: 4, averageSessionSeconds: 1560, sessionsCompleted: 6, sessionsWithDuration: 5 };
  await reload();
  assert.ok((await body()).includes("Last 1 active day"), "one point is labelled in the singular");

  // --- Expanding to every tag ---------------------------------------------
  stats = fullStats();
  await reload();
  assert.equal(await page.locator(".pd-stats-focus-row").count(), 3, "only the top three preview");
  await page.getByRole("button", { name: /View all 4 tags/ }).click();
  assert.equal(await page.locator(".pd-stats-focus-row").count(), 4, "expanding reveals every tag");
  const allRows = await page.locator(".pd-stats-focus-row").allInnerTexts();
  const unanswered = allRows.find(r => r.includes("Migration Planning"));
  assert.ok(unanswered, "a tag nobody has answered is still listed");
  assert.ok(unanswered.includes("needs 5 answers"), "an unmeasured tag says so instead of showing 0%");
  assert.ok(allRows.indexOf(unanswered) === allRows.length - 1, "unmeasured tags rank after every measured one");

  // --- The pre-implementation detail is still reachable -----------------------------
  await page.getByText("More detail: difficulty, mock history and long-range activity").click();
  await page.getByRole("heading", { name: "By difficulty" }).waitFor();
  await page.getByRole("heading", { name: "Mock exam history" }).waitFor();
  await page.getByRole("heading", { name: "Study activity" }).waitFor();

  // --- Five schemes, three widths, no overflow, long names intact ---------
  for (const theme of THEMES) {
    await setTheme(theme);
    await page.waitForTimeout(80);
    for (const width of [1280, 834, 375]) {
      await page.setViewportSize({ width, height: 1100 });
      // Long enough for Recharts' ResizeObserver to re-measure and re-render.
      await page.waitForTimeout(250);
      assert.ok(await noOverflow(), `${theme} at ${width}px has page overflow${await overflowHint()}`);
      const clipped = await page.locator(".pd-stats-focus-name strong").first()
        .evaluate(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1);
      assert.ok(!clipped, `${theme} at ${width}px clips the long tag name off-screen`);
      // Not merely hidden by the clip above: the chart itself has to reflow.
      const chart = await page.locator(".pd-stats-chart svg").first().evaluate(el => ({
        svg: el.getBoundingClientRect().width,
        box: el.closest(".pd-stats-chart").getBoundingClientRect().width,
      }));
      assert.ok(chart.svg <= chart.box + 1, `${theme} at ${width}px: the chart (${Math.round(chart.svg)}px) did not reflow into its card (${Math.round(chart.box)}px)`);
      if (screenshotDir && (width === 375 || theme === "light")) {
        await page.screenshot({ path: resolve(screenshotDir, `statistics-${theme}-${width}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1280, height: 1100 });
  }
  await setTheme("light");

  assert.deepEqual(failures, [], "no uncaught browser exceptions");
  console.log("Statistics browser regression passed: concept hierarchy from real data, readiness/coverage/accuracy/pass line kept distinct, "
    + "zero vs unavailable durations, empty and partial-failure states, explicit practice filters, chart data alternatives, "
    + "preserved detail sections, and 1280/834/375px in all five schemes.");
} finally {
  await browser.close();
  server.close();
}
