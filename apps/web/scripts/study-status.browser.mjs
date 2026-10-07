// Issue #119: per-question studied status, driven against the real screens.
// Which questions Learning marks is only observable in a browser: it has to
// be the displayed question once its content is shown, never a prefetch or a
// failed load, and a reset has to survive a refresh of the same exam. The
// setup screens' counts and the sessions they start are checked here too.
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

const questions = Array.from({ length: 5 }, (_, index) => {
  const id = `q${index + 1}`;
  return { id, externalId: id.toUpperCase(), sequenceNumber: index + 1, type: "single_choice", chooseCount: 1, stem: `Stem of ${id}`,
    tags: ["Domain"], difficulty: "easy", points: 1, hasContent: false, revision: 1, needsReview: false,
    options: [{ id: "A", text: "Option A" }, { id: "B", text: "Option B" }] };
});
// q4's Learning detail never loads; q5 was studied before this session.
const FAILING_DETAIL = "q4";
const statuses = new Map([["q5", { status: "studied", revision: 1, updatedAt: "2026-10-01T00:00:00.000Z" }]]);
const views = [], manual = [], detailRequests = [], started = [], errors = [];
let serial = 0;
const entry = id => ({ questionId: id, ...(statuses.get(id) ?? { status: "unstudied", revision: 0, updatedAt: null }) });
const write = (id, status) => statuses.set(id, { status, revision: (statuses.get(id)?.revision ?? 0) + 1, updatedAt: new Date().toISOString() });

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
  if (url.pathname === "/api/exams") return json({ exams: [{ id: "exam", name: "Study fixture", slug: "exam", providers: [], questionCount: questions.length }] });
  if (url.pathname.endsWith("/practice-catalog")) return json({ questions, bookmarkedIds: [], wrongEntries: [], attemptedIds: [], archivedQuestions: [] });
  // The server's rules (apps/worker/src/lib/studyStatus.ts), in miniature.
  if (url.pathname === "/api/exams/exam/study-status") return json({ examId: "exam", statuses: [...statuses.keys()].map(entry) });
  const study = url.pathname.match(/^\/api\/exams\/exam\/study-status\/([^/]+)(\/learning-view)?$/);
  if (study && study[2]) {
    const id = study[1];
    views.push(id);
    const current = entry(id);
    const applied = current.status === "unstudied" && current.revision === payload.expectedRevision;
    if (applied) write(id, "studied");
    return json({ applied, status: entry(id) });
  }
  if (study && req.method === "PUT") {
    manual.push([study[1], payload.status]);
    write(study[1], payload.status);
    return json({ applied: true, status: entry(study[1]) });
  }
  if (url.pathname === "/api/settings") return json({ showSharedNotes: true });
  if (url.pathname === "/api/annotation-settings") return json({ hl1Alias: "First", hl2Alias: "Second", hl3Alias: "Third" });
  if (url.pathname === "/api/annotations") return json({ annotations: [] });
  if (url.pathname === "/api/notes") return json({ notes: [] });
  if (url.pathname.endsWith("/learning/progress")) return json({ progress: { examId: "exam", lastSequenceNumber: null } });
  if (url.pathname.endsWith("/learning-detail")) {
    const id = url.pathname.split("/")[3];
    detailRequests.push(id);
    if (id === FAILING_DETAIL) return json({ error: "Unavailable" }, 500);
    return json({ question: { correctAnswers: ["A"], explanation: "Explanation", revision: 1, answerRevision: 1 }, history: [] });
  }
  if (url.pathname.endsWith("/ai-explanations")) return json({ explanations: [] });
  if (url.pathname.endsWith("/knowledge-points")) return json({ knowledgePoints: [], total: 0 });
  if (url.pathname === "/api/attempts/active") return json({ attempt: null });
  if (/^\/api\/exams\/[^/]+\/attempts$/.test(url.pathname) && req.method === "POST") {
    started.push({ mode: payload.mode, questionIds: payload.questionIds });
    return json({ attemptId: `attempt-${++serial}`, startedAt: new Date().toISOString(), timeLimitSeconds: null }, 201);
  }
  if (/^\/api\/attempts\/[^/]+\/answers$/.test(url.pathname) && req.method === "POST") {
    if (statuses.get(payload.questionId)?.status !== "studied") write(payload.questionId, "studied");
    return json({ isCorrect: payload.selectedAnswer[0] === "A", correctAnswers: ["A"], explanation: null, answerRevision: 1, answerRevisedAt: null, studyStatus: entry(payload.questionId) });
  }
  if (/^\/api\/attempts\/[^/]+\/complete$/.test(url.pathname)) {
    return json({ attemptId: url.pathname.split("/")[3], mode: "practice", score: 0, passed: null, correctCount: 0, totalQuestions: 0, durationSeconds: 1, breakdown: [] });
  }
  return json({ error: "Optional fixture route" }, 503);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const shots = process.env.STUDY_STATUS_SCREENSHOTS ?? process.env.SCREENSHOT_DIR;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  const state = () => page.evaluate(() => window.store.state);
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.store[method](...args), { method, args });
  const capture = async name => { if (shots) { await mkdir(shots, { recursive: true }); await page.waitForTimeout(600); await page.screenshot({ path: `${shots}/study-status-${name}.png`, fullPage: true }); } };
  const describe = () => ({ views, manual, detailRequests, statuses: Object.fromEntries(statuses) });
  const row = () => page.getByRole("region", { name: "Study status" });
  const card = (label, count) => row().getByRole("button", { name: `${label} ${count}`, exact: true });
  const summary = label => page.locator(".st-summary-row").filter({ hasText: label }).locator("span").last().textContent();
  const toggle = page.getByRole("button", { name: "Studied", exact: true });
  const shown = () => page.evaluate(() => window.store.state.lQueue[window.store.state.lIdx]);
  const showing = async id => {
    await page.waitForFunction(id => window.store.state.lQueue[window.store.state.lIdx] === id, id);
    await page.getByRole("heading", { name: new RegExp(`^Question #${id.slice(1)}\\b`) }).waitFor();
  };
  const isPressed = async () => (await toggle.getAttribute("aria-pressed")) === "true";
  // Long enough for a stray automatic mark to have been sent and answered.
  const settle = () => page.waitForTimeout(400);

  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.store?.state.workspaceStatus === "ready");

  // --- Learning setup ---------------------------------------------------------
  await invoke("go", "learning");
  await row().waitFor();
  assert.equal(await card("Any status", 5).getAttribute("aria-pressed"), "true", "every question is included by default");
  await card("Unstudied only", 4).click();
  await page.getByText("4 questions match your filters").waitFor();
  assert.equal(await summary("Study status"), "Unstudied only");
  await capture("learning-setup");

  // --- Automatic marking ------------------------------------------------------
  await page.getByRole("button", { name: "Start learning" }).click();
  await showing("q1");
  assert.deepEqual((await state()).lQueue, ["q1", "q2", "q3", "q4"], "the studied question is left out");
  await waitUntil("q1 to be marked", () => views, { until: v => v.includes("q1"), describe });
  await waitUntil("the toggle to show q1 studied", isPressed);
  // The next question's detail is prefetched, which must not mark it.
  await waitUntil("q2's detail to be prefetched", () => detailRequests, { until: r => r.includes("q2"), describe });
  await settle();
  assert.deepEqual(views, ["q1"], "a prefetch is not a visit");
  await capture("learning-live");

  await invoke("learningNext");
  await showing("q2");
  await waitUntil("q2 to be marked", () => views, { until: v => v.includes("q2"), describe });
  assert.deepEqual((await state()).lQueue, ["q1", "q2", "q3", "q4"], "marking never removes a question from the session");
  await invoke("learningPrev");
  await showing("q1");
  await settle();
  assert.deepEqual(views, ["q1", "q2"], "a studied question is not sent again");

  // --- Manual reset -----------------------------------------------------------
  assert.ok(await isPressed());
  assert.equal(await toggle.getAttribute("title"), "Mark as unstudied");
  await toggle.click();
  await waitUntil("the reset to be saved", () => manual, { until: m => m.length === 1, describe });
  assert.deepEqual(manual, [["q1", "unstudied"]]);
  await waitUntil("the toggle to show q1 unstudied", async () => !(await isPressed()));
  // A passive refresh reloads the catalog and q1's detail, still showing q1.
  const detailsBefore = detailRequests.filter(id => id === "q1").length;
  await invoke("retryWorkspace");
  await waitUntil("q1's detail to reload", () => detailRequests.filter(id => id === "q1").length, { until: n => n > detailsBefore, describe });
  await page.waitForFunction(() => window.store.state.lDetail.q1?.status === "ready");
  await settle();
  assert.equal(await shown(), "q1");
  assert.ok(!(await isPressed()), "the reset survives the refresh");
  assert.deepEqual(views, ["q1", "q2"], "the same visit does not mark it again");
  assert.equal(statuses.get("q1").status, "unstudied");
  await capture("learning-reset");

  // A failed load is not a display.
  await invoke("learningGotoSequence", 3);
  await showing("q3");
  await waitUntil("q3 to be marked", () => views, { until: v => v.includes("q3"), describe });
  await invoke("learningNext");
  await showing("q4");
  await page.waitForFunction(id => window.store.state.lDetail[id]?.status === "error", FAILING_DETAIL);
  await settle();
  assert.ok(!views.includes("q4"), "a question whose detail failed to load is not marked");
  assert.ok(!(await isPressed()));

  // Coming back to q1 is a new visit, which may mark it again.
  await invoke("learningGotoSequence", 1);
  await showing("q1");
  await waitUntil("q1 to be marked on the later visit", () => statuses.get("q1").status, { until: s => s === "studied", describe });
  await waitUntil("the toggle to show q1 studied again", isPressed);
  // Studied, but never answered: the two are kept apart.
  assert.equal((await state()).attempted.q1, undefined);

  // On a phone the toggle is icon-only beside the bookmark, keeps its name and
  // state, and pushes nothing off the screen.
  await page.setViewportSize({ width: 375, height: 800 });
  await waitUntil("the phone header to fit", () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { until: overflow => overflow === 0 });
  assert.equal((await toggle.textContent()).trim(), "", "compact on phones");
  assert.ok(await isPressed());
  await capture("learning-phone");
  await page.setViewportSize({ width: 1280, height: 900 });

  // --- Setup counts and Practice ---------------------------------------------
  await invoke("go", "learning");
  await row().waitFor();
  await card("Unstudied only", 1).waitFor();
  await card("Studied only", 4).waitFor();
  await page.getByText("1 question matches your filters").waitFor();

  await invoke("go", "practice");
  await row().waitFor();
  await card("Studied only", 4).click();
  await page.getByText("4 questions match your filters").waitFor();
  assert.equal(await summary("Study status"), "Studied only");
  await capture("practice-setup");
  await invoke("startPractice");
  await page.waitForFunction(() => window.store.state.pStage === "live");
  assert.deepEqual([...started.at(-1).questionIds].sort(), ["q1", "q2", "q3", "q5"]);
  await invoke("endSession");
  await page.waitForFunction(() => window.store.state.pStage === "setup");

  // An answer marks its question studied, whatever the answer.
  await card("Unstudied only", 1).click();
  await invoke("startPractice");
  await page.waitForFunction(() => window.store.state.pStage === "live");
  assert.deepEqual(started.at(-1).questionIds, ["q4"]);
  await page.evaluate(() => { const s = window.store; s.pick(s.state.catalogBy.q4, "B"); });
  await invoke("submit");
  await page.waitForFunction(() => window.store.state.done.q4 === "no");
  await page.waitForFunction(() => window.store.state.studyStatus.q4?.status === "studied");
  assert.deepEqual((await state()).queue, ["q4"], "the running session keeps its question");
  await invoke("endSession");
  await page.waitForFunction(() => window.store.state.pStage === "setup");
  await card("Unstudied only", 0).waitFor();
  // Only the study status empties this pool, so the notice offers the rest.
  await page.getByText("You have studied every matching question").waitFor();
  assert.equal(await page.getByRole("button", { name: "Start session" }).isDisabled(), true);
  await capture("practice-empty");
  await page.getByRole("button", { name: "Practice all 5 matching questions" }).click();
  await page.getByText("5 questions match your filters").waitFor();
  assert.equal((await state()).studyFilter, "all");

  assert.deepEqual(errors, []);
  console.log("study-status browser regression passed");
} finally {
  await browser?.close();
  server.close();
}
