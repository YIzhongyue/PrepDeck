// The real editor with synthetic content and a loopback-only API fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody } from "./browser-fixture.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const question = { id: "preview-fixture", examId: "exam", sequenceNumber: 1, revision: 1,
  type: "single_choice", stem: "# Synthetic question\n\n" + "Review this original practice paragraph.\n\n".repeat(35),
  options: [{ id: "A", text: "**First** answer" }, { id: "B", text: "Second answer" }],
  correctAnswers: ["A"], explanation: "## Explanation\n\n" + "A synthetic explanation.\n\n".repeat(35),
  externalId: "SYNTHETIC-1", difficulty: "easy", points: 1, tags: [], needsReview: false };
let latest = structuredClone(question), failSave = false, holdSave = null, serverIssues = null, writes = 0;
const { outputFiles } = await build({ stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
  import QuestionEditorDialog from './src/components/QuestionEditorDialog'; import './src/styles/tokens.css'; import './src/styles/app.css';
  function Fixture() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>Open editor</button>
    {open && <QuestionEditorDialog examId="exam" question={${JSON.stringify(question)}} initialType="single_choice" onClose={() => setOpen(false)} onSaved={() => setOpen(false)}/>}</>; }
  createRoot(document.getElementById('root')).render(<Fixture/>);`, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const server = createServer(async (req, res) => {
  const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  if (req.url === "/api/admin/question-tags") return json(200, { tags: [] });
  if (req.url === "/api/exams/exam/questions/preview-fixture") {
    if (req.method === "GET") return json(200, { question: latest });
    const { payload } = await readBody(req);
    if (holdSave) { holdSave.arrived.resolve(); await holdSave.gate.promise; }
    if (failSave) return json(503, { error: "Synthetic save interruption. Your draft is kept." });
    if (serverIssues) return json(422, { error: "Synthetic server validation", issues: serverIssues });
    if (payload.expectedRevision !== latest.revision) return json(409, { error: "Stale", code: "stale_question" });
    latest = { ...latest, ...payload, revision: latest.revision + 1 }; writes++;
    return json(200, { question: latest });
  }
  if (req.url.startsWith("/api/")) return json(404, { error: "Unknown fixture route" });
  if (req.url === "/fixture.js" || req.url === "/fixture.css") {
    res.setHeader("Content-Type", req.url.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(f => f.path.endsWith(req.url.slice(1))).contents);
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  console.log(`Editor preview browser: Chromium ${browser.version()}`);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.locator(".question-drawer").evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)); });
  const screenshot = async name => {
    if (!process.env.SCREENSHOT_DIR) return;
    mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/question-editor-${name}.png` });
  };
  const preview = page.getByRole("region", { name: "Markdown preview", exact: true });
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  const showPreview = page.getByRole("button", { name: "Preview", exact: true });
  const stem = page.getByLabel("Stem · Markdown", { exact: true });
  const explanation = page.getByLabel("Official explanation · Markdown", { exact: true });
  const save = page.getByRole("button", { name: "Save", exact: true });
  const resize = async (width, height = 844) => {
    await page.setViewportSize({ width, height });
    // matchMedia changes reach React asynchronously after the viewport update.
    await page.locator(".question-editor-view-switch").waitFor({ state: width < 1100 ? "visible" : "hidden" });
  };
  const assertNoOverflow = async () => assert.equal(await page.locator(".question-drawer").evaluate(el => el.scrollWidth <= el.clientWidth), true);
  const assertWide = async () => {
    assert.equal(await edit.isVisible(), false);
    const fieldsBox = await page.locator(".question-editor-fields").boundingBox();
    const previewBox = await preview.boundingBox();
    assert.ok(previewBox.x >= fieldsBox.x + fieldsBox.width, "Preview sits beside fields");
    assert.ok(Math.abs(previewBox.y - fieldsBox.y) < 2, "Both panes start together");
    await assertNoOverflow();
  };
  await assertWide();
  await screenshot("wide");
  await stem.fill(question.stem + "\nLive preview update");
  await preview.getByText("Live preview update", { exact: true }).waitFor();
  // Scrolling either long pane must leave the other pane's position alone.
  await preview.evaluate(el => { el.scrollTop = 200; });
  const previewScroll = await preview.evaluate(el => el.scrollTop);
  await explanation.focus();
  assert.equal(await preview.evaluate(el => el.scrollTop), previewScroll);
  for (const width of [1100, 1099, 390]) {
    await resize(width);
    if (width === 1100) await assertWide();
    else assert.equal(await edit.isVisible(), true);
    await assertNoOverflow();
  }
  // Keep the editor mounted while hidden: draft, caret, textarea scroll and pane scroll survive.
  await explanation.focus();
  await explanation.evaluate(el => { el.setSelectionRange(26, 40); el.scrollTop = 60; });
  const position = await explanation.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop }));
  const editScroll = await page.locator(".question-editor-fields").evaluate(el => el.scrollTop);
  let compactPreviewScroll;
  await screenshot("mobile-edit");
  for (let i = 0; i < 4; i++) {
    await showPreview.click();
    assert.equal(await preview.isVisible(), true);
    assert.equal(await explanation.isVisible(), false);
    assert.equal(await showPreview.getAttribute("aria-pressed"), "true");
    if (i === 0) {
      compactPreviewScroll = await preview.evaluate(el => { el.scrollTop = 325; return el.scrollTop; });
      assert.ok(compactPreviewScroll > 0, "Long preview has a nonzero scroll position to preserve");
    } else {
      assert.equal(await preview.evaluate(el => el.scrollTop), compactPreviewScroll, "Preview retains its own scroll position across repeated switches");
    }
    await assertNoOverflow();
    if (i === 0) await screenshot("mobile-preview");
    await edit.click();
    assert.equal(await explanation.evaluate(el => document.activeElement === el), true);
    assert.equal(await explanation.inputValue(), question.explanation);
    assert.deepEqual(await explanation.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop })), position);
    assert.equal(await page.locator(".question-editor-fields").evaluate(el => el.scrollTop), editScroll);
  }
  // Keyboard switching and focus stay in the modal, and resizing never hides focused content.
  await page.getByRole("button", { name: "Close question editor" }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await edit.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("Tab");
  assert.equal(await showPreview.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  assert.equal(await preview.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Shift+Tab");
  assert.equal(await edit.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("Enter");
  assert.equal(await explanation.evaluate(el => document.activeElement === el), true);
  // Widening from an already selected Edit button must use the current scroll,
  // even if the user has scrolled further since the last Preview visit.
  await page.locator(".question-editor-fields").evaluate(el => { el.scrollTop += 20; });
  const beforeWiden = await page.locator(".question-editor-fields").evaluate(el => el.scrollTop);
  await edit.click();
  await resize(1100);
  assert.equal(await explanation.evaluate(el => document.activeElement === el), true);
  assert.equal(await page.locator(".question-editor-fields").evaluate(el => el.scrollTop), beforeWiden);
  await resize(390);
  const focusedBounds = await explanation.boundingBox();
  const paneBounds = await page.locator(".question-editor-fields").boundingBox();
  assert.ok(focusedBounds.y >= paneBounds.y && focusedBounds.y + focusedBounds.height <= paneBounds.y + paneBounds.height, "Focused field remains visible after reflow");
  await showPreview.click();
  await resize(1440, 1000);
  await stem.focus();
  await resize(390);
  assert.equal(await stem.isVisible(), true);
  assert.equal(await stem.evaluate(el => document.activeElement === el), true);
  // CSS-pixel viewport equivalent to 200% desktop browser zoom (1440 / 2).
  await resize(720, 500);
  await showPreview.click(); await assertNoOverflow();
  const saveBox = await save.boundingBox(); assert.ok(saveBox.y + saveBox.height <= 500);
  await screenshot("zoom-reflow");
  await edit.click(); await stem.fill(""); await showPreview.click(); await save.click();
  await page.waitForFunction(() => document.activeElement?.id === "question-stem");
  assert.equal(await stem.isVisible(), true, "Validation reveals and focuses the invalid field from Preview");
  await stem.fill("Recovered draft");
  // Client-valid content can still receive a field error from the server.
  // Reveal Edit and focus that specific field without discarding the draft.
  serverIssues = [{ path: "$.options[1].text", message: "Synthetic server option validation" }];
  await showPreview.click(); await save.click();
  await page.waitForFunction(() => document.activeElement?.id === "option-1");
  const optionB = page.getByLabel("Option B · Markdown", { exact: true });
  assert.equal(await edit.getAttribute("aria-pressed"), "true");
  assert.equal(await preview.isVisible(), false);
  assert.equal(await optionB.getAttribute("aria-invalid"), "true");
  await page.getByText("options[1].text: Synthetic server option validation", { exact: true }).waitFor();
  assert.equal(await optionB.inputValue(), question.options[1].text);
  assert.equal(await stem.inputValue(), "Recovered draft");
  assert.equal(await explanation.inputValue(), question.explanation);
  assert.equal(writes, 0, "Rejected server validation must not save a question");
  await optionB.fill("Second answer corrected");
  assert.equal(await optionB.getAttribute("aria-invalid"), "false");
  serverIssues = null;
  // Undo and conflict recovery remain available after switching.
  await page.getByLabel("Type", { exact: true }).selectOption("fill_blank");
  await showPreview.click(); await edit.click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.getByLabel("Option A · Markdown", { exact: true }).inputValue(), "**First** answer");
  latest = { ...latest, revision: 2, explanation: "Changed elsewhere" };
  await showPreview.click(); await save.click();
  await page.getByRole("button", { name: "Load latest and keep my edits" }).click();
  await page.getByRole("status").filter({ hasText: "Loaded revision 2" }).waitFor();
  await edit.click(); assert.equal(await stem.inputValue(), "Recovered draft");
  assert.equal(await explanation.inputValue(), question.explanation);
  failSave = true; holdSave = { arrived: Promise.withResolvers(), gate: Promise.withResolvers() };
  await showPreview.click(); await save.click(); await holdSave.arrived.promise;
  assert.equal(await page.getByRole("button", { name: "Close question editor" }).isDisabled(), true);
  await page.keyboard.press("Escape"); assert.equal(await page.getByRole("dialog").count(), 1);
  holdSave.gate.resolve();
  await page.getByRole("alert").filter({ hasText: "Synthetic save interruption" }).waitFor();
  await edit.click(); assert.equal(await stem.inputValue(), "Recovered draft");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByRole("dialog").count(), 1);
  page.once("dialog", dialog => dialog.dismiss());
  assert.equal(await page.evaluate(() => window.dispatchEvent(new Event("prepdeck:before-navigate", { cancelable: true }))), false);
  failSave = false; holdSave = null;
  await showPreview.click(); await save.click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(writes, 1); assert.equal(latest.stem, "Recovered draft");
  assert.equal(await page.getByRole("button", { name: "Open editor" }).evaluate(el => document.activeElement === el), true);
  assert.deepEqual(errors, []);
  console.log("PASS responsive preview: long content, 1100/1099/390px, zoom reflow, live rendering, independent scrolling and preview scroll retention, draft/caret/focus retention, keyboard, client/server validation from Preview, Undo, conflict recovery, interrupted save and close");
} finally { holdSave?.gate.resolve(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
