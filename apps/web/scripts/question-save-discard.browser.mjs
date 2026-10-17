// Actual QuestionsPanel and navigation provider, synthetic loopback-only data.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody } from "./browser-fixture.mjs";
import { exportComponentPackage, normalizeImportFile } from "../../../packages/shared/src/question-components.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const standard = { id: "standard", examId: "exam", externalId: "SAVE-1", sequenceNumber: 1, type: "single_choice",
  stem: "Synthetic save workflow", options: [{ id: "A", text: "First" }, { id: "B", text: "Second" }], correctAnswers: ["A"],
  explanation: "Official explanation", difficulty: null, tags: [], points: 1, needsReview: false, archivedAt: null,
  revision: 1, answerRevision: 1, answerRevisedAt: null };
const component = { ...standard, ...normalizeImportFile(exportComponentPackage({ id: "exam", name: "Fixture" }, [standard])).questions[0], id: "component", externalId: "JSON-1", sequenceNumber: 2 };
const rows = [structuredClone(standard), component], writes = [], errors = [];
let hold = null, failure = false, reloadFailure = false, serial = 0;
const { outputFiles } = await build({ stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
  import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import QuestionsPanel from './src/components/QuestionsPanel';
  import './src/styles/tokens.css'; import './src/styles/app.css';
  function Fixture() { const store=usePrepDeck(); window.store=store; const [mounted,setMounted]=useState(true); window.unmountEditor=()=>setMounted(false);
    return <main><output id="location">{store.state.screen}:{store.state.examId}</output>{mounted && store.state.screen==='admin' && store.state.examId && <QuestionsPanel exam={{id:store.state.examId}}/>}</main>; }
  createRoot(document.getElementById('root')).render(<React.StrictMode><PrepDeckProvider><Fixture/></PrepDeckProvider></React.StrictMode>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(outputFiles.find(f => f.path.endsWith(url.pathname.slice(1)))?.contents);
    }
    res.setHeader("Content-Type", "text/html");
    return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body data-pd-theme="light"><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
  if (url.pathname === "/api/auth/me") return json(200, { user: { id: "synthetic", role: "admin", displayName: "Fixture" } });
  if (url.pathname === "/api/exams") return json(200, { exams: ["exam", "other"].map(id => ({ id, name: id, slug: id, providers: [], questionCount: 0 })) });
  if (url.pathname === "/api/settings") return json(200, { showSharedNotes: true });
  if (url.pathname === "/api/annotation-settings") return json(200, {});
  if (url.pathname === "/api/annotations") return json(200, { annotations: [] });
  if (url.pathname === "/api/notes") return json(200, { notes: [] });
  if (url.pathname === "/api/admin/question-tags") return json(200, { tags: [] });
  if (url.pathname.endsWith("/practice-catalog")) return json(200, { questions: [], bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  if (url.pathname.endsWith("/learning/progress")) return json(200, { progress: { lastSequenceNumber: null } });
  if (url.pathname === "/api/attempts/active") return json(200, { attempt: null });
  if (url.pathname.endsWith("/classifications")) return json(200, { dimensions: [] });
  const match = url.pathname.match(/^\/api\/exams\/[^/]+\/questions(?:\/([^/]+))?$/);
  if (match) {
    const q = match[1] && rows.find(row => row.id === match[1]);
    if (req.method === "GET") {
      if (q && reloadFailure) return json(503, { error: "Synthetic reload failure" });
      return json(200, q ? { question: q } : { questions: rows, total: rows.length });
    }
    const { payload } = await readBody(req);
    writes.push({ method: req.method, id: match[1], payload });
    if (hold) { const held = hold; held.arrived.resolve(); await held.gate.promise; }
    if (failure) return json(503, { error: "Synthetic save failure" });
    if (q && payload.expectedRevision !== q.revision) return json(409, { error: "This question has changed. Reopen it before saving.", code: "stale_question" });
    if (!q) { const created = { ...standard, ...payload, id: `created-${++serial}`, sequenceNumber: rows.length + 1, revision: 1 }; rows.push(created); return json(201, { question: created }); }
    Object.assign(q, payload, { revision: q.revision + 1 }); return json(200, { question: q });
  }
  return json(404, { error: "No synthetic route" });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.store[method](...args), { method, args });
  const startNavigation = (method, ...args) => page.evaluate(({ method, args }) => { window.navigationResult = "pending"; Promise.resolve(window.store[method](...args)).then(value => { window.navigationResult = value ?? "done"; }); }, { method, args });
  const ready = () => page.waitForFunction(() => window.store?.state.workspaceStatus === "ready");
  const open = async (id = "standard") => {
    await invoke("go", "admin");
    await page.locator(".admin-question-row").filter({ hasText: `ID: ${id} ·` }).getByRole("button", { name: "Edit", exact: true }).click();
    await page.locator(".question-drawer").evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  };
  const editor = page.locator(".question-drawer-backdrop"), stem = page.getByLabel("Stem · Markdown", { exact: true });
  const save = editor.getByRole("button", { name: "Save", exact: true });
  const status = editor.locator(".authoring-save-status"), prompt = page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true });
  const keep = page.getByRole("button", { name: "Keep editing", exact: true }), discard = page.getByRole("button", { name: "Discard changes", exact: true });
  const unloadProtected = () => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  const expectSaved = async () => {
    await status.filter({ hasText: /^Saved revision / }).waitFor();
    assert.equal(await status.textContent(), `Saved revision ${rows[0].revision}. No unsaved changes.`);
    assert.equal(await editor.count(), 1);
  };
  await page.goto(origin); await ready(); await open();
  assert.equal(await status.textContent(), "No unsaved changes"); assert.equal(await unloadProtected(), false);
  assert.equal(await editor.getByRole("button", { name: "Save & add next" }).count(), 0);
  await stem.fill("Unsaved draft"); assert.equal(await status.textContent(), "Unsaved changes"); assert.equal(await unloadProtected(), true);
  await stem.fill(standard.stem); assert.equal(await status.textContent(), "No unsaved changes");
  // Clean saves use the normal route too. Both modifiers and repeat suppression are exercised.
  await stem.press("Control+s"); await expectSaved();
  assert.equal(writes.length, 1); assert.equal(writes[0].payload.expectedRevision, 1);
  await stem.fill("Saved by Command shortcut"); await stem.press("Meta+s"); await expectSaved();
  assert.equal(writes.length, 2); assert.equal(writes[1].payload.expectedRevision, 2);
  await stem.fill("Saved by pointer"); await save.click(); await expectSaved();
  assert.equal(writes.length, 3); assert.equal(writes[2].payload.expectedRevision, 3);
  assert.equal(await unloadProtected(), false);
  if (process.env.SCREENSHOT_DIR) { mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/saved-wide.png` }); }
  await stem.fill("Still dirty after saving earlier");
  assert.equal(await status.textContent(), "Unsaved changes"); assert.equal(await unloadProtected(), true);
  // Escape from a field and cancelling the modal restore exact caret and both scroll offsets.
  await page.getByLabel("Official explanation · Markdown", { exact: true }).fill("Long explanation line\n".repeat(30));
  const explanation = page.getByLabel("Official explanation · Markdown", { exact: true });
  await explanation.evaluate(el => { el.focus(); el.setSelectionRange(21, 37, "backward"); el.scrollTop = 120; });
  const position = () => explanation.evaluate(el => ({ focused: document.activeElement === el, start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, scroll: el.scrollTop, pane: el.closest(".question-editor-pane").scrollTop }));
  const before = await position(); await explanation.press("Escape"); await prompt.waitFor();
  assert.equal(await keep.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("Shift+Tab"); assert.equal(await discard.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("Tab"); assert.equal(await keep.evaluate(el => document.activeElement === el), true);
  const modalWrites = writes.length;
  for (const key of ["Control+s", "Meta+s"]) await keep.press(key);
  assert.equal(await keep.evaluate(el => el.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }))), false);
  assert.equal(writes.length, modalWrites); await prompt.waitFor();
  await keep.click(); assert.deepEqual(await position(), before); assert.equal(await status.textContent(), "Unsaved changes");
  await explanation.press("Escape"); await prompt.waitFor(); await page.keyboard.press("Escape"); assert.deepEqual(await position(), before);
  // At 390px the custom confirmation is contained, keyboard reachable and cancellable.
  await page.setViewportSize({ width: 390, height: 844 }); await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await prompt.waitFor();
  const box = await prompt.locator(".dialog").boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/discard-phone.png` });
  await keep.click(); await page.setViewportSize({ width: 1440, height: 1000 });
  // Busy requests block shortcut repeats, closing, unload and in-app navigation; failure keeps all edits.
  hold = { arrived: Promise.withResolvers(), gate: Promise.withResolvers() }; failure = true;
  await stem.press("Control+s"); await hold.arrived.promise;
  const pendingWrites = writes.length;
  assert.equal(await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }))), false, "Pending saves suppress the browser shortcut even if disabling a field moved focus");
  await page.keyboard.press("Control+s"); await page.keyboard.press("Meta+s");
  await editor.dispatchEvent("keydown", { key: "s", ctrlKey: true, repeat: true, bubbles: true });
  await editor.dispatchEvent("keydown", { key: "s", metaKey: true, bubbles: true });
  await page.keyboard.press("Escape"); await startNavigation("go", "bookmarks");
  assert.equal(await prompt.count(), 0); assert.equal(await editor.count(), 1); assert.equal(await unloadProtected(), true);
  assert.equal(await page.evaluate(() => window.store.state.screen), "admin"); assert.equal(writes.length, pendingWrites);
  hold.gate.resolve(); hold = null;
  await editor.getByRole("alert").filter({ hasText: "Synthetic save failure" }).waitFor();
  assert.equal(await stem.inputValue(), "Still dirty after saving earlier"); assert.equal(await status.textContent(), "Unsaved changes");
  failure = false; await save.click(); await expectSaved();
  assert.equal(writes.at(-1).payload.expectedRevision, 4);
  // Validation follows the same keyboard path; stale saves retain their baseline until explicit recovery.
  await stem.fill(""); const validWrites = writes.length; await stem.press("Control+s");
  assert.equal(await stem.getAttribute("aria-invalid"), "true"); assert.equal(writes.length, validWrites);
  await stem.fill("My stale draft"); rows[0].revision++; rows[0].difficulty = "hard";
  await save.click(); await editor.getByRole("button", { name: "Load latest and keep my edits" }).waitFor();
  assert.equal(await status.textContent(), "Unsaved changes");
  await editor.getByRole("button", { name: "Discard my edits", exact: true }).click();
  await page.getByRole("dialog", { name: "Discard edits and load latest?" }).waitFor(); await keep.click();
  assert.equal(await stem.inputValue(), "My stale draft");
  reloadFailure = true; await editor.getByRole("button", { name: "Load latest and keep my edits" }).click();
  await editor.getByRole("alert").filter({ hasText: "Could not load the latest version" }).waitFor(); assert.equal(await stem.inputValue(), "My stale draft");
  reloadFailure = false; await editor.getByRole("button", { name: "Load latest and keep my edits" }).click();
  await editor.getByRole("status").filter({ hasText: `Loaded revision ${rows[0].revision}.` }).waitFor();
  await stem.press("Control+s"); await expectSaved(); assert.equal(writes.at(-1).payload.expectedRevision, rows[0].revision - 1);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.waitFor({ state: "detached" });
  assert.equal(await page.locator(".admin-question-row").filter({ hasText: "ID: standard ·" }).getByRole("button", { name: "Edit", exact: true }).evaluate(el => el === document.activeElement), true, "Closing after the saved list refresh returns focus to the current Edit control");
  await open(); await stem.fill("Draft retained after another editor fails to save");
  await page.evaluate(() => window.addEventListener("prepdeck:save-before-navigation", event => {
    event.detail.waitUntil(Promise.reject(new Error("Synthetic adjacent draft failure")));
  }, { once: true }));
  await startNavigation("go", "bookmarks"); await prompt.waitFor(); await discard.click();
  await page.waitForFunction(() => window.store.state.actionError?.includes("could not be saved"));
  assert.equal(await stem.inputValue(), "Draft retained after another editor fails to save");
  assert.equal(await status.textContent(), "Unsaved changes");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await discard.click(); await editor.waitFor({ state: "detached" });
  // Each real provider entry point waits, cancels without side effects, and resumes the intended destination.
  for (const [method, args, screen, exam] of [
    ["go", ["bookmarks"], "bookmarks", "exam"],
    ["openKnowledgePointNote", ["synthetic-note"], "knowledgePoints", "exam"],
    ["openPracticeWithFilters", [{ source: "all", tags: [], diff: "all", study: "all", count: 5 }], "practice", "exam"],
    ["navigateTo", [{ screen: "settings", examSlug: null, learningSequence: null, knowledgePointId: null }], "settings", "exam"],
    ["goToQuestionForReview", ["exam", "standard"], "learning", "exam"],
    ["setExamId", ["other"], "admin", "other"],
  ]) {
    await open(); await stem.fill(`Navigation draft: ${method}`);
    await startNavigation(method, ...args); await prompt.waitFor();
    assert.equal(await page.evaluate(() => window.store.state.screen), "admin");
    await keep.click(); await page.waitForFunction(() => window.navigationResult !== "pending");
    assert.equal(await stem.inputValue(), `Navigation draft: ${method}`);
    assert.equal(await page.evaluate(() => window.store.state.examId), "exam");
    await startNavigation(method, ...args); await prompt.waitFor();
    await invoke("go", "wrong"); // A second request may not queue behind the modal.
    await discard.click(); await editor.waitFor({ state: "detached" });
    await page.waitForFunction(({ screen, exam }) => window.store.state.screen === screen && window.store.state.examId === exam, { screen, exam });
  }
  await invoke("setExamId", "exam"); await ready();
  const switches = await page.evaluate(() => Promise.all([window.store.setExamId("other"), window.store.setExamId("other")]));
  assert.deepEqual(switches, [true, false], "Clean concurrent switches still respect the pending guard after the async approval yield");
  await invoke("setExamId", "exam"); await ready();
  // Creation keeps Save & add next, clears only after success, and retains its chosen type.
  await invoke("go", "admin"); await page.getByRole("button", { name: "Add question", exact: true }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("fill_blank"); await stem.fill("Created question");
  await page.getByLabel("Accepted answers (one per line)").fill("first\nsecond");
  await editor.getByRole("button", { name: "Save & add next" }).click();
  await page.waitForFunction(() => document.querySelector("#question-stem")?.value === "");
  assert.equal(await page.getByLabel("Type", { exact: true }).inputValue(), "fill_blank"); assert.equal(await status.textContent(), "No unsaved changes");
  assert.equal(await stem.evaluate(el => document.activeElement === el), true);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.waitFor({ state: "detached" });
  // Component dirty state and the keyboard use the existing valid-package save and close behavior.
  await open("component"); const jsonEditor = page.getByRole("textbox", { name: "Question package JSON" });
  const originalJson = await jsonEditor.inputValue(); assert.equal(await status.textContent(), "No unsaved changes");
  await jsonEditor.fill(originalJson + "\n"); assert.equal(await status.textContent(), "Unsaved changes");
  assert.equal(await unloadProtected(), true);
  await jsonEditor.fill(originalJson); assert.equal(await status.textContent(), "No unsaved changes"); assert.equal(await unloadProtected(), false);
  await jsonEditor.fill(originalJson + "\n");
  await jsonEditor.press("Escape"); await keep.click(); assert.equal(await jsonEditor.inputValue(), originalJson + "\n");
  await jsonEditor.fill("{"); const count = writes.length; await jsonEditor.press("Control+s");
  assert.equal(writes.length, count); assert.equal(await jsonEditor.getAttribute("aria-invalid"), "true");
  await jsonEditor.fill(originalJson + "\n"); failure = true; await jsonEditor.press("Meta+s");
  await editor.getByRole("alert").filter({ hasText: "Synthetic save failure" }).waitFor(); assert.equal(await status.textContent(), "Unsaved changes");
  failure = false; await jsonEditor.press("Control+s"); await editor.waitFor({ state: "detached" }); assert.equal(writes.at(-1).id, "component");
  // If the editor disappears while awaiting a choice, its old decision cannot navigate later.
  await open(); await stem.fill("Unmounted draft"); await startNavigation("go", "wrong"); await prompt.waitFor();
  await page.evaluate(() => window.unmountEditor()); await prompt.waitFor({ state: "detached" });
  await page.waitForFunction(() => window.navigationResult !== "pending"); assert.equal(await page.evaluate(() => window.store.state.screen), "admin");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "", "Unmounting both layers releases the drawer scroll lock");
  assert.deepEqual(errors, []);
  console.log("PASS save/discard: actual panel keeps standard edits open, revisions/baselines, Ctrl/Cmd+S, pending duplicates, validation/stale/failure retention, modal focus/caret/scroll, six navigation paths, creation, component close and unmount cancellation");
} finally { hold?.gate.resolve(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
