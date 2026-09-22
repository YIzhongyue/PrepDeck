// Standalone source-review workbench, synthetic material only; no bank or server.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const root = await mkdtemp(join(tmpdir(), "prepdeck-review-"));
let browser;
try {
  const file = JSON.parse(await readFile(new URL("../fixtures/components/reading.json", import.meta.url), "utf8"));
  const first = file.questions[0];
  const second = structuredClone(first); second.externalId = "reading-second";
  file.questions = [first, second]; first.scoring.correctAnswers = [];
  const inventory = { documentId: "test", package: file, answerEntries: [], pageReviews: [],
    reviews: file.questions.map(q => ({ externalId: q.externalId, status: "ready", reason: "Synthetic test", questionEvidence: ["page1"], answerEvidence: [], visualEvidence: ["page1"], compositionCandidates: [{ type: "figure", status: "review", page: 1, sourceBlocks: ["page1"] }] })),
    report: { quality: { questionsWithAnswers: 1, automaticAccuracyMeasured: false } } };
  const data = { inventory, blockPages: { page1: 1 }, pages: [{ page: 1, images: [{ id: "page1", url: "source.png" }], text: '</script><script>window.injected=true</script>' }] };
  const template = await readFile(new URL("../../skills/pdf-to-quiz/assets/component-review.html", import.meta.url), "utf8");
  await writeFile(join(root, "review.html"), template.replace("/* REVIEW_DATA */", JSON.stringify(data).replaceAll("<", "\\u003c")));
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  // Render an original-page stand-in containing only invented source text.
  await page.setContent('<html><body style="padding:40px;font:24px serif"><h1>Reading exercise</h1><p>Mira went to the library and borrowed a book.</p><p>Where did Mira go?</p><p>A. The library</p><p>B. The park</p><hr><p>Official answer: A</p></body></html>');
  await page.screenshot({ path: join(root, "source.png") });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(join(root, "review.html")).href);
  await page.waitForFunction(() => document.querySelector("#source img")?.naturalWidth > 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  await page.locator("#filter").selectOption("answer");
  assert.equal(await page.locator("#question option").count(), 1);
  const value = JSON.parse(await page.locator("#editor").inputValue());
  await page.locator("#editor").fill("{");
  await page.locator("#apply").click();
  assert.ok((await page.locator("#message").textContent()).length);
  value.question.scoring.correctAnswers = [value.question.interaction.options[0].id];
  value.stimuli[0].body[0].text += " Reviewed wording.";
  await page.locator("#editor").fill(JSON.stringify(value, null, 2));
  await page.locator("#note").fill("Compared the synthetic source and key.");
  await page.locator("#apply").click();
  assert.match(await page.locator("#message").textContent(), /Correction retained/);
  const downloadPromise = page.waitForEvent("download"); await page.locator("#download").click();
  const download = await downloadPromise;
  const saved = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.ok(saved.reviews.every(r => r.status === "review"));
  assert.equal(saved.report.qualityStale, true);
  assert.deepEqual(saved.pageReviews, []);
  await page.locator("#filter").selectOption("all");
  const screenshots = resolve(process.env.SCREENSHOT_DIR ?? "tmp/component-validation/screenshots");
  await mkdir(screenshots, { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(screenshots, `component-source-review-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("Component source review: desktop/mobile, source image, safe text, errors, filters and shared corrections passed.");
} finally {
  await browser?.close();
  await rm(root, { recursive: true, force: true });
}
