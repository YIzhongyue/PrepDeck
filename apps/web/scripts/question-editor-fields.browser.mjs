// Real standard editor, original synthetic questions, loopback-only saves.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody } from "./browser-fixture.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const types = ["single_choice", "multiple_choice", "true_false", "fill_blank"];
const fixtures = Object.fromEntries(types.map(type => [type, {
  id: `synthetic-internal-identifier-${"long-".repeat(9)}${type}`, examId: "exam", sequenceNumber: 7, revision: 3,
  type, stem: "Which synthetic answer fits this original layout fixture?",
  options: type === "fill_blank" ? undefined : type === "true_false"
    ? [{ id: "true", text: "True" }, { id: "false", text: "False" }]
    : [{ id: "A", text: "First synthetic option" }, { id: "C", text: "Third synthetic option" }, { id: "F", text: "Sixth synthetic option" }],
  correctAnswers: type === "fill_blank" ? ["synthetic answer", "accepted alternative"] : type === "true_false" ? ["true"] : type === "multiple_choice" ? ["A", "F"] : ["C"],
  explanation: "An original official explanation for local verification.",
  externalId: `SYNTHETIC-${"long-identifier-".repeat(7)}${type}`, difficulty: "easy", points: 1,
  tags: [], needsReview: true, archivedAt: "2026-01-01T00:00:00Z"
}]));
let serverIssues = null;
const writes = [];
const { outputFiles } = await build({ stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
  import QuestionEditorDialog from './src/components/QuestionEditorDialog'; import './src/styles/tokens.css'; import './src/styles/app.css';
  const fixtures = ${JSON.stringify(fixtures)};
  function Fixture() { const [open, setOpen] = useState(false); const q = fixtures[new URLSearchParams(location.search).get('type')];
    return <><button onClick={() => setOpen(true)}>Open editor</button>{open && <QuestionEditorDialog examId="exam" question={q}
      initialType={q.type} onClose={() => setOpen(false)} onSaved={() => setOpen(false)}/>}</>; }
  createRoot(document.getElementById('root')).render(<Fixture/>);`, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/api/admin/question-tags") return json(200, { tags: [] });
  if (req.method === "PATCH") {
    const { payload } = await readBody(req);
    if (serverIssues) return json(422, { error: "Synthetic validation", issues: serverIssues });
    writes.push(payload);
    return json(200, { question: { ...fixtures[payload.type], ...payload, revision: 4 } });
  }
  if (url.pathname.startsWith("/api/")) return json(404, { error: "Unknown fixture route" });
  if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
    res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(f => f.path.endsWith(url.pathname.slice(1))).contents);
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  console.log(`Question editor fields browser: Chromium ${browser.version()}`);
  const errors = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }, { width: 720, height: 500 }, { width: 844, height: 390 }]) {
    for (const type of types) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(10000);
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
      await page.goto(`http://127.0.0.1:${server.address().port}/?type=${type}`);
      await page.getByRole("button", { name: "Open editor" }).click();
      await page.locator(".question-drawer").evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)); });
      const q = fixtures[type], pane = page.locator("#question-fields"), header = page.locator(".question-drawer-header");
      const save = page.getByRole("button", { name: "Save", exact: true });
      const option = id => page.getByLabel(`Option ${id} · Markdown`, { exact: true });
      const answer = id => page.getByLabel(`Correct answer ${id}`, { exact: true });
      const noOverflow = async () => assert.equal(await page.evaluate(() => [document.documentElement, document.querySelector(".question-drawer"), document.querySelector("#question-fields")].every(el => el.scrollWidth <= el.clientWidth + 1)), true, `${type} at ${viewport.width}: no horizontal page or pane overflow`);
      assert.ok((await header.innerText()).includes(`#7 · ${q.id} · revision 3`));
      assert.ok((await header.innerText()).includes(`External ID: ${q.externalId}`));
      assert.equal(await header.getByText("Archived", { exact: true }).count(), 1);
      assert.equal(await header.getByText("Needs review", { exact: true }).count(), 1);
      await noOverflow();
      const footerBox = await save.boundingBox();
      assert.ok(footerBox.y + footerBox.height <= viewport.height, "Save remains within the viewport");
      assert.ok((await pane.boundingBox()).height >= 80, "Long header identifiers leave an editable pane");
      if (q.options) {
        for (const o of q.options) {
          assert.equal(await answer(o.id).isChecked(), q.correctAnswers.includes(o.id));
          assert.equal(await answer(o.id).evaluate(el => [...el.labels].some(label => label.textContent.trim() === "Correct answer" && label.getBoundingClientRect().width > 0)), true, "Every answer control has a visible associated label");
          if (type !== "true_false") {
            const bounds = await page.getByRole("button", { name: `Remove option ${o.id}`, exact: true }).boundingBox();
            assert.ok(bounds.width >= 44 && bounds.height >= 44, "Remove target is at least 44x44 CSS pixels");
          }
        }
        const first = option(q.options[0].id), element = await first.elementHandle();
        await first.focus();
        await first.evaluate(el => el.setSelectionRange(3, 3));
        const before = await first.boundingBox(), scrollBefore = await pane.evaluate(el => el.scrollTop);
        await first.evaluate(el => el.addEventListener("input", () => {
          el.dataset.scrollBeforeResize = String(el.closest(".question-editor-pane").scrollTop);
        }, { once: true, capture: true }));
        const inserted = "A long synthetic option line with enough words to wrap again in a phone column.\n".repeat(9);
        await page.keyboard.insertText(inserted);
        const after = await first.boundingBox();
        assert.ok(after.height > before.height + 100, "Option grows as content is inserted");
        assert.equal(await element.evaluate(el => el.isConnected), true, "Typing retains the textarea node");
        assert.deepEqual(await first.evaluate(el => [document.activeElement === el, el.selectionStart, el.selectionEnd]), [true, 3 + inserted.length, 3 + inserted.length], "Typing preserves focus and caret");
        // A short viewport can reveal the caret as the native input is inserted.
        // The subsequent React auto-sizing must retain that browser position.
        assert.equal(await pane.evaluate(el => el.scrollTop), Number(await first.getAttribute("data-scroll-before-resize")), "Auto-sizing preserves the native input's pane position");
        if (viewport.height >= 500) assert.equal(await pane.evaluate(el => el.scrollTop), scrollBefore, "Typing in a roomy pane retains the existing scroll offset");
        assert.equal(await first.evaluate(el => el.scrollHeight <= el.clientHeight + 1), true, "Whole option fits without an inner scrollbar");
        if (viewport.width === 1440) {
          await first.evaluate(el => el.setSelectionRange(7, 17));
          await page.setViewportSize({ width: 390, height: 844 });
          await page.locator(".question-editor-view-switch").waitFor({ state: "visible" });
          await page.waitForFunction(() => { const el = document.querySelector("#option-0"); return el.scrollHeight <= el.clientHeight + 1; });
          assert.ok((await first.boundingBox()).height > after.height, "Narrower columns refit wrapping content");
          assert.deepEqual(await first.evaluate(el => [document.activeElement === el, el.selectionStart, el.selectionEnd]), [true, 7, 17]);
          await noOverflow();
          await page.setViewportSize(viewport);
          await page.locator(".question-editor-view-switch").waitFor({ state: "hidden" });
          await page.waitForFunction(height => document.querySelector("#option-0").getBoundingClientRect().height <= height + 1, after.height);
          assert.equal(await element.evaluate(el => el.isConnected), true, "Reflow retains the same textarea node");
        }
        if (viewport.width < 1100) {
          await first.evaluate(el => el.setSelectionRange(7, 17));
          const scroll = await pane.evaluate(el => el.scrollTop);
          await page.getByRole("button", { name: "Preview", exact: true }).click();
          await page.getByRole("button", { name: "Edit", exact: true }).click();
          assert.deepEqual(await first.evaluate(el => [document.activeElement === el, el.selectionStart, el.selectionEnd]), [true, 7, 17]);
          assert.equal(await pane.evaluate(el => el.scrollTop), scroll, "Pane switches retain scroll with expanded options");
          assert.equal(await element.evaluate(el => el.isConnected), true);
        }
        const nearBottom = await pane.evaluate(el => { el.scrollTop = el.scrollHeight - el.clientHeight - 10; return el.scrollTop; });
        assert.ok(nearBottom > 0);
        // Deliver the same native input event without Playwright fill() first
        // scrolling an offscreen focused control back into view. This isolates
        // the auto-sizing scroll change; typing/caret behavior is checked above.
        await first.evaluate((el, value) => {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }, q.options[0].text);
        assert.ok((await first.boundingBox()).height < after.height, "Option shrinks after content is removed");
        const shrunkenPane = await pane.evaluate(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
        assert.equal(shrunkenPane.top, Math.min(nearBottom, shrunkenPane.max), "Shrinking near the bottom preserves scroll, clamping only to the new content extent");
        // Clicking the visible label selects its associated control.
        const lastId = q.options.at(-1).id;
        await answer(lastId).evaluate(el => el.labels[0].click());
        assert.equal(await answer(lastId).isChecked(), !q.correctAnswers.includes(lastId) || type !== "multiple_choice");
        if (type === "multiple_choice") await answer(lastId).check();
        else await answer(q.correctAnswers[0]).check();
        if (type !== "true_false") {
          await page.getByRole("button", { name: "Remove option C", exact: true }).click();
          assert.equal(await option("C").count(), 0);
          assert.equal(await option("F").count(), 1, "Surviving option IDs stay unchanged");
          await page.getByRole("button", { name: "Undo", exact: true }).click();
          assert.equal(await option("C").inputValue(), q.options[1].text);
          for (const id of q.correctAnswers) assert.equal(await answer(id).isChecked(), true, "Undo restores answer selection");
        }
        if (process.env.SCREENSHOT_DIR && type === "single_choice") {
          mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
          await option("A").scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/question-editor-fields-${viewport.width}-options.png` });
        }
        serverIssues = [{ path: "$.options[1].text", message: "Synthetic option correction" }];
        await save.click();
        const invalid = option(q.options[1].id);
        await page.waitForFunction(() => document.activeElement?.id === "option-1");
        assert.equal(await invalid.getAttribute("aria-invalid"), "true");
        const describedBy = await invalid.getAttribute("aria-describedby");
        assert.ok((await page.locator(`#${describedBy}`).innerText()).includes("Synthetic option correction"));
        await invalid.fill(q.options[1].text + " corrected");
        assert.equal(await invalid.getAttribute("aria-invalid"), "false");
        serverIssues = null;
      } else {
        assert.equal(await page.getByLabel("Accepted answers (one per line)").inputValue(), q.correctAnswers.join("\n"));
        assert.equal(await page.locator(".authoring-option").count(), 0);
      }
      const external = page.getByLabel("External ID (optional, unique in this exam)");
      await external.fill("SYNTHETIC-DRAFT-ID");
      await header.getByText("External ID: SYNTHETIC-DRAFT-ID", { exact: true }).waitFor();
      await external.fill("");
      assert.equal(await header.getByText(/^External ID:/).count(), 0);
      await external.fill(q.externalId);
      await page.getByLabel("Difficulty", { exact: true }).selectOption("hard");
      await page.getByLabel("Points", { exact: true }).fill("2");
      const metadata = await page.locator(".authoring-metadata .field").evaluateAll(els => els.map(el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }));
      assert.ok(metadata[1].y >= metadata[0].y + metadata[0].height, "External ID has its own row");
      assert.equal(metadata[1].y, metadata[2].y, "Difficulty and Points share the next row");
      if (process.env.SCREENSHOT_DIR && type === "single_choice") {
        await page.locator(".authoring-metadata").evaluate(el => el.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/question-editor-fields-${viewport.width}-metadata.png` });
      }
      const review = page.getByLabel("Needs review", { exact: true });
      assert.equal(await review.getAttribute("aria-describedby"), "question-needs-review-help");
      assert.equal(await page.locator("#question-needs-review-help").evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 13), true);
      await review.uncheck();
      assert.equal(await header.getByText("Needs review", { exact: true }).count(), 0);
      await review.check();
      await noOverflow();
      const count = writes.length;
      await save.click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      assert.equal(writes.length, count + 1);
      const payload = writes.at(-1);
      assert.equal(payload.expectedRevision, 3);
      assert.deepEqual(payload.correctAnswers, q.correctAnswers);
      assert.deepEqual(payload.options?.map(o => o.id), q.options?.map(o => o.id));
      assert.equal(payload.externalId, q.externalId);
      assert.equal(payload.difficulty, "hard"); assert.equal(payload.points, 2); assert.equal(payload.needsReview, true);
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log("Question editor fields: 16 viewport/type cases passed, including labels, growing/shrinking options, caret/scroll and bottom clamping, live reflow, Undo, validation, metadata, status and saved payloads.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
