// Actual question renderers with synthetic extraction-style line endings.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const prose = "利用者PCのhostsファ\nイルを確認する。English\nwords stay separate.\n\n次の段落はそのままです。";
const source = { version: "1.0", stimuli: [{ id: "shared", revision: 1, body: [{ id: "passage", type: "paragraph", text: "共有材\n料を読む。" }] }], assets: [], body: [
  { id: "stem", type: "paragraph", text: prose },
  { id: "code", type: "code", text: "if ready:\n    check()\n    save()" },
  { id: "table", type: "table", caption: "Retained table", columns: ["Item", "Value"], rows: [["one\ntwo", "unchanged"]] },
  { id: "list", type: "list", entries: [{ id: "1", text: "First" }, { id: "2", text: "Second" }] },
  { id: "formula", type: "paragraph", text: "x = y + z\nu = v" },
], interaction: { id: "answer", type: "choice", multiple: false, options: [{ id: "A", body: [{ id: "option", type: "paragraph", text: "選択肢のhostsファ\nイルを確認する。" }] }, { id: "B", body: [{ id: "other", type: "paragraph", format: "markdown", text: "Read the **English\nwords** carefully." }] }] } };
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import QuestionContent from './src/components/QuestionContent'; import './src/styles/tokens.css'; import './src/styles/app.css';
const source=${JSON.stringify(source)};window.source=source;
createRoot(document.getElementById('root')).render(<>
<h2>Question prose — synthetic source</h2>
<section aria-label="Shared passage and stem"><QuestionContent src="projection" content={source}/></section>
<section aria-label="Option A"><h3>Option A</h3><QuestionContent src="projection" content={source} optionId="A"/></section>
<section aria-label="Option B"><h3>Option B</h3><QuestionContent src="projection" content={source} optionId="B"/></section>
<section aria-label="Legacy Markdown"><h3>Legacy Markdown</h3><QuestionContent src={${JSON.stringify(prose.replace("hostsファ\nイル", "**hostsファ\nイル**"))}}/></section>
<section aria-label="Intentional breaks"><h3>Intentional breaks</h3><QuestionContent src={${JSON.stringify("First  \nSecond\\\nThird")}}/></section>
</>);`, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const server = createServer((req, res) => {
  if (req.url === "/fixture.js" || req.url === "/fixture.css") {
    res.setHeader("Content-Type", req.url.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(f => f.path.endsWith(req.url.slice(1)))?.contents);
  }
  res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><main id="root" style="padding:24px;max-width:760px;margin:auto;font-family:system-ui"></main><script src="/fixture.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } }); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const stem = page.getByRole("region", { name: "Shared passage and stem" });
  await stem.getByText("共有材料を読む。", { exact: true }).waitFor();
  const paragraph = stem.locator("p").nth(1);
  assert.equal(await paragraph.textContent(), "利用者PCのhostsファイルを確認する。English words stay separate.\n\n次の段落はそのままです。");
  assert.equal(await paragraph.evaluate(el => {
    const node = el.firstChild, start = node.textContent.indexOf("hostsファイル");
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + "hostsファイル".length);
    return range.getClientRects().length;
  }), 1, "source wrap inside hostsファイル no longer forces a display break");
  assert.equal(await stem.locator("code").textContent(), source.body[1].text);
  assert.equal(await stem.locator("td").first().innerText(), "one\ntwo");
  assert.deepEqual(await stem.locator("li").allTextContents(), ["1 First", "2 Second"]);
  assert.equal(await stem.locator("p").last().innerText(), "x = y + z\nu = v");
  await page.getByRole("region", { name: "Option A" }).getByText("選択肢のhostsファイルを確認する。", { exact: true }).waitFor();
  await page.getByRole("region", { name: "Option B" }).getByText("English words", { exact: true }).waitFor();
  const legacy = page.getByRole("region", { name: "Legacy Markdown" });
  assert.equal(await legacy.locator("p").count(), 2);
  assert.match(await legacy.innerText(), /hostsファイル/); assert.match(await legacy.innerText(), /English words/);
  assert.deepEqual(await page.getByRole("region", { name: "Intentional breaks" }).locator("p").allTextContents(), ["First", "Second", "Third"]);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/question-prose-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok(await paragraph.evaluate(el => el.getBoundingClientRect().height > parseFloat(getComputedStyle(el).lineHeight) * 2));
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/question-prose-mobile.png`, fullPage: true });
  assert.deepEqual(await page.evaluate(() => window.source), source, "rendering must not rewrite stored/evidence text");
  assert.deepEqual(errors, []);
  console.log("PASS prose display: shared material/stem/options, Japanese/Latin wrapping, intentional paragraphs/code/table/list/formulas and mobile");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
