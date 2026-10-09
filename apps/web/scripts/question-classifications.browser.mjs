import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { waitUntil } from "./browser-fixture.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { outputFiles } = await build({ stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
  import QuestionsPanel from './src/components/QuestionsPanel'; import './src/styles/tokens.css'; import './src/styles/app.css';
  function Fixture(){const [exam,setExam]=useState('sg');return <><button onClick={()=>setExam('sg')}>SG exam</button><button onClick={()=>setExam('ip')}>IP exam</button><button onClick={()=>setExam('empty')}>Empty exam</button><QuestionsPanel exam={{id:exam}}/></>}
  createRoot(document.getElementById('root')).render(<Fixture/>);`, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const question = (id, tags, extra = {}) => ({ id, externalId: id, sequenceNumber: Number(id.match(/\d+/)?.[0] ?? 0) + 1, type: "single_choice", stem: `Question ${id}`, tags, options: [{ id: "a", text: "One" }, { id: "b", text: "Two" }], correctAnswers: ["a"], difficulty: "easy", ...extra });
const banks = { sg: [...Array.from({ length: 75 }, (_, i) => question(`a-${i}`, ["科目A"])),
  ...Array.from({ length: 75 }, (_, i) => question(`b-${i}`, ["科目B", ...(i === 54 ? ["focus"] : [])], i === 54 ? { stem: "Selected question", difficulty: "hard", needsReview: true } : {})), question("missing", []), question("ambiguous", ["科目A", "科目B"])],
  ip: [question("technology-1", ["テクノロジ系"]), question("strategy-2", ["ストラテジ系"])] };
banks.empty = [];
banks.sg[0].archivedAt = 1;
const catalogs = { sg: { dimensions: [{ id: "subject", label: "Subject / 科目", allLabel: "All subjects", values: [{ id: "a", label: "科目A", count: 75 }, { id: "b", label: "科目B", count: 75 }], unclassifiedCount: 2 }] },
  ip: { dimensions: [{ id: "field", label: "Field / 分野", allLabel: "All fields", values: [{ id: "technology", label: "テクノロジ系", count: 1 }, { id: "strategy", label: "ストラテジ系", count: 1 }], unclassifiedCount: 0 }] } };
catalogs.empty = { dimensions: [] };
let failCatalog = false, failPage = false, failProbe = false;
let heldProbe = null, releaseProbe = () => {};
const requests = [], errors = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  const json = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  if (url.pathname.startsWith("/api/")) {
    const exam = url.pathname.split("/")[3], params = Object.fromEntries(url.searchParams);
    requests.push({ path: url.pathname, exam, params });
    if (url.pathname.endsWith("/classifications")) {
      if (failCatalog) { failCatalog = false; return json({ error: "Catalog unavailable" }, 503); }
      return json(catalogs[exam]);
    }
    if (failPage && !url.pathname.endsWith("/export")) { failPage = false; return json({ error: "Page unavailable" }, 503); }
    if (params.limit === "1") {
      if (failProbe) { failProbe = false; return json({ error: "Bank check unavailable" }, 503); }
      if (heldProbe) { const probe = heldProbe; heldProbe = null; probe.arrived(); await probe.released; }
    }
    const classifications = JSON.parse(params.classifications || "{}");
    let rows = banks[exam].filter(q => {
      if (classifications.subject === "__unclassified") return q.tags.length === 0 || q.tags.includes("科目A") && q.tags.includes("科目B");
      if (classifications.subject) return q.tags.includes(classifications.subject === "a" ? "科目A" : "科目B") && !(q.tags.includes("科目A") && q.tags.includes("科目B"));
      if (classifications.field) return q.tags.includes(classifications.field === "technology" ? "テクノロジ系" : "ストラテジ系");
      return true;
    }).filter(q => (!params.q || q.stem.includes(params.q)) && (!params.type || q.type === params.type) && (!params.tag || q.tags.includes(params.tag))
      && (!params.archived || Boolean(q.archivedAt) === (params.archived === "true"))
      && (!params.difficulty || q.difficulty === params.difficulty) && (!params.needsReview || Boolean(q.needsReview) === (params.needsReview === "true")));
    const total = rows.length; rows = rows.slice(Number(params.offset || 0), Number(params.offset || 0) + Number(params.limit || 50));
    if (url.pathname.endsWith("/export")) return json({ file: { questions: rows } });
    return json({ questions: rows, total });
  }
  if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
    res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(f => f.path.endsWith(url.pathname.slice(1)))?.contents);
  }
  res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root" style="padding:16px;max-width:1200px;margin:auto"></div><script src="/fixture.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const subject = page.getByLabel("Filter by Subject / 科目"), search = page.getByLabel("Search stem or exact internal / external ID");
  await page.getByText("1–50 of 152", { exact: true }).waitFor();
  assert.equal(await subject.locator('option[value="b"]').textContent(), "科目B (75)", "category exists beyond the loaded first page");
  await subject.selectOption("b"); await page.getByText("1–50 of 75", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click(); await page.getByText("51–75 of 75", { exact: true }).waitFor();
  const exportedIds = async () => { const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "Export this page" }).click(); return JSON.parse(readFileSync(await (await pending).path(), "utf8")).questions.map(q => q.id); };
  assert.deepEqual(await exportedIds(), Array.from({ length: 25 }, (_, i) => `b-${50 + i}`));
  await search.fill("Selected"); await search.press("Enter"); await page.getByText("1–1 of 1", { exact: true }).waitFor();
  await page.getByLabel("Filter by type").selectOption("single_choice");
  await page.getByLabel("Filter by difficulty").selectOption("hard");
  await page.getByLabel("Filter by exact tag").fill("focus");
  await page.getByLabel("Filter by review state").selectOption("true");
  await page.getByLabel("Filter by archived state").selectOption("false");
  await page.getByText("1–1 of 1", { exact: true }).waitFor();
  assert.deepEqual(await exportedIds(), ["b-54"]);
  const params = requests.at(-1).params;
  assert.deepEqual(params, { q: "Selected", type: "single_choice", difficulty: "hard", tag: "focus", needsReview: "true", archived: "false", classifications: '{"subject":"b"}', limit: "50", offset: "0" });
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/question-classifications-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/question-classifications-mobile.png`, fullPage: true });
  failPage = true; await subject.selectOption("a");
  await page.getByRole("alert").filter({ hasText: "Page unavailable" }).waitFor();
  assert.deepEqual(await exportedIds(), ["b-54"], "failed filters do not change what the displayed-page export selects");
  await page.getByRole("button", { name: "IP exam", exact: true }).click();
  const field = page.getByLabel("Filter by Field / 分野"); await field.waitFor();
  assert.equal(await subject.count(), 0); assert.equal(await search.inputValue(), "");
  assert.equal(await page.getByLabel("Filter by exact tag").inputValue(), "");
  assert.equal(requests.filter(r => r.exam === "ip" && r.path.endsWith("/questions")).every(r => !r.params.classifications), true);
  await field.selectOption("technology"); await page.getByText("1–1 of 1", { exact: true }).waitFor();
  assert.deepEqual(await exportedIds(), ["technology-1"]);
  failCatalog = true; await page.getByRole("button", { name: "SG exam", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Classification filters could not be loaded" }).waitFor();
  await page.getByText("1–50 of 152", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry filters" }).click(); await subject.waitFor();
  await subject.selectOption("__unclassified"); await page.getByText("1–2 of 2", { exact: true }).waitFor();
  assert.deepEqual(await exportedIds(), ["missing", "ambiguous"]);
  // Issue #132: reproduce a submitted zero-match search in a non-empty bank.
  await page.getByRole("button", { name: "SG exam", exact: true }).click();
  await subject.selectOption("");
  await page.getByText("1–50 of 152", { exact: true }).waitFor();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await search.fill("PREPDECK-UX-NO-MATCH-20261009");
    await search.press("Enter");
    await page.getByText("0 of 0", { exact: true }).waitFor();
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/zero-results-${width}.png`, fullPage: true });
    assert.equal(await page.getByText("No questions match the current filters.", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Export this page" }).isDisabled(), true);
    const clear = page.getByRole("button", { name: "Clear filters", exact: true });
    await clear.focus(); await page.keyboard.press("Enter");
    await page.getByText("1–50 of 152", { exact: true }).waitFor();
    assert.equal(await search.inputValue(), "");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  // Reset every filter, including archived and classification criteria, and
  // discard an unsubmitted search draft. Keep the current exam and defaults.
  await subject.selectOption("b");
  await page.getByLabel("Filter by type").selectOption("single_choice");
  await page.getByLabel("Filter by difficulty").selectOption("easy");
  await page.getByLabel("Filter by review state").selectOption("false");
  await page.getByLabel("Filter by archived state").selectOption("false");
  await page.getByText("1–50 of 74", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("51–74 of 74", { exact: true }).waitFor();
  await search.fill("unsent draft");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByText("1–50 of 152", { exact: true }).waitFor();
  const resetRequest = requests.filter(r => r.path.endsWith("/questions")).at(-1);
  assert.equal(resetRequest.exam, "sg");
  assert.deepEqual(resetRequest.params, { q: "", type: "", difficulty: "", tag: "", needsReview: "", archived: "", classifications: "", limit: "50", offset: "0" });
  assert.equal(await search.inputValue(), "");
  assert.equal(await subject.inputValue(), "");
  // The default includes archived rows; reset must not silently select active.
  await page.locator(".admin-question-row.is-archived").waitFor();
  await page.getByLabel("Filter by exact tag").fill("missing-tag");
  await page.getByText("No questions match the current filters.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByText("1–50 of 152", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Filter by exact tag").inputValue(), "");
  await page.getByRole("button", { name: "Empty exam", exact: true }).click();
  await page.getByText("This question bank is empty. Add a question to start authoring.", { exact: true }).waitFor();
  await search.fill("anything"); await search.press("Enter");
  await page.getByText("This question bank is empty. Add a question to start authoring.", { exact: true }).waitFor();
  assert.equal(await page.getByText("No questions match the current filters.", { exact: true }).count(), 0);
  failProbe = true; await search.fill("probe failure"); await search.press("Enter");
  await page.getByRole("alert").filter({ hasText: "Bank check unavailable" }).waitFor();
  assert.equal(await page.getByText("This question bank is empty. Add a question to start authoring.", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("This question bank is empty. Add a question to start authoring.", { exact: true }).waitFor();
  // Cancel a pending probe both within one panel (Clear filters) and across
  // keyed panels (exam switching). Bound the wait and always release the server.
  for (const action of ["clear", "switch"]) {
    await page.getByRole("button", { name: action === "clear" ? "SG exam" : "Empty exam", exact: true }).click();
    await page.getByText(action === "clear" ? "1–50 of 152" : "This question bank is empty. Add a question to start authoring.", { exact: true }).waitFor();
    let probeArrived = false;
    heldProbe = { arrived: () => { probeArrived = true; }, released: new Promise(resolve => { releaseProbe = resolve; }) };
    await search.fill("delayed probe"); await search.press("Enter");
    await waitUntil("the unfiltered bank probe", () => probeArrived);
    await page.getByRole("button", { name: action === "clear" ? "Clear filters" : "IP exam", exact: true }).click();
    releaseProbe();
    await page.getByText(action === "clear" ? "1–50 of 152" : "1–2 of 2", { exact: true }).waitFor();
    assert.equal(await search.inputValue(), "");
    assert.equal(await page.getByText("No questions match the current filters.", { exact: true }).count(), 0);
  }
  await page.getByRole("button", { name: "Empty exam", exact: true }).click();
  await page.getByText("This question bank is empty. Add a question to start authoring.", { exact: true }).waitFor();
  // A failed request is not evidence of an empty bank.
  failPage = true; await search.fill("failed query"); await search.press("Enter");
  await page.getByRole("alert").filter({ hasText: "Page unavailable" }).waitFor();
  assert.equal(await page.getByText("This question bank is empty. Add a question to start authoring.", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("This question bank is empty. Add a question to start authoring.", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS classification controls: full-bank categories, combined filters, pagination/export, exam switching, unknown metadata, retry and mobile");
} finally { releaseProbe(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
