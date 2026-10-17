// Actual component editor, parser, preview and draft guard; synthetic loopback data only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody } from "./browser-fixture.mjs";
import { exportComponentPackage, normalizeImportFile } from "../../../packages/shared/src/question-components.ts";
const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const engine = process.env.PLAYWRIGHT_BROWSER || "chromium";
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
  res.end('<!doctype html><html lang="en"><head><title>Duplicate-key save fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body data-pd-theme="light"><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await playwright[engine].launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  console.log(`Duplicate-key browser: ${engine} ${browser.version()}`);
  const page = await browser.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900}); await page.goto(origin);
    const editor=page.getByRole("dialog",{name:"Edit component question",exact:true});
    const field=editor.getByRole("textbox",{name:"Question package JSON"});
    const feedback=editor.getByRole("region",{name:"Question package errors"});
    await field.waitFor(); const original=await field.inputValue(), before=writes.length;
    for (const raw of [original.replace('"schemaVersion": "2.0"','"schemaVersion": "ignored", "schemaVersion": "2.0"'),
      original.replace('"method": "exact"','"method": "other", "method": "exact"'),
      original.replace('"points": 1','"points": 2, "\\u0070oints": 1')]) {
      await field.fill(raw); await feedback.getByText(/Duplicate object key/).waitFor();
      await editor.getByRole("button",{name:"Save",exact:true}).click();
      assert.equal(await feedback.evaluate(el=>el===document.activeElement),true);
      assert.match(await feedback.textContent(),/line [0-9]+, column [0-9]+; first declared at line/);
      assert.equal(await field.inputValue(),raw); assert.equal(writes.length,before);
      await field.press("Control+s"); assert.equal(writes.length,before);
      await page.keyboard.press("Shift+Tab"); assert.equal(await field.evaluate(el=>el===document.activeElement),true);
      await editor.getByRole("button",{name:"Cancel",exact:true}).click();
      await page.getByRole("button",{name:"Keep editing",exact:true}).click(); assert.equal(await field.inputValue(),raw);
    }
    await field.fill(original); await editor.getByRole("button",{name:"Save",exact:true}).click();
    await editor.waitFor({state:"detached"}); assert.equal(writes.length,before+1);
    assert.equal(writes.at(-1).payload.expectedRevision,7);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  assert.deepEqual(errors,[]);
  console.log("PASS duplicate-key save rejection, both source locations, exact retention, stale preview, keyboard/error focus, discard cancellation and corrected save at 390/1440px; loopback data only");
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
