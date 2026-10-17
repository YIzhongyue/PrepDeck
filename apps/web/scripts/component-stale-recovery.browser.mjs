// Actual QuestionsPanel/editor/guard and HTTP revision boundary; synthetic loopback only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody } from "./browser-fixture.mjs";
import { exportComponentPackage, normalizeImportFile } from "../../../packages/shared/src/question-components.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const standard = { id: "component", examId: "exam", externalId: "RECOVERY-1", sequenceNumber: 7, type: "single_choice",
  stem: "Synthetic recovery question", options: [{ id: "A", text: "First" }, { id: "B", text: "Second" }], correctAnswers: ["A"],
  explanation: "Official explanation", difficulty: null, tags: [], points: 1, needsReview: false, archivedAt: null,
  revision: 1, answerRevision: 1, answerRevisedAt: null };
const original = { ...standard, ...normalizeImportFile(exportComponentPackage({ id: "exam", name: "Fixture" }, [standard])).questions[0] };
let row = structuredClone(original), hold = null, failGet = false, failSave = null, badExport = false;
const writes = [], reads = [], errors = [];
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import QuestionsPanel from './src/components/QuestionsPanel';
  import './src/styles/tokens.css'; import './src/styles/app.css';
  function Fixture() { const store=usePrepDeck(); window.store=store; return <main>{store.state.screen==='admin' && <QuestionsPanel exam={{id:'exam'}}/>}</main>; }
  createRoot(document.getElementById('root')).render(<React.StrictMode><PrepDeckProvider><Fixture/></PrepDeckProvider></React.StrictMode>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  const json = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(outputFiles.find(f => f.path.endsWith(url.pathname.slice(1)))?.contents);
    }
    res.setHeader("Content-Type", "text/html");
    return res.end('<!doctype html><html lang="en"><head><title>Component recovery fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body data-pd-theme="light"><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
  if (url.pathname === "/api/auth/me") return json(200, { user: { id: "synthetic", role: "admin", displayName: "Fixture" } });
  if (url.pathname === "/api/exams") return json(200, { exams: [{ id: "exam", name: "Fixture", slug: "exam", providers: [], questionCount: 1 }] });
  if (url.pathname === "/api/settings") return json(200, { showSharedNotes: true });
  if (url.pathname === "/api/annotation-settings") return json(200, {});
  if (url.pathname === "/api/annotations") return json(200, { annotations: [] });
  if (url.pathname === "/api/notes") return json(200, { notes: [] });
  if (url.pathname === "/api/admin/question-tags") return json(200, { tags: [] });
  if (url.pathname.endsWith("/practice-catalog")) return json(200, { questions: [], bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  if (url.pathname.endsWith("/learning/progress")) return json(200, { progress: { lastSequenceNumber: null } });
  if (url.pathname === "/api/attempts/active") return json(200, { attempt: null });
  if (url.pathname.endsWith("/classifications")) return json(200, { dimensions: [] });
  const match = url.pathname.match(/^\/api\/exams\/exam\/questions(?:\/([^/]+))?$/);
  if (match) {
    if (req.method === "GET") {
      if (!match[1]) {
        if (hold?.method === "LIST") { const wait = hold; wait.arrived.resolve(); await wait.gate.promise; }
        const filter = url.searchParams.get("needsReview");
        const rows = !filter || String(row.needsReview) === filter ? [row] : [];
        return json(200, { questions: rows, total: rows.length });
      }
      assert.equal(decodeURIComponent(match[1]), row.id); reads.push(row.revision);
      if (hold?.method === "GET") { const wait = hold; wait.arrived.resolve(); await wait.gate.promise; }
      if (failGet) return json(503, { error: "Synthetic latest-load failure" });
      const latest = structuredClone(row);
      if (badExport) latest.correctAnswers = ["missing-option"];
      return json(200, { question: latest });
    }
    assert.equal(req.method, "PATCH"); assert.equal(decodeURIComponent(match[1]), row.id);
    const { payload } = await readBody(req); writes.push(payload);
    if (hold?.method === "PATCH") { const wait = hold; wait.arrived.resolve(); await wait.gate.promise; }
    if (failSave) return json(failSave.status, failSave.body);
    if (payload.expectedRevision !== row.revision) return json(409, { error: "This question has changed.", code: "stale_question" });
    Object.assign(row, payload, { revision: row.revision + 1 }); return json(200, { question: row });
  }
  return json(404, { error: "Unexpected fixture route" });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage(); page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const editor = page.getByRole("dialog", { name: "Edit component question", exact: true });
  const field = editor.getByRole("textbox", { name: "Question package JSON", exact: true });
  const save = editor.getByRole("button", { name: "Save", exact: true }), cancel = editor.getByRole("button", { name: "Cancel", exact: true });
  const close = editor.getByRole("button", { name: "Close question editor", exact: true });
  const keepLatest = editor.getByRole("button", { name: "Load latest and keep my edits", exact: true });
  const discardLatest = editor.getByRole("button", { name: "Discard my edits", exact: true });
  const status = editor.locator(".authoring-save-status"), header = editor.locator("header"), pane = editor.locator(".question-drawer-body");
  const rebased = editor.locator(".authoring-rebased"), preview = editor.getByRole("region", { name: "Component question preview" });
  const keepEditing = page.getByRole("button", { name: "Keep editing", exact: true });
  const open = async () => { await page.getByRole("button", { name: "Edit", exact: true }).click(); await field.waitFor(); await editor.locator(".question-drawer").evaluate(el => Promise.all(el.getAnimations().map(a => a.finished))); };
  const start = async (size, longIds = false) => {
    row = structuredClone(original); if (longIds) row.id += "i".repeat(5000);
    failSave = null; failGet = false; badExport = false;
    await page.setViewportSize(size); await page.goto(origin);
    await page.waitForFunction(() => window.store?.state.workspaceStatus === "ready"); await page.evaluate(() => window.store.go("admin")); await open();
    assert.equal(await field.evaluate(el => el === document.activeElement), true); assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
  };
  const remoteEdit = () => { row.revision++; row.content.body[0].text = `Remote revision ${row.revision}`; row.correctAnswers = ["B"]; row.tags = ["remote"]; row.explanation = "Remote official explanation"; };
  const expectRevision = async revision => { await header.getByText(`revision ${revision}`, { exact: true }).waitFor(); };
  const conflict = async () => { await save.click(); await keepLatest.waitFor(); };
  const layout = async size => {
    assert.ok((await pane.boundingBox()).height >= 80, "usable editing pane even with very long identifiers");
    for (const control of [save, cancel, close]) {
      const box = await control.boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1, "shell action stays on screen");
      assert.equal(await control.isEnabled(), true);
    }
    assert.ok((await close.boundingBox()).width >= 44); assert.ok((await close.boundingBox()).height >= 44);
    assert.ok(await pane.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  };
  const sizes = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }];
  for (const size of sizes) {
    await start(size, true); await layout(size); await expectRevision(1);
    assert.equal(await header.locator("[title]").getAttribute("title"), row.id);
    assert.equal(await header.getByText("#7", { exact: true }).isVisible(), true);
    const originalRaw = await field.inputValue(), draft = JSON.parse(originalRaw);
    draft.questions[0].body[0].text = "My exact retained draft";
    // Noncanonical whitespace, duplicate keys and number spellings survive Keep.
    const raw = JSON.stringify(draft, null, 3).replace('"points": 1', '"points": 1e0, "points": 1.0') + "\n\n";
    await field.fill(raw);
    await field.evaluate(el => { el.focus(); el.setSelectionRange(180, 210, "backward"); el.scrollTop = 100; });
    const position = () => field.evaluate(el => ({ focused: el === document.activeElement, start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, top: el.scrollTop, paneTop: el.closest(".question-drawer-body").scrollTop }));
    const beforeClose = await position(); await field.press("Escape"); await keepEditing.click();
    assert.deepEqual(await position(), beforeClose, "cancelled dirty dismissal restores caret, focus and both scroll containers");
    remoteEdit(); const firstWrite = writes.length;
    await conflict(); assert.equal(writes.length, firstWrite + 1); assert.equal(writes.at(-1).expectedRevision, 1); await expectRevision(1);
    await layout(size); assert.equal(await field.inputValue(), raw);
    failGet = true; await keepLatest.click(); await editor.getByRole("alert").filter({ hasText: "Synthetic latest-load failure" }).waitFor();
    assert.equal(await editor.evaluate(el => el.contains(document.activeElement)), true, "failed latest load keeps focus inside the modal");
    await preview.getByText("My exact retained draft", { exact: true }).waitFor();
    await expectRevision(1); assert.equal(await field.inputValue(), raw); assert.equal(await keepLatest.isEnabled(), true);
    failGet = false; badExport = true; await keepLatest.click(); await editor.getByRole("alert").filter({ hasText: "Cannot represent this page" }).waitFor();
    assert.equal(await editor.evaluate(el => el.contains(document.activeElement)), true, "failed latest export keeps focus inside the modal");
    await preview.getByText("My exact retained draft", { exact: true }).waitFor();
    await expectRevision(1); assert.equal(await field.inputValue(), raw); assert.equal(await keepLatest.isEnabled(), true);
    badExport = false;
    await field.fill(originalRaw); assert.equal(await status.textContent(), "No unsaved changes", "failed export kept the original dirty baseline"); await field.fill(raw);
    hold = { method: "GET", arrived: Promise.withResolvers(), gate: Promise.withResolvers() };
    await keepLatest.click(); await hold.arrived.promise;
    for (const control of [field, save, cancel, close, keepLatest, discardLatest, editor.getByRole("button", { name: "Format JSON" })]) assert.equal(await control.isDisabled(), true);
    await page.keyboard.press("Escape"); await page.keyboard.press("Control+s"); await editor.dispatchEvent("keydown", { key: "s", metaKey: true, bubbles: true });
    if ((await editor.locator(".question-drawer").boundingBox()).x > 20) await page.mouse.click(10, size.height / 2);
    assert.equal(await editor.count(), 1); assert.equal(writes.length, firstWrite + 1);
    await page.evaluate(() => { window.navigation = "pending"; window.store.go("setup").then(value => { window.navigation = value; }); });
    await page.waitForFunction(() => window.navigation !== "pending"); assert.equal(await page.evaluate(() => window.store.state.screen), "admin");
    hold.gate.resolve(); hold = null; await expectRevision(2); await rebased.waitFor();
    assert.match(await rebased.textContent(), /Changed since revision 1: Question body, Correct response, Official explanation, Tags/);
    assert.equal(await field.inputValue(), raw); assert.equal(writes.length, firstWrite + 1, "loading never saves");
    await preview.getByText("My exact retained draft", { exact: true }).waitFor(); assert.equal(await status.textContent(), "Unsaved changes");
    if (process.env.SCREENSHOT_DIR) { mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/recovered-${size.width}.png` }); }
    remoteEdit(); await conflict(); assert.equal(writes.at(-1).expectedRevision, 2);
    await keepLatest.click(); await expectRevision(3); assert.match(await rebased.textContent(), /since revision 2/);
    assert.equal(await field.inputValue(), raw); assert.equal(writes.length, firstWrite + 2);
    hold = { method: "PATCH", arrived: Promise.withResolvers(), gate: Promise.withResolvers() };
    await field.press("Meta+s"); await hold.arrived.promise; await page.keyboard.press("Escape"); await page.keyboard.press("Control+s");
    assert.equal(await editor.count(), 1); assert.equal(writes.length, firstWrite + 3);
    hold.gate.resolve(); hold = null; await editor.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
    assert.equal(writes.at(-1).expectedRevision, 3); assert.equal(row.content.body[0].text, "My exact retained draft"); assert.equal(row.externalId, draft.questions[0].externalId);
    assert.equal(await page.getByRole("heading", { name: "Questions", exact: true }).evaluate(el => el === document.activeElement), true, "component Save returns to stable heading through list refresh");
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    await open(); await close.click(); await editor.waitFor({ state: "detached" });
    assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).evaluate(el => el === document.activeElement), true, "clean Close returns to its current opening control");
  }
  // Non-conflict failures cannot offer revision recovery, even with a similarly named body.
  await start(sizes[0]); const raw = await field.inputValue();
  for (const failure of [{ status: 409, body: { error: "Duplicate external ID", code: "duplicate_external_id" } }, { status: 409, body: { error: "Unclassified conflict" } }, { status: 503, body: { error: "Unavailable", code: "stale_question" } }]) {
    failSave = failure; await save.click(); await editor.getByRole("alert").filter({ hasText: failure.body.error }).waitFor();
    assert.equal(await keepLatest.count(), 0); assert.equal(await field.inputValue(), raw); await expectRevision(1);
  }
  failSave = null; remoteEdit(); await conflict();
  const validDraft = JSON.parse(raw); validDraft.questions[0].body[0].text = "Last valid draft context";
  const validRaw = JSON.stringify(validDraft, null, 2); await field.fill(validRaw); await preview.getByText("Last valid draft context", { exact: true }).waitFor();
  const invalidRaw = validRaw + "\nINVALID"; await field.fill(invalidRaw);
  const beforeInvalid = writes.length; await save.click();
  assert.equal(await editor.getByRole("region", { name: "Question package errors" }).evaluate(el => el === document.activeElement), true);
  assert.equal(await keepLatest.isVisible(), true); assert.equal(writes.length, beforeInvalid);
  await keepLatest.click(); await expectRevision(2); assert.equal(await field.inputValue(), invalidRaw);
  await preview.getByRole("status").filter({ hasText: "Preview is out of date" }).waitFor(); await preview.getByText("Last valid draft context", { exact: true }).waitFor();
  await field.press("Control+s"); assert.equal(writes.length, beforeInvalid);
  await field.fill(validRaw); remoteEdit(); await conflict();
  // Cancelled discard restores its recovery control and does not issue a GET.
  const beforeReads = reads.length; await discardLatest.click();
  const prompt = page.getByRole("dialog", { name: "Discard edits and load latest?", exact: true }); await prompt.waitFor();
  await keepEditing.press("Control+s"); assert.equal(reads.length, beforeReads); await keepEditing.click();
  assert.equal(await discardLatest.evaluate(el => el === document.activeElement), true); assert.equal(await field.inputValue(), validRaw);
  await discardLatest.click(); await prompt.getByRole("button", { name: "Discard and load latest", exact: true }).click(); await expectRevision(3);
  assert.equal(await field.inputValue(), JSON.stringify(exportComponentPackage({ id: "exam", name: "exam" }, [row]), null, 2));
  assert.equal(await status.textContent(), "No unsaved changes"); assert.equal(writes.length, beforeInvalid + 1);
  await preview.getByText("Remote revision 3", { exact: true }).waitFor();
  await page.addScriptTag({ content: readFileSync(fileURLToPath(new URL("../../../node_modules/axe-core/axe.min.js", import.meta.url)), "utf8") });
  const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector(".question-drawer-backdrop"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations);
  assert.deepEqual(violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), []);
  await save.click(); await editor.waitFor({ state: "detached" }); assert.equal(writes.at(-1).expectedRevision, 3);
  // Real panel filters can remove the saved row. Focus remains at the heading
  // after refresh, and later responses must not steal it from another control.
  await page.getByLabel("Filter by review state").selectOption("false"); await open();
  const reviewed = JSON.parse(await field.inputValue()); reviewed.questions[0].needsReview = true;
  await field.fill(JSON.stringify(reviewed)); await field.press("Control+s"); await editor.waitFor({ state: "detached" });
  await page.getByText("No questions match the current filters.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Questions", exact: true }).evaluate(el => el === document.activeElement), true);
  assert.equal(await page.getByLabel("Filter by review state").inputValue(), "false");
  await page.getByLabel("Filter by review state").selectOption(""); await open();
  hold = { method: "LIST", arrived: Promise.withResolvers(), gate: Promise.withResolvers() };
  await save.click(); await editor.waitFor({ state: "detached" }); await hold.arrived.promise;
  assert.equal(await page.getByRole("heading", { name: "Questions", exact: true }).evaluate(el => el === document.activeElement), true);
  await page.getByLabel("Filter by review state").focus(); hold.gate.resolve(); hold = null;
  await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Filter by review state").evaluate(el => el === document.activeElement), true, "late refresh does not steal the user's next focus");
  assert.deepEqual(errors, []);
  console.log("PASS component stale recovery: exact raw retention, revision-only conflicts, failed GET/export, invalid cached preview, confirmed discard, repeated conflicts, no autosave, pending guards, real list focus after save/filter refresh, long IDs and reachable shell at phone/wide/short landscape");
} finally { hold?.gate.resolve(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
