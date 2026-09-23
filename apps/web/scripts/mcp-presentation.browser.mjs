// Synthetic host evaluation: renders actual MCP result Markdown + image blocks.
// This is not a claim about a specific third-party client's rendering support.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { build } from "esbuild";
import { marked } from "marked";
import { componentQuestion, presentationRow } from "../../../tests/fixtures/mcp-presentation/question.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL("../../worker/src/mcp/questionPresentation.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { presentQuestion } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const outputDir = process.env.SCREENSHOT_DIR ? join(process.env.SCREENSHOT_DIR, "mcp-presentation") : null;
if (outputDir) await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const show = async result => {
    const blocks = result.content.slice(1).map(block => block.type === "text" ? marked.parse(block.text)
      : `<img alt="Retained source figure" src="data:${block.mimeType};base64,${block.data}">`).join("\n");
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      body{font:17px/1.5 system-ui;background:#f3f5f8;color:#172133;margin:0;padding:24px}
      main{max-width:780px;margin:auto;background:white;border:1px solid #d3dce8;border-radius:14px;padding:30px}
      h1{font-size:25px}h2{font-size:22px;margin-top:28px}h3{font-size:19px}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #8c9aab;padding:9px;text-align:left}
      th{background:#eef2f8}img{display:block;max-width:100%;height:auto}pre{padding:16px;background:#eef2f8;overflow:auto}
      blockquote{margin:16px 0;padding:12px;border-left:4px solid #dfab3b;background:#fff6df}
      .fixture{color:#4d607a;font-size:14px}
      </style><main><div class="fixture">Synthetic MCP conversation host · ${result.structuredContent.data.imageMode}</div><h1>Practice question — answer hidden</h1>${blocks}</main>`);
    await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  };
  const source = componentQuestion();
  await show(presentQuestion(presentationRow(source), "inline"));
  assert.deepEqual(await page.locator("th").allTextContents(), ["System", "Interval", "Retention"]);
  assert.deepEqual(await page.locator("tbody tr").evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.innerText))),
    [["Primary | A", "7 days", "2 generations"], ["Archive", "24 hours", "7 generations"], ["Literal <tag>", "Line 1\nLine 2", ""]]);
  assert.equal(await page.locator("pre code").textContent(), source.body[1].text + "\n");
  assert.equal(await page.locator("img").count(), 2);
  assert.deepEqual(await page.locator("img").evaluateAll(images => images.map(img => [img.naturalWidth, img.naturalHeight])), [[560, 180], [560, 180]]);
  for (const figure of [source.stimuli[0].body[1], source.stimuli[0].body[3]]) await page.getByText(figure.caption, { exact: true }).waitFor();
  await page.getByRole("heading", { name: "ア", exact: true }).waitFor();
  assert.match(await page.locator("main").innerText(), /Preserve the blank __ and the source's 省略\./);
  assert.doesNotMatch(await page.locator("main").innerText(), /SENTINEL|FLATTENED/);
  if (outputDir) await page.screenshot({ path: join(outputDir, "inline.png"), fullPage: true });
  console.log("PASS visible table cells, captions, original boxed/flow images, code indentation, blanks and option labels");

  await show(presentQuestion(presentationRow(source), "text-only"));
  assert.equal(await page.locator("img").count(), 0);
  assert.equal(await page.getByText(/Image description only:/).count(), 2);
  assert.equal(await page.getByText(/cannot be shown in text-only mode/).count(), 2);
  assert.equal(await page.locator("table").count(), 1);
  if (outputDir) await page.screenshot({ path: join(outputDir, "text-only.png"), fullPage: true });
  source.assets = [];
  await show(presentQuestion(presentationRow(source), "inline"));
  assert.equal(await page.locator("img").count(), 0);
  assert.equal(await page.getByText(/referenced figure is missing or invalid/).count(), 2);
  assert.equal(await page.locator("table").count(), 1);
  console.log("PASS text-only and missing-asset output show explicit limitations without fake images or flattened tables");
} finally { await browser.close(); }
