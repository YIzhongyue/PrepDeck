// Issue #169: real Admin / QuestionsPanel inside the application shell.
// All questions, accounts and HTTP writes are synthetic and loopback-only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody, waitUntil } from "./browser-fixture.mjs";
const engine = process.env.PLAYWRIGHT_BROWSER ?? "chromium";
const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const baseline = process.env.CAPTURE_BASELINE === "1";
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import {Shell} from './src/App';
  function Probe(){window.store=usePrepDeck();return null;}
  createRoot(document.getElementById('root')).render(<PrepDeckProvider><Probe/><Shell/></PrepDeckProvider>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false,
  outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const original = Array.from({ length: 53 }, (_, index) => ({
  id: index === 0 ? `synthetic-question-${"identifier".repeat(10)}` : `synthetic-${index + 1}`,
  examId: "exam", externalId: index === 0 ? `EXAMPLE-${"external".repeat(10)}` : `EXAMPLE-${index + 1}`,
  sequenceNumber: index + 1, type: index === 2 ? "multiple_choice" : "single_choice",
  stem: index === 0 ? "A synthetic team is planning a community library. " +
    "The rooms should support quiet reading, shared projects and accessible routes. Compare the proposed layouts and choose the plan that keeps the entrance clear while giving every visitor enough space. ".repeat(3)
    : `Synthetic question ${index + 1}: Which plan keeps the library entrance clear?`,
  options: [{ id: "A", text: "Keep the entrance clear" }, { id: "B", text: "Block the entrance" }],
  correctAnswers: index === 2 ? ["A", "B"] : ["A"], explanation: "Synthetic explanation.",
  difficulty: index === 0 ? "hard" : "easy", tags: index === 0
    ? ["Community planning and accessible public spaces", "SyntheticLongMetadataWithoutBreaks".repeat(2), "Library design"] : ["Library design"],
  points: 1, needsReview: index === 0, archivedAt: index === 2 ? "2026-01-01T00:00:00Z" : null,
  revision: 1, answerRevision: 1, answerRevisedAt: null,
}));
let rows = structuredClone(original), failList = false, failSave = false;
const writes = [], exports = [], errors = [], unexpected = [];
const exam = { id: "exam", name: "Synthetic library planning", slug: "synthetic-library", questionCount: rows.length, providers: [], archivedAt: null };
const catalog = { dimensions: [{ id: "subject", label: "Subject / classification", allLabel: "All subjects",
  values: [{ id: "library", label: "Library design", count: 53 }, { id: "none", label: "No matching questions", count: 0 }], unclassifiedCount: 0 }] };
const selection = params => rows.filter(q => (!params.get("q") || q.id === params.get("q") || q.externalId === params.get("q") || q.stem.includes(params.get("q")))
  && (!params.get("type") || q.type === params.get("type")) && (!params.get("difficulty") || q.difficulty === params.get("difficulty"))
  && (!params.get("tag") || q.tags.includes(params.get("tag"))) && (!params.get("needsReview") || String(q.needsReview) === params.get("needsReview"))
  && (!params.get("archived") || String(Boolean(q.archivedAt)) === params.get("archived"))
  && JSON.parse(params.get("classifications") || "{}").subject !== "none");
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
    res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(f => f.path.endsWith(url.pathname.slice(1)))?.contents);
  }
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname !== "/") { res.writeHead(204); return res.end(); }
    res.setHeader("Content-Type", "text/html");
    return res.end('<!doctype html><html lang="en"><head><title>Synthetic admin question list</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
  if (url.pathname === "/api/auth/me") return json({ user: { id: "synthetic", role: "admin", displayName: "Fixture", email: "fixture@example.test" } });
  if (url.pathname === "/api/exams") return json({ exams: [exam] });
  if (url.pathname === "/api/providers") return json({ providers: [] });
  if (url.pathname === "/api/admin/overview") return json({ users: { active: 1, invited: 0, revoked: 0, total: 1 }, exams: { total: 1, archived: 0 }, questions: { total: rows.length, byExam: [{ examId: exam.id, examName: exam.name, questionCount: rows.length }] }, attempts: { total: 0 } });
  if (url.pathname === "/api/settings") return json({ showSharedNotes: true });
  if (url.pathname === "/api/daily-email-settings") return json({ enabled: false, questionsPerEmail: 3, source: "wrong", sendHourLocal: 8, timezone: "UTC" });
  if (url.pathname.endsWith("/study-status")) return json({ examId: exam.id, statuses: [] });
  if (url.pathname === "/api/annotation-settings") return json({});
  if (url.pathname === "/api/annotations") return json({ annotations: [] });
  if (url.pathname === "/api/notes") return json({ notes: [] });
  if (url.pathname === "/api/attempts/active") return json({ attempt: null });
  if (url.pathname.endsWith("/practice-catalog")) return json({ questions: [], bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  if (url.pathname.endsWith("/learning/progress")) return json({ progress: { lastSequenceNumber: null } });
  if (url.pathname === "/api/admin/question-tags") return json({ tags: [...new Set(rows.flatMap(q => q.tags))] });
  if (url.pathname.endsWith("/classifications")) return json(catalog);
  if (url.pathname === "/api/exams/exam/questions" || url.pathname.endsWith("/questions/export")) {
    if (failList) { failList = false; return json({ error: "Synthetic list unavailable" }, 503); }
    const filtered = selection(url.searchParams), offset = Number(url.searchParams.get("offset") || 0);
    const questions = filtered.slice(offset, offset + Number(url.searchParams.get("limit") || 50));
    if (url.pathname.endsWith("/export")) { exports.push(questions.map(q => q.id)); return json({ file: { questions } }); }
    return json({ questions, total: filtered.length });
  }
  const match = url.pathname.match(/^\/api\/exams\/exam\/questions\/([^/]+)(?:\/(archive|unarchive))?$/);
  if (match) {
    const row = rows.find(q => q.id === decodeURIComponent(match[1]));
    assert.ok(row, "only synthetic question IDs may be requested");
    if (req.method === "GET") return json({ question: row });
    const { payload } = await readBody(req); writes.push({ id: row.id, method: req.method, action: match[2], payload });
    if (req.method === "DELETE") return json({ error: "Synthetic learning history prevents deletion. Archive instead." }, 409);
    if (match[2]) { row.archivedAt = match[2] === "archive" ? "2026-01-01T00:00:00Z" : null; return json({ question: row }); }
    if (failSave) { failSave = false; return json({ error: "Synthetic save unavailable" }, 503); }
    assert.equal(req.method, "PATCH"); assert.equal(payload.expectedRevision, row.revision);
    Object.assign(row, payload, { revision: row.revision + 1 }); return json({ question: row });
  }
  unexpected.push(`${req.method} ${url.pathname}`); return json({ error: "Unexpected fixture route" }, 404);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await playwright[engine].launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  console.log(`${engine} ${browser.version()}; synthetic HTTP fixture; DOM/keyboard checks, not screen-reader speech`);
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const list = page.locator(".admin-question-list"), row = list.locator(".admin-question-row"), first = row.first();
  const search = list.getByLabel("Search stem or exact internal / external ID");
  const clear = list.getByRole("button", { name: "Clear filters", exact: true });
  const editor = page.getByRole("dialog", { name: "Edit question", exact: true });
  const screenshot = async name => {
    if (!process.env.SCREENSHOT_DIR) return;
    mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${baseline ? "before" : "after"}-${engine}-${name}.png` });
  };
  const alignList = async () => list.evaluate(el => { const topbar = document.querySelector("main > header"); window.scrollBy(0, el.getBoundingClientRect().top - (topbar?.getBoundingClientRect().height ?? 0) - 8); });
  const ready = async count => waitUntil(`${count} visible question rows`, () => row.count(), { until: value => value === count });
  const start = async width => {
    rows = structuredClone(original); await page.setViewportSize({ width, height: 900 }); await page.goto(`${origin}/?screen=admin`);
    await page.waitForFunction(() => window.store?.state.workspaceStatus === "ready"); await page.evaluate(() => window.store.go("admin"));
    await page.getByRole("button", { name: /^Content/ }).click();
    await page.getByRole("button", { name: /Synthetic library planning.*Open/ }).click();
    await ready(50); await list.getByLabel("Filter by Subject / classification").waitFor(); await alignList();
  };
  const metrics = [];
  for (const width of [360, 390, 430, 768, 1440]) {
    await start(width);
    const measurements = await first.evaluate(el => {
      const stem = el.querySelector(".admin-question-stem").getBoundingClientRect();
      const filter = document.querySelector(".authoring-filters").getBoundingClientRect();
      return { stemWidth: stem.width, rowHeight: el.getBoundingClientRect().height, filterHeight: filter.height, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    metrics.push({ width, ...measurements });
    await screenshot(`${width}-toolbar`);
    await first.scrollIntoViewIfNeeded(); await first.evaluate(el => window.scrollBy(0, el.getBoundingClientRect().top - 80));
    await screenshot(`${width}-row`);
    if (baseline) continue;
    assert.equal(measurements.overflow, false, `${width}: no document overflow`);
    assert.ok(measurements.stemWidth >= (width <= 430 ? width - 64 : 260), `${width}: prose uses the available reading width`);
    if (width <= 430) assert.ok(measurements.filterHeight < 380, `${width}: compact filter area`);
    for (const target of [first, row.nth(2), row.last()]) {
      assert.equal(await target.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const parts = [...el.querySelectorAll(".tag, .authoring-identifier, .admin-question-stem, button")].map(part => part.getBoundingClientRect());
        return parts.every(part => part.x >= rect.x && part.right <= rect.right)
          && parts.every((part, i) => parts.slice(i + 1).every(other => Math.min(part.right, other.right) - Math.max(part.x, other.x) <= 1 || Math.min(part.bottom, other.bottom) - Math.max(part.y, other.y) <= 1));
      }), true, `${width}: content, metadata and actions stay inside their row without overlap`);
    }
    if (width <= 430) {
      for (const control of await list.locator("button, input, select").all()) {
        const box = await control.boundingBox(); if (box) assert.ok(box.width >= 44 && box.height >= 44, `${width}: touch target ${await control.getAttribute("aria-label") ?? await control.textContent()}`);
      }
    }
    // Search and every existing filter remain the same controls and query contract.
    await search.fill("Synthetic question 2:"); await search.press("Enter"); await ready(1);
    assert.match(await first.textContent(), /EXAMPLE-2/);
    await first.getByRole("button", { name: "Edit", exact: true }).tap(); await editor.waitFor();
    await editor.getByRole("button", { name: "Close question editor" }).click(); await editor.waitFor({ state: "detached" });
    assert.equal(await first.getByRole("button", { name: "Edit", exact: true }).evaluate(el => el === document.activeElement), true);
    assert.equal(await search.inputValue(), "Synthetic question 2:");
    await clear.click(); await ready(50);
    for (const [label, value, count] of [["Filter by type", "multiple_choice", 1], ["Filter by difficulty", "hard", 1], ["Filter by review state", "true", 1], ["Filter by archived state", "true", 1], ["Filter by Subject / classification", "none", 0]]) {
      await list.getByLabel(label).selectOption(value); await ready(count);
      if (!count) await list.getByText("No questions match the current filters.", { exact: true }).waitFor();
      await clear.click(); await ready(50);
    }
    await list.getByLabel("Filter by exact tag").fill(original[0].tags[0]); await ready(1);
    await clear.click(); await ready(50);
    await list.getByRole("button", { name: "Next", exact: true }).click(); await ready(3);
    await list.getByText("Page 2 of 2", { exact: true }).waitFor();
    // The last row and pagination are reachable above the real fixed TabBar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastAction = row.last().getByRole("button", { name: "Edit", exact: true });
    assert.equal(await lastAction.evaluate(el => { const rect = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); }), true);
    await screenshot(`${width}-last-page`);
    if (width <= 430) {
      // Exercise the existing shell's measured padding with extra bottom inset.
      // This is a simulated safe-area allowance, not an iOS-device assertion.
      const navigation = page.getByRole("navigation", { name: "Main navigation", exact: true });
      const padding = await navigation.evaluate(el => el.style.paddingBottom);
      await navigation.evaluate(el => { el.style.paddingBottom = "42px"; });
      await waitUntil("shell follows the taller bottom navigation", () => page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Main navigation"]');
        return parseFloat(getComputedStyle(document.querySelector("[data-pd-content]")).paddingBottom) >= nav.getBoundingClientRect().height + 19;
      }));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert.equal(await lastAction.evaluate(el => { const rect = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); }), true);
      await navigation.evaluate((el, value) => { el.style.paddingBottom = value; }, padding);
    }
    await lastAction.press("Enter"); await editor.waitFor();
    assert.match(await editor.locator("header").textContent(), /#53/);
    await editor.getByRole("button", { name: "Close question editor" }).click(); await editor.waitFor({ state: "detached" });
    assert.equal(await lastAction.evaluate(el => el === document.activeElement), true);
    await list.getByLabel("Go to page").fill("1"); await list.getByRole("button", { name: "Go", exact: true }).click(); await ready(50);
    assert.equal(await search.inputValue(), "");
    console.log(`PASS ${width}px: readable rows, containment, filters, selection/Edit/return, pagination and last-row access`);
  }
  console.log(JSON.stringify(metrics));
  if (process.env.SCREENSHOT_DIR) writeFileSync(`${process.env.SCREENSHOT_DIR}/${baseline ? "before" : "after"}-${engine}-metrics.json`, JSON.stringify(metrics, null, 2) + "\n");
  if (!baseline) {
    await start(390);
    // Keyboard traversal and visible focus: selecting a row must not open its neighbor.
    await clear.focus(); await page.keyboard.press("Tab");
    const edit = first.getByRole("button", { name: "Edit", exact: true });
    assert.equal(await edit.evaluate(el => el === document.activeElement), true);
    assert.equal(await edit.evaluate(el => { const css = getComputedStyle(el); return el.matches(":focus-visible") && css.outlineStyle !== "none" && parseFloat(css.outlineWidth) > 0; }), true);
    await page.keyboard.press("Tab"); assert.equal(await first.getByRole("button", { name: "Archive", exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Enter"); await editor.waitFor();
    const stem = editor.getByLabel("Stem · Markdown", { exact: true });
    await stem.fill("Changed synthetic library plan");
    await editor.getByRole("button", { name: "Close question editor" }).click();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click(); assert.equal(await stem.inputValue(), "Changed synthetic library plan");
    failSave = true; await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.getByText("Synthetic save unavailable", { exact: true }).waitFor(); assert.equal(await stem.inputValue(), "Changed synthetic library plan");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.getByText("Saved revision 2. No unsaved changes.", { exact: true }).waitFor();
    assert.equal(writes.at(-1).id, original[0].id); assert.equal(rows[0].stem, "Changed synthetic library plan");
    await editor.getByRole("button", { name: "Close question editor" }).click(); await editor.waitFor({ state: "detached" }); await ready(50);
    assert.equal(await edit.evaluate(el => el === document.activeElement), true);
    await edit.click(); await editor.waitFor(); await stem.fill("Discard this synthetic edit");
    await editor.getByRole("button", { name: "Close question editor" }).click(); await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await editor.waitFor({ state: "detached" }); assert.equal(rows[0].stem, "Changed synthetic library plan");
    const beforeCancel = writes.length;
    for (const action of ["Archive", "Delete"]) {
      page.once("dialog", async dialog => { assert.equal(dialog.type(), "confirm"); await dialog.dismiss(); });
      await first.getByRole("button", { name: action, exact: true }).click();
    }
    assert.equal(writes.length, beforeCancel, "cancelled destructive confirmations never write");
    page.once("dialog", async dialog => { assert.match(dialog.message(), /history are kept/); await dialog.accept(); });
    await first.getByRole("button", { name: "Archive", exact: true }).click(); await first.getByRole("button", { name: "Restore", exact: true }).waitFor();
    assert.equal(writes.at(-1).action, "archive"); await first.getByRole("button", { name: "Restore", exact: true }).click(); await first.getByRole("button", { name: "Archive", exact: true }).waitFor();
    page.once("dialog", async dialog => { assert.match(dialog.message(), /permanently/); await dialog.accept(); });
    await first.getByRole("button", { name: "Delete", exact: true }).click(); await list.getByText(/Synthetic learning history prevents deletion/).waitFor();
    assert.equal(rows.length, 53); assert.equal(writes.at(-1).method, "DELETE");
    failList = true; await search.fill("Synthetic question 2:"); await search.press("Enter"); await list.getByText(/Synthetic list unavailable/).waitFor();
    await list.getByRole("button", { name: "Retry", exact: true }).click(); await ready(1);
    const download = page.waitForEvent("download"); await list.getByRole("button", { name: "Export this page", exact: true }).click(); await download;
    assert.deepEqual(exports.at(-1), [original[1].id], "export uses the displayed selection");
    await clear.click(); await ready(50);
    await page.addScriptTag({ content: readFileSync(fileURLToPath(new URL("../../../node_modules/axe-core/axe.min.js", import.meta.url)), "utf8") });
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector(".admin-question-list"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations);
    assert.deepEqual(violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), []);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log("PASS keyboard/focus, repeated editing, failed save retention, discard, archive/restore/delete safeguards, failed list retry, selected export and axe DOM checks");
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
