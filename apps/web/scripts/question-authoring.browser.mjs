// Optional browser regression: PLAYWRIGHT_MODULE may point to a bundled Playwright module.
// Runs the actual authoring components against an isolated HTTP fixture; never touches a real bank.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { normalizeTagName } from "../../../packages/shared/src/questionTags.ts";
import { normalizeImportFile, exportComponentPackage } from "../../../packages/shared/src/question-components.ts";
import { getImportSchemas } from "../../../packages/shared/src/pdf-layouts.ts";
const pdfSchemas = getImportSchemas();
let importedFile = null, schemaFailures = 0;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import QuestionsPanel from './src/components/QuestionsPanel'; import './src/styles/tokens.css'; import './src/styles/app.css';
  createRoot(document.getElementById('root')).render(<QuestionsPanel exam={{id:'exam'}}/>);`, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
let rows = [], writes = 0, tagFailures = 0, tagRequests = 0;
// Lets a test hold the question-list response open, so an assertion can run
// while a page is still in flight instead of racing it.
let heldQuestions = null, questionPageFailures = 0;
const holdQuestions = (offset = null) => (heldQuestions = { offset, gate: Promise.withResolvers(), arrived: Promise.withResolvers() });
const releaseQuestions = () => { const held = heldQuestions; heldQuestions = null; held.gate.resolve(); };
const catalog = ["tag-one", "Cloud, data", "Cloud security", "Other exam tag"];
const initialCatalog = Promise.withResolvers();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname.startsWith("/api/")) {
    if (req.method === "GET" && url.pathname === "/api/import-schemas") {
      if (schemaFailures > 0) { schemaFailures--; return json(503, { error: "Schema catalog unavailable" }); }
      return json(200, pdfSchemas);
    }
    if (req.method === "GET" && url.pathname === "/api/admin/question-tags") {
      tagRequests++;
      if (tagRequests === 1) await initialCatalog.promise;
      if (tagFailures > 0) { tagFailures--; return json(503, { error: "Tag catalog unavailable" }); }
      return json(200, { tags: [...new Set([...catalog, ...rows.flatMap(q => q.tags)])] });
    }
    if (req.method === "GET" && url.pathname.endsWith("/questions/export")) return json(200, { file: exportComponentPackage({ id: "exam", name: "Exam" }, rows), total: rows.length, offset: 0, nextOffset: null });
    if (req.method === "GET") {
      if (questionPageFailures > 0) { questionPageFailures--; return json(503, { error: "Question page unavailable" }); }
      if (heldQuestions && (heldQuestions.offset === null || String(heldQuestions.offset) === url.searchParams.get("offset"))) { heldQuestions.arrived.resolve(); await heldQuestions.gate.promise; }
      const filtered = rows.filter(q => !url.searchParams.get("q") || q.id === url.searchParams.get("q") || q.externalId === url.searchParams.get("q") || q.stem.includes(url.searchParams.get("q")));
      const offset = Number(url.searchParams.get("offset") || 0);
      return json(200, { questions: filtered.slice(offset, offset + 50), total: filtered.length });
    }
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    if (url.pathname === "/api/exams/exam/import/validate") return json(200, { valid: true, questionCount: body.questions.length, issues: [], conflicts: [] });
    if (url.pathname === "/api/exams/exam/import") {
      importedFile = body;
      return json(201, { created: body.questions.length, updated: 0, skipped: 0, failed: 0, outcomes: [] });
    }
    if (Array.isArray(body.tags)) body.tags = body.tags.map(normalizeTagName).filter(Boolean);
    if (body.stem === "server reject") return json(422, { error: "Server rejected stem", issues: [{ path: "$.stem", message: "Please correct this stem" }] });
    if (req.method === "POST") {
      const q = { ...body, id: `question-${++writes}`, examId: "exam", externalId: body.externalId ?? null, sequenceNumber: rows.length + 1, revision: 1, answerRevision: 1, answerRevisedAt: null, tags: body.tags ?? [] };
      rows.push(q); return json(201, { question: q });
    }
    if (req.method === "PATCH") {
      const q = rows.find(q => q.id === url.pathname.split("/").at(-1));
      if (q.revision !== body.expectedRevision) return json(409, { error: "This question has changed. Reopen it before saving." });
      Object.assign(q, body, { revision: q.revision + 1 }); return json(200, { question: q });
    }
    return json(404, { error: "Unknown fixture route" });
  }
  if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
    res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(f => f.path.endsWith(url.pathname.slice(1)))?.contents);
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body data-pd-theme="light"><div id="root" style="padding:20px;max-width:1120px;margin:auto"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, hasTouch: true });
  page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  // Simulate the constrained, transformed Admin container. The drawer must
  // still reach the viewport edges and leave its action bar visible.
  await page.locator("#root").evaluate(e => { e.style.transform = "translateY(6px)"; e.style.overflow = "hidden"; });
  const assertDrawer = async () => {
    const motion = await page.locator(".question-drawer").evaluate(async panel => {
      const samples = [];
      do {
        samples.push({ x: panel.getBoundingClientRect().x, scroll: panel.parentElement.scrollLeft });
        await new Promise(requestAnimationFrame);
      } while (panel.getAnimations().some(a => a.playState === "running"));
      samples.push({ x: panel.getBoundingClientRect().x, scroll: panel.parentElement.scrollLeft });
      return samples;
    });
    assert.ok(motion.every(s => s.scroll === 0), `Drawer focus scrolled its overlay: ${JSON.stringify(motion)}`);
    assert.ok(motion.every((s, i) => i === 0 || s.x <= motion[i - 1].x + 1), "Drawer animation reversed direction");
    await page.locator(".question-drawer").evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished)); });
    const bounds = await page.locator(".question-drawer").boundingBox();
    const viewport = page.viewportSize();
    assert.equal(Math.round(bounds.x + bounds.width), viewport.width);
    assert.equal(Math.round(bounds.y), 0);
    assert.equal(Math.round(bounds.height), viewport.height);
    const saveBounds = await page.getByRole("button", { name: "Save", exact: true }).boundingBox();
    assert.ok(saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= viewport.height);
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
  };
  const tagInput = page.getByRole("combobox", { name: "Tags", exact: true });
  const tagChip = name => page.getByRole("button", { name: `Remove tag ${name}`, exact: true });
  const createTag = async (raw, name = raw) => {
    await tagInput.fill(raw);
    await page.getByRole("option", { name: `Create “${name}”`, exact: true }).click();
    await tagChip(name).waitFor();
  };
  await assertDrawer();
  await tagInput.focus();
  await page.getByText("Loading tags…", { exact: true }).waitFor();
  initialCatalog.resolve();
  await page.getByRole("option", { name: "tag-one", exact: true }).waitFor();
  await page.getByLabel("Stem · Markdown", { exact: true }).fill("# **First** question");
  await page.getByLabel("Option A · Markdown", { exact: true }).fill("**Answer** A");
  await page.getByLabel("Option B · Markdown", { exact: true }).fill("Answer B");
  await page.getByLabel("Correct answer A", { exact: true }).check();
  await page.getByLabel("External ID (optional, unique in this exam)", { exact: true }).fill("PDF-1");
  await tagInput.fill("TAG-one");
  await page.getByRole("option", { name: "tag-one", exact: true }).waitFor();
  await tagInput.press("ArrowDown");
  await tagInput.press("Enter");
  await tagChip("tag-one").waitFor();
  assert.equal(await tagInput.inputValue(), "");
  // Case and surrounding spacing cannot create a duplicate chip.
  await tagInput.fill("  TAG-one  ");
  assert.equal(await page.getByRole("listbox", { name: "Available tags", exact: true }).getByRole("option").count(), 0);
  await tagInput.press("Enter");
  assert.equal(await tagChip("tag-one").count(), 1);
  await tagInput.press("Escape");
  assert.equal(await tagInput.getAttribute("aria-expanded"), "false");
  assert.equal(await page.getByRole("dialog").count(), 1);
  await tagInput.fill("  New   tag  ");
  await page.getByRole("option", { name: "Create “New tag”", exact: true }).click();
  await tagChip("New tag").focus();
  await page.keyboard.press("Enter");
  assert.equal(await tagChip("New tag").count(), 0);
  assert.equal(await tagInput.evaluate(e => e === document.activeElement), true);
  await tagInput.fill("Cloud");
  await tagInput.press("ArrowDown");
  assert.equal(await page.getByRole("option", { name: "Cloud security", exact: true }).getAttribute("aria-selected"), "true");
  await tagInput.press("ArrowUp");
  await tagInput.press("Enter");
  await tagChip("Cloud, data").waitFor();
  // Rapid additions and removals must preserve the other selected values.
  await createTag("Quick first"); await createTag("Quick second");
  await tagChip("Quick first").click(); await tagChip("Quick second").click();
  assert.equal(await tagChip("tag-one").count(), 1);
  assert.equal(await tagChip("Cloud, data").count(), 1);
  await tagInput.fill(" ");
  assert.equal(await page.getByRole("option", { name: /^Create / }).count(), 0);
  await tagInput.fill("x".repeat(201));
  assert.equal(await page.getByRole("option", { name: /^Create / }).count(), 0);
  assert.equal(await tagInput.getAttribute("aria-invalid"), "true");
  await page.getByText("Enter a tag name of 1–200 characters.", { exact: true }).waitFor();
  await tagInput.fill(`##${"x".repeat(199)}`);
  assert.equal(await page.getByRole("option", { name: /^Create / }).count(), 0);
  const hashBoundary = `#${"x".repeat(198)}`;
  await createTag(`#${hashBoundary}`, hashBoundary);
  await tagChip(hashBoundary).click();
  await tagInput.fill("");
  await tagInput.press("Escape");
  await page.getByLabel("Points", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Show Markdown preview" }).click();
  await page.getByRole("region", { name: "Markdown preview" }).getByRole("heading", { name: "First question" }).waitFor();
  tagFailures = 1;
  await page.getByRole("button", { name: "Save & add next" }).click();
  await page.getByRole("status").filter({ hasText: "Saved question #1" }).waitFor();
  assert.equal(await page.getByLabel("Stem · Markdown", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Stem · Markdown", { exact: true }).evaluate(e => e === document.activeElement), true);
  assert.equal(await page.getByLabel("External ID (optional, unique in this exam)", { exact: true }).inputValue(), "");
  assert.equal(await tagInput.inputValue(), "");
  assert.equal(await page.getByRole("button", { name: /^Remove tag / }).count(), 0);
  assert.equal(await page.getByLabel("Points", { exact: true }).inputValue(), "1");
  assert.equal(rows[0].points, 0);
  assert.deepEqual(rows[0].tags, ["tag-one", "Cloud, data"]);
  // A catalog failure keeps question editing available and retry preserves edits.
  await page.getByRole("status").filter({ hasText: "Could not load tags. You can still edit this question." }).waitFor();
  await createTag("Retry retained");
  await createTag("##literal", "#literal");
  const failedRequests = tagRequests;
  await page.getByRole("button", { name: "Retry tags", exact: true }).click();
  await tagInput.fill("Other exam");
  await page.getByRole("option", { name: "Other exam tag", exact: true }).waitFor();
  assert.ok(tagRequests > failedRequests);
  assert.equal(await tagChip("Retry retained").count(), 1);
  await tagInput.fill(""); await tagInput.press("Escape");
  await page.getByLabel("Type", { exact: true }).selectOption("true_false");
  assert.equal(await page.getByLabel("Option true · Markdown").inputValue(), "True");
  await page.getByLabel("Stem · Markdown", { exact: true }).fill("server reject");
  await page.getByLabel("Correct answer false", { exact: true }).check();
  await page.getByRole("button", { name: "Save & add next" }).click();
  await page.getByRole("alert").filter({ hasText: "Server rejected stem" }).waitFor();
  assert.equal(await page.getByLabel("Stem · Markdown", { exact: true }).inputValue(), "server reject");
  assert.equal(await tagChip("Retry retained").count(), 1);
  assert.equal(writes, 1);
  await page.getByLabel("Stem · Markdown", { exact: true }).fill("True or false?");
  await page.getByRole("button", { name: "Save & add next" }).click();
  await page.getByRole("status").filter({ hasText: "Saved question #2" }).waitFor();
  assert.equal(await page.getByLabel("Type", { exact: true }).inputValue(), "true_false");
  assert.equal(await page.getByLabel("Correct answer false", { exact: true }).isChecked(), false);
  assert.deepEqual(rows[1].tags, ["Retry retained", "#literal"]);
  assert.equal(await page.getByRole("button", { name: /^Remove tag / }).count(), 0);
  await page.getByLabel("Type", { exact: true }).selectOption("fill_blank");
  await page.getByLabel("Stem · Markdown", { exact: true }).fill("Fill **this** blank");
  await page.getByLabel("Accepted answers (one per line)").fill("first\nsecond");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByLabel("Stem · Markdown", { exact: true }).inputValue(), "Fill **this** blank");
  await page.getByRole("button", { name: "Show Markdown preview" }).click();
  const longTag = "Long tag ".repeat(22).trim();
  await createTag(longTag);
  await createTag("Mobile touch");
  await tagInput.fill("Cloud");
  await page.getByRole("listbox", { name: "Available tags", exact: true }).waitFor();
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/question-authoring-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertDrawer();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const longChip = await tagChip(longTag).boundingBox();
  assert.ok(longChip.x >= 0 && longChip.x + longChip.width <= 390, "Long tags must remain inside the mobile viewport");
  await tagChip("Mobile touch").tap();
  assert.equal(await tagChip("Mobile touch").count(), 0);
  await tagInput.fill("Cloud");
  await page.getByRole("option", { name: "Cloud, data", exact: true }).tap();
  await tagInput.fill("Other");
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/question-authoring-mobile.png`, fullPage: true });
  await tagInput.fill(""); await tagInput.press("Escape");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  assert.deepEqual(rows[2].correctAnswers, ["first", "second"]);
  assert.deepEqual(rows[2].tags, [longTag, "Cloud, data"]);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await assertDrawer();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).first().evaluate(e => e === document.activeElement), true);
  // A tag-only edit participates in the same unsaved-change boundary as other fields.
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await tagChip("Cloud, data").waitFor();
  await tagChip("tag-one").click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.deepEqual(rows[0].tags, ["tag-one", "Cloud, data"]);
  page.once("dialog", dialog => dialog.dismiss());
  assert.equal(await page.evaluate(() => window.dispatchEvent(new Event("prepdeck:before-navigate", { cancelable: true }))), false);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.deepEqual(rows[0].tags, ["Cloud, data"]);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await tagChip("Cloud, data").waitFor();
  assert.equal(await tagChip("tag-one").count(), 0);
  await tagChip("Cloud, data").click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.deepEqual(rows[0].tags, []);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  rows[0].revision++;
  await page.getByLabel("Stem · Markdown", { exact: true }).fill("Stale local edit");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "This question has changed" }).waitFor();
  assert.equal(await page.getByLabel("Stem · Markdown", { exact: true }).inputValue(), "Stale local edit");
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  // Imported questions at the limit can remove a tag and replace it without losing others.
  rows[0].tags = Array.from({ length: 50 }, (_, i) => `Limit ${i}`);
  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await tagInput.fill("Overflow");
  await page.getByText("Up to 50 tags per question. Remove a tag to add another.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("option", { name: "Create “Overflow”", exact: true }).isDisabled(), true);
  await tagInput.press("Enter");
  assert.equal(await page.getByRole("button", { name: /^Remove tag / }).count(), 50);
  await tagChip("Limit 0").click();
  await page.getByRole("option", { name: "Create “Overflow”", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /^Remove tag / }).count(), 50);
  await tagChip("Overflow").waitFor();
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  rows[0].tags = [];
  // The admin API supplies correctAnswers rather than the public chooseCount.
  rows[0].type = "multiple_choice"; rows[0].correctAnswers = ["A", "B"];
  await page.reload();
  await page.locator(".admin-question-row").first().getByText("Choose 2", { exact: true }).waitFor();
  rows = Array.from({ length: 205 }, (_, i) => ({ ...rows[0], id: `page-${i}`, sequenceNumber: i + 1, externalId: `Q-${i}` }));
  await page.reload(); await page.getByText("Page 1 of 5", { exact: true }).waitFor();
  const questionPageResponse = offset => page.waitForResponse(r => {
    const url = new URL(r.url());
    return r.request().method() === "GET" && url.pathname === "/api/exams/exam/questions" && url.searchParams.get("offset") === String(offset);
  });
  // A failed target is still the next page from the rows being shown. The
  // next click must retry it, not skip a page or become a no-op.
  questionPageFailures = 1;
  const failedPage = questionPageResponse(50);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal((await failedPage).status(), 503);
  await page.getByRole("alert").filter({ hasText: "Question page unavailable" }).waitFor();
  await page.getByText("Page 1 of 5", { exact: true }).waitFor();
  await page.getByText("1–50 of 205", { exact: true }).waitFor();
  await page.getByText("ID: page-0 · External ID: Q-0", { exact: true }).waitFor();
  const retriedPage = questionPageResponse(50);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal((await retriedPage).status(), 200);
  await page.getByText("Page 2 of 5", { exact: true }).waitFor();
  await page.getByText("ID: page-50 · External ID: Q-50", { exact: true }).waitFor();
  await page.getByText("ID: page-99 · External ID: Q-99", { exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  const firstPage = questionPageResponse(0);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await firstPage;
  await page.getByText("Page 1 of 5", { exact: true }).waitFor();
  // Wait on the response for the page being fetched, not on the page label:
  // the label is a deterministic signal only because the panel now derives it
  // from the rows it has, and waiting on the request as well means a slow
  // response cannot leave this asserting against the previous page's rows.
  for (let i = 2; i <= 5; i++) {
    const offset = (i - 1) * 50;
    const loaded = questionPageResponse(offset);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    assert.equal((await loaded).status(), 200);
    await page.getByText(`Page ${i} of 5`, { exact: true }).waitFor();
  }
  // Identify the page by its contents, not only by how many rows it has.
  await page.getByText("ID: page-200", { exact: false }).waitFor();
  await page.getByText("ID: page-204", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count(), 5);
  await page.getByText("201–205 of 205", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Next", exact: true }).isDisabled(), true, "the last page cannot advance");
  // A deliberately slow last hop: the label must never describe a page whose
  // rows are not on screen, however long the request takes.
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByText("Page 4 of 5", { exact: true }).waitFor();
  const held = holdQuestions();
  const slowPage = questionPageResponse(200);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await held.arrived.promise;
  assert.equal(await page.getByText("Page 4 of 5", { exact: true }).count(), 1, "the page label waits for the rows it describes");
  releaseQuestions();
  assert.equal((await slowPage).status(), 200);
  await page.getByText("Page 5 of 5", { exact: true }).waitFor();
  await page.getByText("ID: page-200 · External ID: Q-200", { exact: true }).waitFor();
  await page.getByText("ID: page-204 · External ID: Q-204", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count(), 5);
  // A smaller bank can require a second request. Keep the last successful
  // snapshot until the clamped page arrives, rather than publishing Page 5 of 4.
  const previousPage = questionPageResponse(150);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await previousPage;
  await page.getByText("ID: page-199 · External ID: Q-199", { exact: true }).waitFor();
  rows = rows.slice(0, 154);
  const clamped = holdQuestions(150);
  const requestedPage = questionPageResponse(200), clampedPage = questionPageResponse(150);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal((await requestedPage).status(), 200);
  await clamped.arrived.promise;
  await page.getByText("Page 4 of 5", { exact: true }).waitFor();
  await page.getByText("151–200 of 205", { exact: true }).waitFor();
  releaseQuestions();
  assert.equal((await clampedPage).status(), 200);
  await page.getByText("Page 4 of 4", { exact: true }).waitFor();
  await page.getByText("151–154 of 154", { exact: true }).waitFor();
  await page.getByText("ID: page-150 · External ID: Q-150", { exact: true }).waitFor();
  await page.getByText("ID: page-153 · External ID: Q-153", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count(), 4);
  assert.equal(await page.getByRole("button", { name: "Next", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await page.getByText("Prepare questions from a PDF", { exact: true }).click();
  await page.getByText(/Supported content: paragraph, heading, list, table, figure, code/).waitFor();
  assert.equal(await page.getByRole("link", { name: "Download conversion schemas" }).getAttribute("href"), "/api/import-schemas");
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/pdf-import-schemas-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/pdf-import-schemas-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  const converted = { schemaVersion: "1.0", exam: { id: "exam", name: "SG", language: "ja" }, questions: [{
    externalId: "book:2025-a:q1", type: "single_choice", stem: "正しい数はどれか。",
    options: [{ id: "ア", text: "1" }, { id: "イ", text: "2" }], correctAnswers: ["イ"],
  }] };
  await page.getByLabel("Question import JSON file").setInputFiles({ name: "sg-import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(converted)) });
  await page.getByText("1 incoming questions · 0 conflicts", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Import with selected resolutions" }).click();
  await page.getByText("Created 1 · Updated 0 · Skipped / conflicting 0 · Failed 0", { exact: true }).waitFor();
  assert.deepEqual(importedFile.questions, converted.questions);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  schemaFailures = 1;
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await page.getByText("Prepare questions from a PDF", { exact: true }).click();
  await page.getByRole("status").filter({ hasText: "PDF preparation formats could not be loaded" }).waitFor();
  assert.equal(await page.getByLabel("Question import JSON file").isEnabled(), true);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const componentFile = JSON.parse(readFileSync(new URL("../../../tests/fixtures/components/case-with-figure.json", import.meta.url), "utf8"));
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await page.getByLabel("Question import JSON file").setInputFiles({ name: "components.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(componentFile)) });
  await page.getByText("Preview imported questions", { exact: true }).click();
  await page.getByRole("img", { name: "After is twice as high as Before." }).waitFor();
  await page.getByRole("button", { name: "Import with selected resolutions" }).click();
  await page.getByText("Created 1 · Updated 0 · Skipped / conflicting 0 · Failed 0", { exact: true }).waitFor();
  assert.deepEqual(importedFile.questions, componentFile.questions);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  rows = normalizeImportFile(componentFile).questions.map(q => ({ ...q, id: "structured", examId: "exam", sequenceNumber: 1, revision: 1, answerRevision: 1, tags: [] }));
  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const structuredDialog = page.getByRole("dialog", { name: "Edit component question" });
  await structuredDialog.waitFor();
  await structuredDialog.getByRole("img", { name: "After is twice as high as Before." }).waitFor();
  const jsonEditor = page.getByRole("textbox", { name: "Question package JSON" });
  const edited = JSON.parse(await jsonEditor.inputValue());
  edited.questions[0].body[0].text = "Edited structured prompt";
  await jsonEditor.fill(JSON.stringify(edited, null, 2));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".question-drawer").evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished)); });
  const componentBounds = await page.locator(".question-drawer").boundingBox();
  assert.equal(Math.round(componentBounds.x), 0);
  assert.equal(Math.round(componentBounds.width), 390);
  await jsonEditor.evaluate(e => { e.scrollTop = 0; e.blur(); });
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/component-editor-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await structuredDialog.getByRole("button", { name: "Save", exact: true }).click();
  await structuredDialog.waitFor({ state: "detached" });
  assert.equal(rows[0].content.body[0].text, "Edited structured prompt");
  assert.deepEqual(rows[0].content.assets, componentFile.assets);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export this page", exact: true }).click();
  const download = await downloadEvent;
  const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
  assert.equal(exported.schemaVersion, "2.0");
  assert.deepEqual(exported.assets, componentFile.assets);
  console.log("PASS component import preview, structured edit with assets, mobile drawer and downloadable export");
  assert.deepEqual(errors, []);
  console.log("Browser regression passed: tag search/create/normalization/removal, keyboard and touch, catalog recovery, tag-only dirty state, exact tag-array saves, continuous creation, true/false defaults, failure retention, focus, previews, stale updates, mobile layout, and pagination beyond 200.");
} finally { initialCatalog.resolve(); heldQuestions?.gate.resolve(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
