// Issue #185: actual app shell and exam-switch/save flow with synthetic APIs only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { waitUntil } from "./browser-fixture.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { outputFiles } = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext';
import {Shell} from './src/App';
function Probe(){window.store=usePrepDeck();return null;}
createRoot(document.getElementById('root')).render(<React.StrictMode><PrepDeckProvider><Probe/><Shell/></PrepDeckProvider></React.StrictMode>);
`, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const exams = [
  { id: "one", slug: "cloud-one", name: "Cloud Architecture", badgeIconUrl: "/api/exam-badges/one?v=1" },
  { id: "none", slug: "without-badge", name: "No Badge", badgeIconUrl: null },
  { id: "broken", slug: "broken-badge", name: "Broken Badge", badgeIconUrl: "/api/exam-badges/broken?v=1" },
  { id: "two", slug: "security-with-a-very-long-exam-label-that-must-not-overflow", name: "Security Engineering", badgeIconUrl: "/api/exam-badges/two?v=1" },
].map(exam => ({ ...exam, providers: [], questionCount: 0 }));
// Same URL shape as the worker: a replacement keeps the path, bumps ?v=.
const brokenBadges = new Set(["/api/exam-badges/broken?v=1"]);
let holdBadge = false;
const heldBadges = [];
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://fixture").pathname;
  const json = (data, status = 200) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
  if (path.startsWith("/api/exam-badges/")) {
    if (brokenBadges.has(req.url)) { res.writeHead(404); return res.end(); }
    const send = () => { res.setHeader("Content-Type", "image/svg+xml"); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="${path.endsWith("/two") ? "#a33" : "#36a"}"/></svg>`); };
    if (holdBadge) { heldBadges.push(send); return; }
    return send();
  }
  if (path === "/api/auth/me") return json({ user: { id: "badge-qa", email: "badge-qa@example.test", role: "user", displayName: "Badge QA" } });
  if (path === "/api/exams") return json({ exams });
  if (path.endsWith("/practice-catalog")) return json({ questions: [], bookmarkedIds: [], wrongEntries: [], attemptedIds: [], archivedQuestions: [] });
  if (path === "/api/attempts/active") return json({ attempt: null });
  if (path.endsWith("/learning/progress")) return json({ progress: { lastSequenceNumber: null } });
  if (path.endsWith("/study-status")) return json({ statuses: [] });
  if (path === "/api/settings") return json({ showSharedNotes: true });
  if (path === "/api/annotation-settings") return json({ hl1Alias: "First", hl2Alias: "Second", hl3Alias: "Third" });
  if (path === "/api/annotations") return json({ annotations: [] });
  if (path === "/api/notes") return json({ notes: [] });
  if (path.startsWith("/api/")) return json({ error: "No fixture for this optional route" }, 503);
  if (path === "/fixture.js" || path === "/fixture.css") {
    res.setHeader("Content-Type", path.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(file => file.path.endsWith(path.slice(1))).contents);
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const ready = id => page.waitForFunction(id => window.store?.state.workspaceStatus === "ready" && window.store.state.examId === id, id);
  await page.goto(`http://127.0.0.1:${server.address().port}/exams/cloud-one/practice`);
  await ready("one");
  const trigger = () => page.locator(".exam-selector__trigger:visible").first();
  const badge = () => trigger().locator(".exam-selector__badge");
  const focused = async locator => assert.equal(await locator.evaluate(el => el === document.activeElement), true);
  const checkBadge = async exam => {
    assert.match(await trigger().getAttribute("aria-label"), new RegExp(`Select exam, current exam: ${exam.name}`));
    assert.equal(await badge().getAttribute("aria-hidden"), "true");
    if (exam.badgeIconUrl && !brokenBadges.has(exam.badgeIconUrl)) {
      // The visible trigger's own image: Sidebar and TopBar both mount one.
      await badge().locator("img").evaluate(img => img.decode());
      assert.ok(await badge().locator("img").evaluate(img => img.naturalWidth) > 0);
      assert.equal(await badge().locator("img").getAttribute("src"), exam.badgeIconUrl);
      assert.equal(await badge().locator("img").getAttribute("alt"), "");
      assert.equal(await badge().locator("img").evaluate(el => getComputedStyle(el).objectFit), "contain");
    } else {
      await badge().locator(".exam-selector__badge-placeholder").waitFor();
      assert.equal(await badge().locator("img").count(), 0);
    }
    const dimensions = await badge().boundingBox();
    assert.equal(dimensions.width, 24); assert.equal(dimensions.height, 24);
    const box = await trigger().boundingBox();
    assert.ok(box.width >= 36 && box.height >= 36, "Existing usable target size retained");
    assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width);
    assert.equal(await trigger().evaluate(el => el.scrollWidth <= el.clientWidth), true);
    if (await trigger().locator(".exam-selector__name").count()) {
      assert.equal(await trigger().locator(".exam-selector__name").textContent(), exam.slug);
      const label = await trigger().locator(".exam-selector__name").boundingBox();
      assert.ok(dimensions.x + dimensions.width <= label.x, "Badge precedes label without overlap");
    }
  };
  for (const width of [320, 375, 900, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "cream", "sage", "clay", "dusk"]) {
      await page.evaluate(theme => window.store.setTheme(theme), theme);
      for (const id of ["one", "none", "broken", "two", "broken", "one"]) {
        const exam = exams.find(exam => exam.id === id);
        await trigger().press("Enter");
        assert.equal(await trigger().getAttribute("aria-expanded"), "true");
        await page.getByRole("option", { name: exam.name, exact: true }).press("Enter");
        await ready(id);
        assert.equal(await trigger().getAttribute("aria-expanded"), "false");
        // Shell makes content inert, then unmounts navigation while loading.
        // The standalone selector test covers selection focus; check Escape below.
        await checkBadge(exam);
        assert.equal(await trigger().evaluate(el => el.closest("[data-pd-theme]").dataset.pdTheme), theme);
      }
    }
    console.log(`PASS badge switching and themes at ${width}px`);
    await trigger().press("Enter");
    await page.keyboard.press("End"); await focused(page.getByRole("option", { name: "Security Engineering", exact: true }));
    await page.keyboard.press("Home"); await focused(page.getByRole("option", { name: "Broken Badge", exact: true }));
    await page.keyboard.press("ArrowDown"); await focused(page.getByRole("option", { name: "Cloud Architecture", exact: true }));
    await page.keyboard.press("Escape"); await focused(trigger());
    assert.equal(await trigger().getAttribute("aria-expanded"), "false");
    assert.equal(await trigger().evaluate(el => getComputedStyle(el).outlineStyle), "solid");
    if (process.env.SCREENSHOT_DIR) {
      mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `exam-badge-${width}.png`) });
    }
  }
  // Admin badge replacement refreshes the exam list without changing exam ID.
  await trigger().click();
  await page.getByRole("option", { name: "Broken Badge", exact: true }).click();
  await ready("broken"); await checkBadge(exams[2]);
  exams[2].badgeIconUrl = "/api/exam-badges/broken?v=2";
  await page.evaluate(() => window.dispatchEvent(new Event("prepdeck:exam-list-changed")));
  await page.waitForFunction(() => window.store.state.exams.find(exam => exam.id === "broken").badgeIconUrl === "/api/exam-badges/broken?v=2");
  await checkBadge(exams[2]);
  // A transient failure of the same URL recovers when the connection returns.
  exams[2].badgeIconUrl = "/api/exam-badges/broken?v=3"; brokenBadges.add(exams[2].badgeIconUrl);
  await page.evaluate(() => window.dispatchEvent(new Event("prepdeck:exam-list-changed")));
  await page.waitForFunction(() => window.store.state.exams.find(exam => exam.id === "broken").badgeIconUrl === "/api/exam-badges/broken?v=3");
  await checkBadge(exams[2]);
  brokenBadges.delete(exams[2].badgeIconUrl);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await checkBadge(exams[2]);
  await trigger().click();
  await page.getByRole("option", { name: "Cloud Architecture", exact: true }).click();
  await ready("one");
  // Reserve the same box before the authenticated image response arrives.
  holdBadge = true;
  await page.reload({ waitUntil: "domcontentloaded" }); await ready("one");
  const before = await trigger().boundingBox();
  await badge().locator("img").waitFor({ state: "attached" });
  // Release every held request: each mounted selector may fetch its own.
  await waitUntil("delayed badge request", () => heldBadges.length); holdBadge = false;
  for (const send of heldBadges.splice(0)) send();
  await checkBadge(exams[0]);
  assert.deepEqual(await trigger().boundingBox(), before);
  assert.deepEqual(errors, []);
  console.log("PASS: exam badges, fallback/recovery, loading layout, themes, mobile/sidebar, names and keyboard switching");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
