// Actual component editor, parser, preview and draft guard; synthetic loopback data only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createScanner, SyntaxKind } from "jsonc-parser";
import { readBody } from "./browser-fixture.mjs";
import { exportComponentPackage, normalizeImportFile } from "../../../packages/shared/src/question-components.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const standard = { id: "format-fixture", examId: "exam", externalId: "FORMAT-🦊", sequenceNumber: 1, type: "single_choice",
  stem: "Formatting fixture", options: [{ id: "A", text: "First answer" }, { id: "B", text: "Second answer" }], correctAnswers: ["A"],
  explanation: "Synthetic official explanation", difficulty: null, tags: [], points: 1, needsReview: false, archivedAt: null,
  revision: 7, answerRevision: 1, answerRevisedAt: null };
const question = { ...standard, ...normalizeImportFile(exportComponentPackage({ id: "exam", name: "Fixture" }, [standard])).questions[0] };
const writes = [], errors = [];
let held = null, fail = false;
const { outputFiles } = await build({ stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
  import ComponentQuestionEditor from './src/components/ComponentQuestionEditor'; import './src/styles/tokens.css'; import './src/styles/app.css';
  const initial=${JSON.stringify(question)};
  function Fixture() { const [q,setQ]=useState(initial),[open,setOpen]=useState(true);
    return <main><button onClick={()=>setOpen(true)}>Open editor</button>{open && <ComponentQuestionEditor examId="exam" question={q} onClose={()=>setOpen(false)} onSaved={saved=>{setQ(saved);setOpen(false)}}/>}</main>; }
  createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  const json = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  if (url.pathname.startsWith("/api/")) {
    if (req.method !== "PATCH") return json(404, { error: "Unexpected fixture request" });
    const { payload } = await readBody(req); writes.push({ path: url.pathname, payload });
    if (held) { const wait = held; wait.arrived.resolve(); await wait.gate.promise; }
    if (fail) return json(503, { error: "Synthetic save failure" });
    return json(200, { question: { ...question, ...payload, revision: payload.expectedRevision + 1 } });
  }
  if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
    res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(file => file.path.endsWith(url.pathname.slice(1)))?.contents);
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html lang="en"><head><title>Component JSON formatting fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body data-pd-theme="light"><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
const rawTokens = text => {
  const scanner = createScanner(text, false), result = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
    if (kind !== SyntaxKind.Trivia && kind !== SyntaxKind.LineBreakTrivia) {
      assert.equal(scanner.getTokenError(), 0);
      result.push([kind, text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength())]);
    }
  }
  return result;
};
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const editor = page.getByRole("dialog", { name: "Edit component question", exact: true });
  const textarea = editor.getByRole("textbox", { name: "Question package JSON", exact: true });
  const preview = editor.getByRole("region", { name: "Component question preview", exact: true });
  const feedback = editor.getByRole("region", { name: "Question package errors", exact: true });
  const format = editor.getByRole("button", { name: "Format JSON", exact: true });
  const save = editor.getByRole("button", { name: "Save", exact: true });
  const dirty = editor.locator(".authoring-save-status");
  const discard = page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true });
  const position = () => textarea.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection,
    selected: el.value.slice(el.selectionStart,el.selectionEnd), top: el.scrollTop, left: el.scrollLeft, paneTop: el.closest(".question-drawer-body").scrollTop }));
  const currentPreview = () => preview.evaluate(el => [...el.children].filter(child => child.getAttribute("role") !== "status").map(child => child.outerHTML).join(""));
  const focusRetained = async () => assert.equal(await textarea.evaluate(el => el === document.activeElement && el === window.originalTextarea), true);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(origin); await textarea.waitFor();
    await page.locator(".question-drawer").evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    await textarea.evaluate(el => { window.originalTextarea = el; });
    await focusRetained();
    const original = await textarea.inputValue(), initialWrites = writes.length;
    await preview.getByText("Formatting fixture", { exact: true }).waitFor();
    await textarea.focus(); await textarea.press("Shift+Tab");
    assert.equal(await format.evaluate(el => el === document.activeElement), true, "Format JSON is keyboard reachable before the textarea");
    await page.keyboard.press("Enter"); await focusRetained();
    assert.equal(await textarea.inputValue(), original); assert.equal(await dirty.textContent(), "No unsaved changes");
    // Formatting a whitespace-only edit back to the baseline clears dirty state naturally.
    await textarea.fill(JSON.stringify(JSON.parse(original))); await format.click();
    assert.equal(await textarea.inputValue(), original); assert.equal(await dirty.textContent(), "No unsaved changes");
    const draft = JSON.parse(original); draft.questions[0].body[0].text = "Unsaved formatted question";
    draft.questions[0].scoring.correctAnswers = ["B"];
    // Uneven indentation leaves enough real lines to exercise textarea and pane scrolling.
    const raw = JSON.stringify(draft, null, 1);
    await textarea.fill(raw); await preview.getByText("Unsaved formatted question", { exact: true }).waitFor();
    await textarea.evaluate(el => { const at = el.value.indexOf("FORMAT-🦊"); el.focus(); el.setSelectionRange(at,at+"FORMAT-🦊".length,"backward"); el.scrollTop=130; el.closest(".question-drawer-body").scrollTop=30; });
    const before = await position(); assert.ok(before.top > 0); assert.ok(before.paneTop > 0);
    const presentation = await currentPreview();
    await format.click(); await focusRetained();
    const formatted = await textarea.inputValue(), after = await position();
    assert.notEqual(formatted, raw); assert.equal(formatted,JSON.stringify(draft,null,2));
    assert.deepEqual(rawTokens(formatted),rawTokens(raw));
    assert.deepEqual({selected:after.selected,direction:after.direction,top:after.top,left:after.left,paneTop:after.paneTop},
      {selected:before.selected,direction:before.direction,top:before.top,left:before.left,paneTop:before.paneTop});
    assert.equal(await currentPreview(),presentation); assert.equal(await dirty.textContent(),"Unsaved changes");
    assert.equal(writes.length,initialWrites,"Format must not issue a save request");
    await textarea.press("Shift+Tab"); await page.keyboard.press("Space"); await focusRetained();
    assert.equal(await textarea.inputValue(),formatted); assert.deepEqual(await position(),after,"Repeated formatting preserves the editing position");
    await textarea.press("Escape"); await discard.waitFor();
    await discard.getByRole("button",{name:"Keep editing",exact:true}).click(); await focusRetained();
    assert.equal(await textarea.inputValue(),formatted); assert.deepEqual(await position(),after);
    assert.ok(await page.locator(".question-drawer-body").evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await format.scrollIntoViewIfNeeded();
    if(process.env.SCREENSHOT_DIR) await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/formatted-${width}.png`,animations:"disabled"});
    // Valid JSON with invalid package data still formats, retains every lexeme,
    // and keeps validation and the cached preview independent of the action.
    const invalid = String.raw`{"schemaVersion":"2.0","questions":[],"id":"first","id":"second","unknown":{"huge":9007199254740993123456789,"overflow":1e400,"zero":-0,"decimal":1.2300,"text":"  \u0061\t\n  "},"order":[2,1]}`;
    await textarea.fill(invalid); await feedback.waitFor();
    const diagnostics = await feedback.textContent(), retained = await currentPreview();
    await format.click(); await focusRetained();
    const semanticFormatted = await textarea.inputValue(); assert.notEqual(semanticFormatted,invalid);
    assert.deepEqual(rawTokens(semanticFormatted),rawTokens(invalid)); assert.equal(await feedback.textContent(),diagnostics);
    assert.equal(await currentPreview(),retained); await preview.getByText(/Preview is out of date/).waitFor();
    await textarea.press("Control+s"); assert.equal(await feedback.evaluate(el=>el===document.activeElement),true);
    assert.equal(writes.length,initialWrites); await page.keyboard.press("Shift+Tab"); await focusRetained();
    const malformed = `${semanticFormatted}\n,`;
    await textarea.fill(malformed); const syntaxDiagnostics = await feedback.textContent();
    await format.click(); await focusRetained();
    assert.equal(await textarea.inputValue(),malformed); assert.equal(await feedback.textContent(),syntaxDiagnostics);
    assert.equal(await currentPreview(),retained); assert.equal(writes.length,initialWrites);
    await page.addScriptTag({content:readFileSync(fileURLToPath(new URL("../../../node_modules/axe-core/axe.min.js",import.meta.url)),"utf8")});
    const violations=await page.evaluate(async()=>(await window.axe.run(document.querySelector(".question-drawer-backdrop"),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations);
    assert.deepEqual(violations.map(v=>({id:v.id,targets:v.nodes.map(node=>node.target)})),[]);
    // The original discard guard still discards, and reopening starts clean.
    await editor.getByRole("button",{name:"Cancel",exact:true}).click(); await discard.waitFor();
    await discard.getByRole("button",{name:"Discard changes",exact:true}).click(); await editor.waitFor({state:"detached"});
    await page.getByRole("button",{name:"Open editor",exact:true}).click(); await textarea.waitFor();
    assert.equal(await textarea.inputValue(),original); assert.equal(await dirty.textContent(),"No unsaved changes");
    await textarea.fill(raw); await format.click();
    held={arrived:Promise.withResolvers(),gate:Promise.withResolvers()}; fail=true;
    await textarea.press("Control+s"); await held.arrived.promise;
    assert.equal(await format.isDisabled(),true); assert.equal(await textarea.isDisabled(),true);
    await format.dispatchEvent("click"); await editor.dispatchEvent("keydown",{key:"s",ctrlKey:true,bubbles:true}); await page.keyboard.press("Escape");
    assert.equal(await textarea.inputValue(),formatted); assert.equal(writes.length,initialWrites+1); assert.equal(await editor.count(),1);
    held.gate.resolve(); held=null; await editor.getByRole("alert").filter({hasText:"Synthetic save failure"}).waitFor();
    assert.equal(await textarea.inputValue(),formatted); assert.equal(await dirty.textContent(),"Unsaved changes");
    assert.equal(await format.isEnabled(),true); fail=false;
    await textarea.press("Control+s"); await editor.waitFor({state:"detached"});
    assert.equal(writes.length,initialWrites+2); assert.equal(writes.at(-1).payload.expectedRevision,7);
    assert.equal(writes.at(-2).payload.expectedRevision,7); assert.deepEqual(writes.at(-1).payload.content.body,draft.questions[0].body);
    assert.deepEqual(writes.at(-1).payload.correctAnswers,["B"]);
    await page.getByRole("button",{name:"Open editor",exact:true}).click(); await textarea.waitFor();
    assert.equal(await dirty.textContent(),"No unsaved changes"); await preview.getByText("Unsaved formatted question",{exact:true}).waitFor();
    await save.click(); await editor.waitFor({state:"detached"}); assert.equal(writes.at(-1).payload.expectedRevision,8);
  }
  assert.deepEqual(errors,[]);
  console.log("PASS component Format JSON: exact raw tokens, syntax/semantic eligibility, mapped backward UTF-16 selection, focus/scroll/no-op, keyboard, dirty/discard, pending/failing/successful saves and revision baseline at 390px and 1440px; no accessibility or console errors");
} finally { held?.gate.resolve(); await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
