// Issue #120: the "More options" row on Practice setup sits on the same grid
// and rhythm as every other setup row, folded or open, from wide desktop down
// to a phone. Geometry is only observable in a browser, so the real screen is
// measured rather than its class names.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import {Shell} from './src/App';
function Probe(){window.store=usePrepDeck();return null;}
createRoot(document.getElementById('root')).render(<PrepDeckProvider><Probe/><Shell/></PrepDeckProvider>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false,
  outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });

// One question under review, so More options holds all three of its rows.
const questions = Array.from({ length: 6 }, (_, index) => {
  const id = `q${index + 1}`;
  return { id, externalId: id.toUpperCase(), sequenceNumber: index + 1, type: "single_choice", chooseCount: 1, stem: `Stem of ${id}`,
    tags: [index % 2 ? "Networking" : "Security"], difficulty: "easy", points: 1, hasContent: false, revision: 1, needsReview: index === 1,
    options: [{ id: "A", text: "Option A" }, { id: "B", text: "Option B" }] };
});
const errors = [];

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(outputFiles.find(file => file.path.endsWith(url.pathname.slice(1)))?.contents);
    }
    res.setHeader("Content-Type", "text/html");
    return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
  const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/api/auth/turnstile") return json({ siteKey: null });
  if (url.pathname === "/api/auth/me") return json({ user: { id: "qa", email: "qa@example.test", role: "user", displayName: "QA" } });
  if (url.pathname === "/api/exams") return json({ exams: [{ id: "exam", name: "Layout fixture", slug: "exam", providers: [], questionCount: questions.length }] });
  if (url.pathname.endsWith("/practice-catalog")) return json({ questions, bookmarkedIds: [], wrongEntries: [], attemptedIds: [], archivedQuestions: [] });
  if (url.pathname === "/api/settings") return json({ showSharedNotes: true });
  if (url.pathname === "/api/annotation-settings") return json({ hl1Alias: "First", hl2Alias: "Second", hl3Alias: "Third" });
  if (url.pathname === "/api/annotations") return json({ annotations: [] });
  if (url.pathname === "/api/notes") return json({ notes: [] });
  if (url.pathname.endsWith("/learning/progress")) return json({ progress: { examId: "exam", lastSequenceNumber: null } });
  if (url.pathname === "/api/attempts/active") return json({ attempt: null });
  return json({ error: "Optional fixture route" }, 503);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

// Every setup row in document order, folded rows included only while shown:
// its title, its padding, where its label and body start, and its divider.
const measure = () => Array.from(document.querySelectorAll(".st-rows .st-row")).filter(row => row.offsetParent).map(row => {
  const style = getComputedStyle(row);
  const box = row.getBoundingClientRect();
  const label = row.querySelector(":scope > .st-row-label").getBoundingClientRect();
  const body = row.querySelector(":scope > .st-row-body").getBoundingClientRect();
  return {
    title: row.querySelector(".st-row-title").textContent,
    paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom),
    columns: style.gridTemplateColumns.split(" ").length,
    labelTop: label.top, bodyTop: body.top, bodyRight: body.right, right: box.right,
    top: box.top, bottom: box.bottom,
  };
});

const shots = process.env.SETUP_LAYOUT_SCREENSHOTS ?? process.env.SCREENSHOT_DIR;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  // Summary beside the rows, labels beside the rows, labels on top, phone.
  for (const [width, height] of [[1440, 900], [1100, 900], [900, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.store?.state.workspaceStatus === "ready");
    await page.evaluate(() => window.store.go("practice"));
    const toggle = page.locator(".st-more-toggle");
    await toggle.waitFor();

    for (const open of [false, true]) {
      if (open) { await toggle.click(); await page.getByRole("region", { name: "Answer feedback" }).waitFor(); }
      const rows = await page.evaluate(measure);
      const at = `${width}px, More options ${open ? "open" : "folded"}`;
      const titles = rows.map(row => row.title);
      assert.equal(titles[0], "Question source", at);
      assert.ok(titles.includes("More options"), `${at}: ${titles}`);
      if (open) assert.deepEqual(titles.slice(titles.indexOf("More options") + 1), ["Difficulty", "Questions under review", "Answer feedback"], at);

      // Only the first row drops its top padding and only the last its bottom
      // padding; More options and the rows folded under it keep the rhythm.
      const rhythm = rows.find(row => row.title === "Question count");
      rows.forEach((row, i) => {
        assert.equal(row.paddingTop, i ? rhythm.paddingTop : 0, `${at}: top padding of ${row.title}`);
        if (i < rows.length - 1) assert.equal(row.paddingBottom, rhythm.paddingBottom, `${at}: bottom padding of ${row.title}`);
        assert.equal(row.columns, rhythm.columns, `${at}: ${row.title} uses the same columns`);
        if (row.columns === 2) assert.ok(Math.abs(row.labelTop - row.bodyTop) < 1, `${at}: ${row.title} label and body start level`);
        assert.ok(row.bodyRight <= row.right + 0.5, `${at}: ${row.title} body stays inside its row`);
        // Rows stack edge to edge, one divider apart at most.
        if (i) assert.ok(Math.abs(row.top - rows[i - 1].bottom) <= 1.5, `${at}: ${row.title} follows ${rows[i - 1].title} without a gap`);
      });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${at}: no horizontal scroll`);

      if (shots) {
        await mkdir(shots, { recursive: true });
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${shots}/setup-layout-${width}-${open ? "open" : "folded"}.png`, fullPage: true });
      }
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("Setup layout regression passed: More options keeps the setup row grid and rhythm at every width.");
} finally {
  await browser?.close();
  server.close();
}
