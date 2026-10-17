// Real component editor and draft guard, isolated synthetic loopback fixtures.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody } from "./browser-fixture.mjs";
import { exportComponentPackage, normalizeImportFile } from "../../../packages/shared/src/question-components.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const standard = { id: "first", examId: "exam", externalId: "CONTEXT-1", sequenceNumber: 1, type: "single_choice",
  stem: "First question context", options: [{ id: "A", text: "First answer" }, { id: "B", text: "Second answer" }], correctAnswers: ["A"],
  explanation: "Synthetic official explanation", difficulty: null, tags: [], points: 1, needsReview: false, archivedAt: null,
  revision: 1, answerRevision: 1, answerRevisedAt: null };
const question = { ...standard, ...normalizeImportFile(exportComponentPackage({ id: "exam", name: "Fixture" }, [standard])).questions[0] };
const writes = [], errors = [];
let held = null, fail = false;
const sharedPath = fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url));
const { outputFiles } = await build({ stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
  import ComponentQuestionEditor from './src/components/ComponentQuestionEditor'; import './src/styles/tokens.css'; import './src/styles/app.css';
  const initial=${JSON.stringify(question)};
  function Fixture() { const [q,setQ]=useState(initial),[exam,setExam]=useState('exam'),[open,setOpen]=useState(true);
    window.switchIdentity=({id,examId,label})=>{const next=structuredClone(initial); next.id=id; next.examId=examId;
      next.content.body[0].text=label; setQ(next); setExam(examId); setOpen(true);};
    return <main><button onClick={()=>setOpen(true)}>Open editor</button>{open && <ComponentQuestionEditor examId={exam} question={q} onClose={()=>setOpen(false)} onSaved={q=>{window.saved=q;setOpen(false)}}/>}</main>; }
  createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "invalid-initial-export-fixture", setup(build) {
    // Production exports validate before returning. Only this deliberately
    // broken incoming snapshot exercises the defensive no-valid-preview state;
    // every other scenario uses the real exporter, parser and renderer.
    build.onResolve({ filter: /^@prepdeck\/shared$/ }, () => ({ path: "shared-fixture", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export * from ${JSON.stringify(sharedPath)};
      import {exportComponentPackage as realExport} from ${JSON.stringify(sharedPath)};
      export function exportComponentPackage(exam,questions) { return questions[0]?.id==='never-valid' ? {schemaVersion:'2.0',exam,questions:[]} : realExport(exam,questions); }`, loader: "js", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }));
  } }] });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  const json = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  if (url.pathname.startsWith("/api/")) {
    if (req.method !== "PATCH") return json(404, { error: "Unexpected fixture request" });
    const { payload } = await readBody(req); writes.push({ path: url.pathname, payload });
    if (held) { const wait = held; wait.arrived.resolve(); await wait.gate.promise; }
    if (fail) return json(503, { error: "Synthetic save failure" });
    return json(200, { question: { ...question, ...payload, id: url.pathname.split("/").at(-1), revision: 2 } });
  }
  if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
    res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(file => file.path.endsWith(url.pathname.slice(1)))?.contents);
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html lang="en"><head><title>Component preview fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body data-pd-theme="light"><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const editor = page.getByRole("dialog", { name: "Edit component question", exact: true });
  const textarea = editor.getByRole("textbox", { name: "Question package JSON", exact: true });
  const preview = editor.getByRole("region", { name: "Component question preview", exact: true });
  const feedback = editor.getByRole("region", { name: "Question package errors", exact: true });
  const save = editor.getByRole("button", { name: "Save", exact: true });
  const dirty = editor.locator(".authoring-save-status");
  const stale = preview.getByRole("status").filter({ hasText: "Preview is out of date" });
  const position = () => textarea.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, top: el.scrollTop, left: el.scrollLeft }));
  const currentPreview = () => preview.evaluate(el => [...el.children].filter(child => child.getAttribute("role") !== "status").map(child => child.outerHTML).join(""));
  const switchIdentity = async (id, examId, label) => {
    await page.evaluate(args => window.switchIdentity(args), { id, examId, label });
    await editor.waitFor(); await textarea.waitFor();
  };
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(origin); await textarea.waitFor();
    await page.locator(".question-drawer").evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    const original = await textarea.inputValue(), initialWrites = writes.length;
    await textarea.evaluate(el => { window.originalTextarea = el; });
    await preview.getByText("First question context", { exact: true }).waitFor();
    assert.equal(await dirty.textContent(), "No unsaved changes");
    const draft = JSON.parse(original);
    for (let cycle = 0; cycle < 3; cycle++) {
      draft.questions[0].body[0].text = `Unsaved valid context ${cycle}`;
      draft.questions[0].scoring.correctAnswers = [cycle % 2 ? "A" : "B"];
      const valid = JSON.stringify(draft, null, 2);
      await textarea.fill(valid); await preview.getByText(`Unsaved valid context ${cycle}`, { exact: true }).waitFor();
      assert.equal(await stale.count(), 0); const retained = await currentPreview();
      for (const kind of ["syntax", "semantic"]) {
        const bad = structuredClone(draft); bad.questions[0].scoring.correctAnswers = ["missing-answer"];
        const raw = kind === "syntax" ? `${valid}\nx` : JSON.stringify(bad, null, 2);
        await textarea.fill(raw); await stale.waitFor();
        assert.equal(await currentPreview(), retained, "the entire most recent valid presentation survives invalid edits");
        assert.equal(await textarea.inputValue(), raw); assert.equal(await textarea.getAttribute("aria-invalid"), "true");
        assert.equal(await textarea.evaluate(el => el === document.activeElement && el === window.originalTextarea), true, "feedback keeps the original focused textarea");
        assert.equal(await save.isEnabled(), true); assert.equal(await dirty.textContent(), "Unsaved changes");
        await feedback.getByText(kind === "syntax" ? /JSON syntax error/ : /answer does not identify an option/).first().waitFor();
        await textarea.evaluate(el => { el.focus(); el.setSelectionRange(230, 241, "backward"); el.scrollTop = 130; });
        const before = await position(); assert.ok(before.top > 0, "the editing position includes real textarea scrolling");
        // Both inherited keyboard modifiers and pointer Save use the same current-draft guard.
        if (cycle === 0) await save.click(); else await textarea.press(cycle === 1 ? "Control+s" : "Meta+s");
        assert.equal(await feedback.evaluate(el => el === document.activeElement), true);
        assert.deepEqual(await position(), before, "error navigation does not rewrite text or its selection/scroll");
        assert.equal(await textarea.inputValue(), raw); assert.equal(writes.length, initialWrites, "invalid Save never PATCHes the cached preview");
        await page.keyboard.press("Shift+Tab");
        assert.equal(await textarea.evaluate(el => el === document.activeElement), true);
        assert.deepEqual(await position(), before, "keyboard return keeps the original editing position");
        assert.ok(await page.locator(".question-drawer-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      await textarea.fill(valid); await preview.getByText(`Unsaved valid context ${cycle}`, { exact: true }).waitFor();
      assert.equal(await stale.count(), 0); assert.equal(await feedback.count(), 0);
    }
    await textarea.fill("{"); await stale.waitFor();
    await page.addScriptTag({ content: readFileSync(fileURLToPath(new URL("../../../node_modules/axe-core/axe.min.js", import.meta.url)), "utf8") });
    const accessibility = await page.evaluate(async () => (await window.axe.run(document.querySelector(".question-drawer-backdrop"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations);
    assert.deepEqual(accessibility.map(v => ({ id: v.id, targets: v.nodes.map(node => node.target) })), []);
    await feedback.scrollIntoViewIfNeeded();
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/stale-${width}.png` });
    await textarea.fill(JSON.stringify(draft, null, 2)); await preview.getByText("Unsaved valid context 2", { exact: true }).waitFor();
    held = { arrived: Promise.withResolvers(), gate: Promise.withResolvers() }; fail = true;
    await save.click(); await held.arrived.promise;
    assert.equal(await save.isDisabled(), true); assert.equal(await textarea.isDisabled(), true);
    await editor.dispatchEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }); await page.keyboard.press("Escape");
    assert.equal(writes.length, initialWrites + 1); assert.equal(await editor.count(), 1);
    held.gate.resolve(); held = null; await editor.getByRole("alert").filter({ hasText: "Synthetic save failure" }).waitFor();
    assert.equal(await textarea.inputValue(), JSON.stringify(draft, null, 2)); assert.equal(await dirty.textContent(), "Unsaved changes");
    fail = false; await textarea.press("Control+s"); await editor.waitFor({ state: "detached" });
    assert.equal(writes.length, initialWrites + 2); assert.deepEqual(writes.at(-1).payload.content.body, draft.questions[0].body);
    assert.deepEqual(writes.at(-1).payload.correctAnswers, draft.questions[0].scoring.correctAnswers);
    assert.equal(writes.at(-1).payload.expectedRevision, 1);
  }
  // A delayed response from an obsolete session must not close the new editor.
  await page.goto(origin); await textarea.waitFor();
  held = { arrived: Promise.withResolvers(), gate: Promise.withResolvers() };
  await save.click(); await held.arrived.promise;
  await switchIdentity("pending-successor", "other-exam", "Pending successor context");
  await preview.getByText("Pending successor context", { exact: true }).waitFor();
  const oldResponse = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith("/questions/first"));
  held.gate.resolve(); held = null; await (await oldResponse).finished();
  // Subsequent UI interactions establish that the replacement session remains
  // operable after the old response body has arrived.
  await textarea.fill("{"); await stale.waitFor(); await save.click();
  assert.equal(await feedback.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.saved), undefined);
  assert.equal(await dirty.textContent(), "Unsaved changes");
  // Switching props without a parent key must reset all identity-local state, even while invalid.
  await page.goto(origin); await textarea.waitFor(); await textarea.fill("{"); await stale.waitFor();
  await switchIdentity("second", "exam", "Second question context");
  await preview.getByText("Second question context", { exact: true }).waitFor(); assert.equal(await stale.count(), 0);
  assert.equal(await dirty.textContent(), "No unsaved changes");
  assert.equal(await textarea.evaluate(el => el.value.includes("First question context")), false);
  await textarea.fill("{"); await stale.waitFor();
  await switchIdentity("second", "other-exam", "Other exam context");
  await preview.getByText("Other exam context", { exact: true }).waitFor(); assert.equal(await stale.count(), 0);
  const other = JSON.parse(await textarea.inputValue()); assert.equal(other.exam.id, "other-exam");
  assert.equal(await dirty.textContent(), "No unsaved changes");
  await save.click(); await editor.waitFor({ state: "detached" });
  assert.equal(writes.at(-1).path, "/api/exams/other-exam/questions/second");
  assert.equal(writes.at(-1).payload.content.body[0].text, "Other exam context");
  await switchIdentity("never-valid", "other-exam", "Must not be cached");
  const empty = await textarea.inputValue(), emptyWrites = writes.length;
  await preview.getByRole("status").filter({ hasText: "No valid preview yet" }).waitFor();
  assert.equal(await currentPreview(), ""); assert.equal(await stale.count(), 0);
  await save.click(); assert.equal(await feedback.evaluate(el => el === document.activeElement), true);
  assert.equal(writes.length, emptyWrites); assert.equal(await textarea.inputValue(), empty);
  await textarea.fill(JSON.stringify(other, null, 2)); await preview.getByText("Other exam context", { exact: true }).waitFor();
  assert.equal(await preview.getByRole("status").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS component preview context: repeated syntax/semantic transitions, exact retained rendering, current-draft Save guard, accessible errors/stale/empty state, caret/scroll/keyboard at 390px and desktop, corrected/failing/pending saves, question and exam identity isolation");
} finally { held?.gate.resolve(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
