// Optional integration suite: the Learning, Practice and Mock question cards
// keep their header (ID, type, Copy as prompt, then tags) and footer navigation
// in place while only the stem/answer body scrolls. Runs against a local,
// deterministic fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import("playwright");
const web = fileURLToPath(new URL("../", import.meta.url));
const { outputFiles } = await build({ stdin: { contents: `
  import React from 'react'; import { createRoot } from 'react-dom/client';
  import { PrepDeckProvider, usePrepDeck } from './src/store/PrepDeckContext';
  import LearningLive from './src/screens/LearningLive';
  import PracticeLive from './src/screens/PracticeLive';
  import MockLive from './src/screens/MockLive';
  import { breakpointsFor } from './src/lib/responsive';
  import './src/styles/tokens.css'; import './src/styles/app.css';
  function Fixture() { const app=usePrepDeck(); window.fixtureApp=app; const bp=breakpointsFor(app.width);
    return <main data-pd-theme={app.state.theme} style={{minHeight:'100vh',background:'var(--color-bg)',color:'var(--color-text)',padding:16}}>
      {app.state.screen==='learning' && app.state.lStage==='live' && <LearningLive bp={bp}/>}
      {app.state.screen==='practice' && app.state.pStage==='live' && <PracticeLive bp={bp}/>}
      {app.state.screen==='mock' && app.state.mStage==='live' && <MockLive bp={bp}/>}
    </main>;
  }
  createRoot(document.getElementById('root')).render(<PrepDeckProvider><Fixture/></PrepDeckProvider>);
`, loader: "tsx", resolveDir: web }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });

const longText = n => Array.from({ length: n }, (_, i) => `Sentence ${i + 1} describes another constraint the architecture must satisfy.`).join(" ");
const questions = [
  {
    id: "Q1", externalId: "SAP-C02-LONG-0001", sequenceNumber: 1, type: "single_choice", chooseCount: 1, difficulty: "hard",
    stem: longText(40),
    options: ["A", "B", "C", "D", "E"].map(id => ({ id, text: `Option ${id}: ${longText(6)}` })),
    tags: ["Design Solutions for Organizational Complexity", "Continuous Improvement for Existing Solutions", "Accelerate Workload Migration and Modernization"]
  },
  { id: "Q2", externalId: "Q2", sequenceNumber: 2, type: "single_choice", chooseCount: 1, difficulty: "easy", stem: "Short question", options: [{ id: "A", text: "Yes" }, { id: "B", text: "No" }], tags: [] }
];
let mockStarts = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://fixture").pathname;
  const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  if (path === "/fixture.js" || path === "/fixture.css") { res.setHeader("Content-Type", path.endsWith("css") ? "text/css" : "text/javascript"); return res.end(outputFiles.find(f => f.path.endsWith(path.slice(1)))?.contents); }
  if (!path.startsWith("/api/")) { res.setHeader("Content-Type", "text/html"); return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
  let raw = ""; for await (const part of req) raw += part;
  const input = JSON.parse(raw || "{}");
  if (path === "/api/auth/me") return json(200, { user: { id: "me", displayName: "Student", role: "user" } });
  if (path === "/api/exams") return json(200, { exams: [{ id: "exam", slug: "cloud", name: "Cloud fundamentals" }] });
  if (path.includes("practice-catalog")) return json(200, { questions, bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  if (path === "/api/attempts/active") return json(200, { attempt: null });
  if (path === "/api/exams/exam/attempts") return json(201, { attemptId: input.mode === "mock" ? `mock-${++mockStarts}` : "practice", startedAt: new Date().toISOString(), timeLimitSeconds: 3600 });
  if (path === "/api/attempts/practice/answers") return json(200, { isCorrect: true, correctAnswers: ["E"], explanation: "Explanation" });
  if (path.endsWith("/learning/progress")) return json(200, { progress: { lastSequenceNumber: null } });
  if (path.endsWith("/learning-detail")) { const q = questions.find(x => path.includes(`/${x.id}/`)) ?? questions[0]; return json(200, { question: { ...q, correctAnswers: ["E"], explanation: "Explanation" }, history: [] }); }
  if (path.endsWith("/ai-explanations")) return json(200, { explanations: [] });
  if (path === "/api/annotations") return json(200, { annotations: [] });
  if (path === "/api/notes") return json(200, { notes: [] });
  if (path === "/api/settings") return json(200, { showSharedNotes: true });
  if (path === "/api/annotation-settings") return json(200, { hl1Alias: "Important", hl2Alias: "Review", hl3Alias: "Question" });
  if (path === "/api/daily-email-settings") return json(200, { enabled: false });
  return json(200, {});
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const url = `http://127.0.0.1:${server.address().port}`;
const rect = (page, selector) => page.locator(selector).first().evaluate(el => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; });
// Wait out entry animations (not infinite ones like spinners) so positions are final.
const settle = page => page.evaluate(async () => {
  await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
});
const copyButton = page => page.getByRole("button", { name: "Copy question and answers as a Markdown prompt" });

// First header row holds only the ID, type and (when present) Copy as prompt; tags start on their own row.
async function checkHeader(page, label, { tags, copy }) {
  const typeBox = await rect(page, ".st-badges-row .st-badge--brand");
  const idBox = await rect(page, ".st-badges-row .st-q-id");
  const headBox = await rect(page, ".st-q-head");
  assert.ok(Math.abs(idBox.top - typeBox.top) <= 2, `${label}: ID and type are not on one row`);
  assert.equal(await page.locator(".st-badges-row .st-badge--info").count(), 0, `${label}: a tag rendered in the first row`);
  assert.equal(await page.locator(".st-tags").count(), tags ? 1 : 0, `${label}: tag row presence`);
  if (copy) {
    const copyBox = await copyButton(page).evaluate(el => el.getBoundingClientRect().toJSON());
    assert.ok(Math.abs(copyBox.top + copyBox.height / 2 - (typeBox.top + typeBox.bottom) / 2) <= 2, `${label}: Copy as prompt left the first row`);
    assert.ok(copyBox.right <= headBox.right, `${label}: Copy as prompt overflows the header`);
    if (tags) assert.ok((await rect(page, ".st-tags")).top >= copyBox.bottom, `${label}: tags do not start below the first row`);
  }
}

// Only the body scrolls; header and footer stay put, on screen, and the last option is reachable.
async function checkLongBody(page, label, viewport) {
  const body = page.locator(".st-q-body");
  assert.ok(await body.evaluate(el => el.scrollHeight > el.clientHeight), `${label}: long question body does not scroll`);
  const before = { head: await rect(page, ".st-q-head"), foot: await rect(page, ".st-q-foot"), y: await page.evaluate(() => window.scrollY) };
  assert.ok(before.foot.bottom <= viewport.height, `${label}: footer is below the viewport`);
  const bodyBox = await body.evaluate(el => el.getBoundingClientRect().toJSON());
  await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);
  // Stop at the end of the body: past it Practice deliberately hands the wheel on to the page.
  const atEnd = () => body.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  for (let i = 0; i < 80 && !(await atEnd()); i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(50); }
  assert.ok(await atEnd(), `${label}: wheel never reached the end of the body`);
  assert.deepEqual({ head: await rect(page, ".st-q-head"), foot: await rect(page, ".st-q-foot"), y: await page.evaluate(() => window.scrollY) }, before, `${label}: header, footer or page moved while scrolling the body`);
  const lastOption = await rect(page, ".st-opt:last-child");
  const scrolledBody = await rect(page, ".st-q-body");
  // The last option's bottom edge is in view, and so is all of it unless it is taller than the body itself.
  const padding = await body.evaluate(el => { const cs = getComputedStyle(el); return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom); });
  const fits = lastOption.bottom - lastOption.top <= scrolledBody.bottom - scrolledBody.top - padding;
  assert.ok(lastOption.bottom <= scrolledBody.bottom && (!fits || lastOption.top >= scrolledBody.top), `${label}: last option not fully reachable`);
}

// A short question starts at the top of the body and keeps the footer anchored to the card bottom.
async function checkShortBody(page, label, viewport) {
  await page.getByText("Short question").waitFor();
  assert.equal(await page.locator(".st-q-body").evaluate(el => el.scrollTop), 0, `${label}: body scroll carried over to the next question`);
  const card = await rect(page, ".st-q");
  const foot = await rect(page, ".st-q-foot");
  assert.ok(Math.abs(card.bottom - 1 - foot.bottom) <= 1, `${label}: footer not anchored to the card bottom for a short question`);
  assert.ok(foot.bottom <= viewport.height, `${label}: footer below the viewport for a short question`);
}

try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 1000 }, { width: 820, height: 700 }, { width: 390, height: 720 }]) {
    const size = `${viewport.width}x${viewport.height}`;
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**", route => route.abort());
    await page.goto(url);
    await page.waitForFunction(() => window.fixtureApp?.state.workspaceStatus === "ready");
    const shot = async name => { if (process.env.QUESTION_CARD_SCREENSHOTS) await page.screenshot({ path: `${process.env.QUESTION_CARD_SCREENSHOTS}/${name}-${size}.png` }); };

    let label = `Learning ${size}`;
    await page.evaluate(() => window.fixtureApp.beginLearning(1));
    await copyButton(page).waitFor(); await settle(page);
    await checkHeader(page, label, { tags: true, copy: true });
    await checkLongBody(page, label, viewport);
    await page.getByRole("button", { name: "Next question", exact: true }).click();
    await page.waitForFunction(() => window.fixtureApp.state.lIdx === 1);
    await checkShortBody(page, label, viewport);
    await checkHeader(page, label, { tags: false, copy: true });
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.waitForFunction(() => window.fixtureApp.state.lIdx === 0);
    await page.getByLabel("Jump to question number").fill("2");
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await page.waitForFunction(() => window.fixtureApp.state.lIdx === 1);
    await shot("learning");
    console.log(`PASS ${label}`);

    label = `Practice ${size}`;
    await page.evaluate(() => window.fixtureApp.begin(["Q1", "Q2"]));
    await page.waitForFunction(() => window.fixtureApp.state.screen === "practice" && window.fixtureApp.state.pStage === "live");
    await page.getByRole("button", { name: "Check answer", exact: true }).waitFor(); await settle(page);
    await checkHeader(page, label, { tags: true, copy: false });
    await checkLongBody(page, label, viewport);
    await page.locator(".st-opt:last-child").click();
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    await copyButton(page).waitFor();
    await checkHeader(page, label, { tags: true, copy: true });
    await page.getByRole("button", { name: "Next question", exact: true }).click();
    await page.waitForFunction(() => window.fixtureApp.state.idx === 1);
    await checkShortBody(page, label, viewport);
    await shot("practice");
    console.log(`PASS ${label}`);

    label = `Mock ${size}`;
    await page.evaluate(() => { window.fixtureApp.go("mock"); window.fixtureApp.beginMock(); });
    await page.waitForFunction(() => window.fixtureApp.state.screen === "mock" && window.fixtureApp.state.mStage === "live");
    const order = await page.evaluate(() => window.fixtureApp.state.mQueue);
    await page.evaluate(i => window.fixtureApp.mockGoto(i), order.indexOf("Q1"));
    await page.locator(".st-q-foot").waitFor(); await settle(page);
    await checkHeader(page, label, { tags: false, copy: false });
    await checkLongBody(page, label, viewport);
    await page.evaluate(i => window.fixtureApp.mockGoto(i), order.indexOf("Q2"));
    await checkShortBody(page, label, viewport);
    await page.evaluate(() => window.fixtureApp.mockGoto(0));
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.waitForFunction(() => window.fixtureApp.state.mIdx === 1);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.waitForFunction(() => window.fixtureApp.state.mIdx === 0);
    await shot("mock");
    console.log(`PASS ${label}`);

    assert.deepEqual(errors, [], `${size}: unhandled browser errors`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
