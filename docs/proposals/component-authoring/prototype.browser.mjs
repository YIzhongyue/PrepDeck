import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./server.mjs";
import { fixtures } from "./fixtures.mjs";
import { inspect } from "./model.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const fixture = await serve();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  console.log(`Discovery browser: Chromium ${browser.version()}`);
  const errors = [], external = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width === 390 });
    await context.route("**/*", route => {
      if (route.request().url().startsWith(fixture.origin)) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(fixture.origin);
    const json = page.getByLabel("Question package JSON");
    const source = async () => JSON.parse(await json.inputValue());
    const initial = await json.inputValue(); // HTML textarea normalizes CRLF to LF.
    assert.deepEqual(JSON.parse(initial), JSON.parse(fixtures.ordering));
    await page.getByRole("button", { name: "Return to JSON" }).click();
    const selection = await json.evaluate(element => { element.focus(); element.setSelectionRange(40, 60); element.scrollTop = 150; return { start: element.selectionStart, end: element.selectionEnd, scroll: element.scrollTop }; });
    await page.getByRole("button", { name: "Answer controls", exact: true }).click();
    await page.getByRole("button", { name: "Return to JSON" }).click();
    assert.equal(await json.inputValue(), initial);
    assert.deepEqual(await json.evaluate(element => ({ start: element.selectionStart, end: element.selectionEnd, scroll: element.scrollTop })), selection);
    await page.getByRole("button", { name: "Answer controls", exact: true }).click();
    const move = page.getByRole("button", { name: "Move act up", exact: true });
    if (width === 390) await move.tap(); else { await move.focus(); await page.keyboard.press("Enter"); }
    assert.deepEqual((await source()).questions[0].scoring.correctAnswers, ["act", "read", "check"]);
    assert.equal(await page.getByRole("listitem", { name: "Answer act", exact: true }).evaluate(element => element === document.activeElement), true);
    assert.match(await page.getByRole("status").innerText(), /act moved to position 1 of 3/);
    const preview = page.getByRole("region", { name: "Read-only question preview" });
    assert.match(await preview.innerText(), /1\. Perform `the step`/);
    assert.equal(await preview.locator("script").count(), 0);
    assert.equal(await preview.getByRole("table").count(), 1);
    assert.equal(await preview.getByRole("img", { name: "Synthetic single pixel" }).count(), 1);
    const target = await move.boundingBox(); assert.ok(target.height >= 44 && target.width >= 44);
    const screenshotDir = process.env.SCREENSHOT_DIR;
    if (screenshotDir) { mkdirSync(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, `ordering-${width}.png`), fullPage: true }); }
    await page.getByRole("button", { name: "Undo last change" }).click();
    assert.equal(await json.inputValue(), initial);
    await page.getByRole("button", { name: "Matching", exact: true }).click();
    assert.match(await preview.innerText(), /Shared category/);
    assert.match(await preview.innerText(), /First entry → Shared category/);
    const match = page.getByLabel("Match same", { exact: true });
    await match.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    assert.deepEqual((await source()).questions[0].scoring.correctAnswers, ['["second","same"]', '["same","other"]']);
    assert.equal(await match.evaluate(element => element === document.activeElement), true);
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `matching-${width}.png`), fullPage: true });
    for (const name of ["Unsupported", "Duplicate", "Invalid"]) {
      await page.getByRole("button", { name, exact: true }).click();
      assert.equal(await page.getByRole("alert").count(), 1);
      assert.equal(await page.getByRole("button", { name: /^Move / }).count(), 0);
      await page.getByRole("button", { name: "Return to JSON" }).click();
      const before = await json.inputValue();
      await page.getByRole("button", { name: "Answer controls", exact: true }).click();
      assert.equal(await json.inputValue(), before);
      assert.equal(inspect(before).preview, undefined);
    }
    await page.getByRole("button", { name: "Return to JSON" }).click();
    await json.fill(fixtures.matching);
    await page.getByRole("button", { name: "Answer controls", exact: true }).click();
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.equal(await match.count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.ok(fixture.requests.every(request => request.method === "GET" && !request.path.startsWith("/api/")));
  console.log("PASS: ordering, matching, keyboard/touch, undo, exact source retention, unsupported recovery, shared content, 390px layout, and zero writes/external requests.");
} finally { await browser?.close(); await fixture.close(); }
