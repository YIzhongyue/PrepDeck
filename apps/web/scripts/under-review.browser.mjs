// Issue #94: questions still under review are marked wherever a learner meets
// them, and every setup screen can leave them out of the session it builds.
// Driven against the real screens, because both halves are only observable in
// a browser: what the cards and the summary say, and which question ids a
// session actually starts with.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody, waitUntil } from "./browser-fixture.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import {Shell} from './src/App';
function Probe(){window.store=usePrepDeck();return null;}
createRoot(document.getElementById('root')).render(<PrepDeckProvider><Probe/><Shell/></PrepDeckProvider>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false,
  outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });

// Six questions, two of them under review. "clean" is a second exam with none.
const REVIEW = new Set(["q2", "q5"]);
const questions = Array.from({ length: 6 }, (_, index) => {
  const id = `q${index + 1}`;
  return { id, externalId: id.toUpperCase(), sequenceNumber: index + 1, type: "single_choice", chooseCount: 1, stem: `Stem of ${id}`,
    tags: ["Domain"], difficulty: "easy", points: 1, hasContent: false, revision: 1, needsReview: REVIEW.has(id),
    options: [{ id: "A", text: "Option A" }, { id: "B", text: "Option B" }] };
});
const clean = questions.map(q => ({ ...q, id: `c-${q.id}`, needsReview: false }));
const started = [], errors = [];
let serial = 0;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(outputFiles.find(file => file.path.endsWith(url.pathname.slice(1)))?.contents);
    }
    res.setHeader("Content-Type", "text/html");
    return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
  const { payload } = await readBody(req);
  const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/api/auth/turnstile") return json({ siteKey: null });
  if (url.pathname === "/api/auth/me") return json({ user: { id: "qa", email: "qa@example.test", role: "user", displayName: "QA" } });
  if (url.pathname === "/api/exams") return json({ exams: [
    { id: "exam", name: "Review fixture", slug: "exam", providers: [], questionCount: questions.length },
    { id: "clean", name: "Nothing under review", slug: "clean", providers: [], questionCount: clean.length },
  ] });
  if (url.pathname.endsWith("/practice-catalog")) {
    return json({ questions: url.pathname.includes("/clean/") ? clean : questions, bookmarkedIds: [], wrongEntries: [], attemptedIds: [], archivedQuestions: [] });
  }
  if (url.pathname === "/api/settings") return json({ showSharedNotes: true });
  if (url.pathname === "/api/annotation-settings") return json({ hl1Alias: "First", hl2Alias: "Second", hl3Alias: "Third" });
  if (url.pathname === "/api/annotations") return json({ annotations: [] });
  if (url.pathname === "/api/notes") return json({ notes: [] });
  if (url.pathname.endsWith("/learning/progress")) return json({ progress: { examId: "exam", lastSequenceNumber: null } });
  if (url.pathname.endsWith("/learning-detail")) return json({ question: { correctAnswers: ["A"], explanation: "Explanation", revision: 1, answerRevision: 1 }, history: [] });
  if (url.pathname.endsWith("/ai-explanations")) return json({ explanations: [] });
  if (url.pathname.endsWith("/knowledge-points")) return json({ knowledgePoints: [], total: 0 });
  if (url.pathname === "/api/attempts/active") return json({ attempt: null });
  if (/^\/api\/exams\/[^/]+\/attempts$/.test(url.pathname) && req.method === "POST") {
    started.push({ mode: payload.mode, questionIds: payload.questionIds });
    return json({ attemptId: `attempt-${++serial}`, startedAt: new Date().toISOString(), timeLimitSeconds: payload.timeLimitSeconds ?? null }, 201);
  }
  if (/^\/api\/attempts\/[^/]+\/complete$/.test(url.pathname)) {
    return json({ attemptId: url.pathname.split("/")[3], mode: "practice", score: 0, passed: false, correctCount: 0, totalQuestions: 0, durationSeconds: 1, breakdown: [] });
  }
  return json({ error: "Optional fixture route" }, 503);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const shots = process.env.UNDER_REVIEW_SCREENSHOTS ?? process.env.SCREENSHOT_DIR;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  const state = () => page.evaluate(() => window.store.state);
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.store[method](...args), { method, args });
  const capture = async name => { if (shots) { await mkdir(shots, { recursive: true }); await page.waitForTimeout(600); await page.screenshot({ path: `${shots}/under-review-${name}.png`, fullPage: true }); } };
  const row = () => page.getByRole("region", { name: "Questions under review" });
  const choose = label => row().getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
  const pressed = async label => (await row().getByRole("button", { name: new RegExp(`^${label}\\b`) }).getAttribute("aria-pressed")) === "true";
  const summary = label => page.locator(".st-summary-row").filter({ hasText: label }).locator("span").last().textContent();
  const notice = page.getByRole("note").filter({ hasText: "This question is currently under review and may contain disputed or uncertain content." });
  const badge = page.locator(".st-q-head .st-badge--warn");
  const lastStart = () => started[started.length - 1];
  const endPractice = async () => { await invoke("endSession"); await page.waitForFunction(() => window.store.state.pStage === "setup"); };

  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.store?.state.workspaceStatus === "ready");

  // --- Practice -------------------------------------------------------------
  await invoke("go", "practice");
  await row().waitFor();
  // Plain language for learners: the row says how many and what it means,
  // never the column it comes from.
  await row().getByText("2 questions in this exam are still being reviewed and may contain disputed or uncertain content.").waitFor();
  assert.equal(await page.getByText(/needs_review|needsReview/).count(), 0);
  assert.ok(await pressed("Include"), "included by default");
  assert.ok(!(await pressed("Skip")));
  await page.getByText("6 questions match your filters").waitFor();
  assert.equal(await summary("Under review"), "Included");
  await capture("practice-setup");

  await choose("Skip");
  await page.getByText("4 questions match your filters").waitFor();
  assert.equal(await summary("Under review"), "Skipped");
  assert.ok(await pressed("Skip"));
  await invoke("startPractice");
  await page.waitForFunction(() => window.store.state.pStage === "live");
  assert.equal(lastStart().mode, "practice");
  assert.deepEqual([...lastStart().questionIds].sort(), ["q1", "q3", "q4", "q6"], "a skipping session never draws one");
  assert.equal(await notice.count(), 0, "nothing in this session is under review");
  assert.equal(await badge.count(), 0);
  await endPractice();

  // Included again, every source draws them, and each is marked when it shows.
  await invoke("go", "practice");
  await choose("Include");
  await page.getByText("6 questions match your filters").waitFor();
  await invoke("startPractice");
  await page.waitForFunction(() => window.store.state.pStage === "live");
  assert.deepEqual([...lastStart().questionIds].sort(), questions.map(q => q.id));
  await endPractice();
  await invoke("begin", ["q2", "q1"]);
  await page.waitForFunction(() => window.store.state.pStage === "live" && window.store.state.queue[0] === "q2");
  await notice.waitFor();
  assert.equal(await badge.textContent(), "Under review");
  assert.match(await badge.getAttribute("title"), /under review and may contain disputed/);
  // Distinct from the tags: it sits in the header row, not among them, and
  // carries the warning colours rather than the tag ones.
  assert.equal(await page.locator(".st-tags .st-badge--warn").count(), 0);
  const [badgeColor, tagColor] = await page.evaluate(() => [".st-q-head .st-badge--warn", ".st-tags .st-badge"].map(s => getComputedStyle(document.querySelector(s)).backgroundColor));
  assert.notEqual(badgeColor, tagColor);
  await capture("practice-live");
  await invoke("next");
  await page.waitForFunction(() => window.store.state.queue[window.store.state.idx] === "q1");
  assert.equal(await notice.count(), 0, "a question not under review carries no notice");
  assert.equal(await badge.count(), 0);
  await endPractice();

  // --- Learning -------------------------------------------------------------
  await invoke("go", "learning");
  await row().waitFor();
  assert.ok(await pressed("Include"), "Learning keeps its own choice, like its other filters");
  await choose("Skip");
  await page.getByText("4 questions match your filters").waitFor();
  assert.equal(await summary("Under review"), "Skipped");
  await page.getByRole("button", { name: "Start learning" }).click();
  await page.waitForFunction(() => window.store.state.lStage === "live");
  assert.deepEqual((await state()).lQueue, ["q1", "q3", "q4", "q6"]);
  // A link to one question opens that question, whatever the setup skipped.
  await invoke("goToQuestionForReview", "exam", "q5");
  await page.waitForFunction(() => window.store.state.lStage === "live" && window.store.state.lQueue[window.store.state.lIdx] === "q5");
  assert.equal((await state()).lSkipReview, false);
  await notice.waitFor();
  await badge.waitFor();
  await capture("learning-live");
  // On a phone the badge shares the header row with the id, the type and Copy
  // as prompt; the id gives way, and nothing pushes the page sideways — not
  // even once a copy reports back, which used to spell out "Copied" or
  // "Copy failed" in a row with no room left for it (PR #97 review).
  await page.setViewportSize({ width: 375, height: 800 });
  const copy = page.getByRole("button", { name: "Copy question and answers as a Markdown prompt" });
  await copy.waitFor();
  const headerFits = label => waitUntil(`the phone header to fit (${label})`, () => page.evaluate(() => {
    const row = document.querySelector(".st-q-head .st-badges-row");
    const box = row.getBoundingClientRect();
    const inside = [...row.children].every(child => { const r = child.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; });
    return { inside, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  }), { until: fit => fit.inside && fit.pageOverflow === 0 });
  // Polled: the phone layout settles a frame or two after the resize.
  await headerFits("idle");
  const stubClipboard = succeed => page.evaluate(succeed => Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: () => succeed ? Promise.resolve() : Promise.reject(new Error("denied")) },
  }), succeed);
  for (const [succeed, status, announced] of [[true, "copied", "Markdown prompt copied to clipboard."], [false, "error", "Could not copy the Markdown prompt."]]) {
    await stubClipboard(succeed);
    await copy.click();
    await page.locator(`.st-q-head .st-copy[data-status="${status}"]`).waitFor();
    await page.getByText(announced).waitFor();
    assert.equal((await copy.textContent()).trim(), "", `the compact button stays icon-only once ${status}`);
    await headerFits(status);
    await capture(`learning-phone-${status}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // --- Mock -----------------------------------------------------------------
  await invoke("go", "mock");
  await row().waitFor();
  assert.ok(await pressed("Include"));
  await choose("Skip");
  await page.getByText("Without the questions under review, this bank has 4 questions, so the exam uses all of them.").waitFor();
  assert.equal(await summary("Under review"), "Skipped");
  assert.ok(await pressed("Skip") && !(await pressed("Include")));
  await capture("mock-setup");
  await page.getByRole("button", { name: "Begin exam" }).click();
  await page.waitForFunction(() => window.store.state.mStage === "live");
  assert.equal(lastStart().mode, "mock");
  assert.deepEqual([...lastStart().questionIds].sort(), ["q1", "q3", "q4", "q6"]);
  assert.equal(await notice.count(), 0);

  await invoke("finishMock");
  await page.waitForFunction(() => window.store.state.mStage === "results");

  // --- A bank with nothing under review offers no such choice ---------------
  await invoke("setExamId", "clean");
  await page.waitForFunction(() => window.store.state.examId === "clean" && window.store.state.workspaceStatus === "ready");
  for (const screen of ["practice", "learning"]) {
    await invoke("go", screen);
    await page.waitForFunction(id => window.store.state.screen === id, screen);
    await page.locator(".st-summary").waitFor();
    assert.equal(await row().count(), 0, `${screen} has nothing to skip`);
    assert.equal(await page.locator(".st-summary-row").filter({ hasText: "Under review" }).count(), 0);
  }

  assert.deepEqual(errors, []);
  console.log("under-review browser regression passed");
} finally {
  await browser?.close();
  server.close();
}
