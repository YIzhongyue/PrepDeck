// Real Shell/useUrlRouting + Admin/QuestionsPanel, with synthetic loopback data.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody } from "./browser-fixture.mjs";
const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const engine = process.env.PLAYWRIGHT_BROWSER || "chromium";
const original = { id: "history-question", examId: "exam", externalId: "HISTORY-1", sequenceNumber: 1,
  type: "single_choice", stem: "Synthetic history question", options: [{ id: "A", text: "First" }, { id: "B", text: "Second" }],
  correctAnswers: ["A"], explanation: "Official explanation", difficulty: "easy", tags: [], points: 1,
  needsReview: false, archivedAt: null, revision: 1, answerRevision: 1, answerRevisedAt: null };
let question = structuredClone(original);
let heldList = null;
const writes = [], errors = [];
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import {Shell} from './src/App';
  function Probe(){window.store=usePrepDeck();return null;}
  createRoot(document.getElementById('root')).render(<React.StrictMode><PrepDeckProvider><Probe/><Shell/></PrepDeckProvider></React.StrictMode>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(outputFiles.find(f => f.path.endsWith(url.pathname.slice(1)))?.contents);
    }
    res.setHeader("Content-Type", "text/html");
    return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
  if (url.pathname === "/api/auth/me") return json({ user: { id: "synthetic", role: "admin", displayName: "Fixture" } });
  if (url.pathname === "/api/exams") return json({ exams: [{ id: "exam", name: "Synthetic exam", slug: "exam", providers: [], questionCount: 1 }] });
  if (url.pathname === "/api/providers") return json({ providers: [] });
  if (url.pathname === "/api/settings") return json({ showSharedNotes: true });
  if (url.pathname === "/api/annotation-settings") return json({});
  if (url.pathname === "/api/annotations") return json({ annotations: [] });
  if (url.pathname === "/api/notes") return json({ notes: [] });
  if (url.pathname === "/api/admin/question-tags") return json({ tags: [] });
  if (url.pathname.endsWith("/practice-catalog")) return json({ questions: [], bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  if (url.pathname.endsWith("/learning/progress")) return json({ progress: { lastSequenceNumber: null } });
  if (url.pathname === "/api/attempts/active") return json({ attempt: null });
  if (url.pathname.endsWith("/classifications")) return json({ dimensions: [] });
  if (url.pathname === "/api/exams/exam/questions" && req.method === "GET") {
    if (heldList) { const held = heldList; held.arrived.resolve(); await held.gate.promise; }
    const matches = !url.searchParams.get("difficulty") || question.difficulty === url.searchParams.get("difficulty");
    return json({ questions: matches ? [question] : [], total: matches ? 1 : 0 });
  }
  if (url.pathname === "/api/exams/exam/questions/history-question" && req.method === "PATCH") {
    const { payload } = await readBody(req); writes.push(payload);
    assert.equal(payload.expectedRevision, question.revision);
    question = { ...question, ...payload, revision: question.revision + 1 };
    return json({ question });
  }
  return json({ error: "No synthetic route" }, 503);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await playwright[engine].launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  console.log(`Authoring history browser: ${engine} ${browser.version()}`);
  const makePage = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/exams/exam/bookmarks`);
    await page.waitForFunction(() => window.store?.state.workspaceStatus === "ready");
    return page;
  };
  const at = (page, screen, path) => {
    const label = { admin: "Admin", bookmarks: "Bookmarks", wrong: "Wrong questions", practice: "Practice" }[screen];
    const title = `${label}${screen === "admin" ? "" : " · Synthetic exam"} · PrepDeck`;
    return page.waitForFunction(({ screen, path, title }) => window.store.state.screen === screen && location.pathname === path && document.title === title, { screen, path, title });
  };
  const go = async (page, screen, path) => { await page.evaluate(screen => window.store.go(screen), screen); await at(page, screen, path); };
  const traverse = (page, delta) => page.evaluate(delta => new Promise(resolve => {
    // Flush the traversal and any immediate rollback before choosing in the modal.
    addEventListener("popstate", () => requestAnimationFrame(() => requestAnimationFrame(resolve)), { once: true });
    history.go(delta);
  }), delta);
  const open = async page => {
    await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Content" }).click();
    await page.locator(".admin-exam-card").filter({ hasText: "Synthetic exam" }).click();
    await page.locator(".admin-question-row").getByRole("button", { name: "Edit", exact: true }).click();
    await page.locator(".question-drawer").evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  };
  if (process.env.AUTHORING_HISTORY_CASE !== "focus") {
    for (const direction of [-1, 1]) for (const reverse of [false, true]) for (const approve of [false, true]) {
      const page = await makePage(), initialWrites = writes.length;
      if (direction === -1) {
        await go(page, "wrong", "/exams/exam/wrong"); await go(page, "admin", "/admin");
      } else {
        await go(page, "admin", "/admin"); await go(page, "wrong", "/exams/exam/wrong");
        await go(page, "practice", "/exams/exam/practice"); await traverse(page, -2); await at(page, "admin", "/admin");
      }
      await open(page);
      const stem = page.getByLabel("Stem · Markdown", { exact: true }), explanation = page.getByLabel("Official explanation · Markdown", { exact: true });
      const draft = `  Exact ${direction}/${reverse}/${approve} draft\nSecond line  `;
      await stem.fill(draft); await explanation.fill("  Unsaved explanation\n\nKeep whitespace  ");
      const snapshot = () => page.locator(".question-drawer").evaluate(el => [...el.querySelectorAll("input,textarea,select")].map(field => ({ value: field.value, checked: field.checked })));
      const before = await snapshot(), historyBefore = await page.evaluate(() => history.length);
      await traverse(page, direction); await page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true }).waitFor();
      await traverse(page, direction); if (reverse) await traverse(page, -direction);
      assert.equal(await page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true }).count(), 1);
      assert.equal(await page.evaluate(() => window.store.state.screen), "admin");
      assert.deepEqual(await snapshot(), before, "Repeated history traversal preserves the exact unsaved form");
      await page.getByRole("button", { name: approve ? "Discard changes" : "Keep editing", exact: true }).click();
      if (approve) {
        await at(page, "wrong", "/exams/exam/wrong");
        assert.equal(await page.locator(".question-drawer").count(), 0);
        await traverse(page, direction); await at(page, direction < 0 ? "bookmarks" : "practice", direction < 0 ? "/exams/exam/bookmarks" : "/exams/exam/practice");
        await traverse(page, -direction); await at(page, "wrong", "/exams/exam/wrong");
      } else {
        await at(page, "admin", "/admin"); assert.deepEqual(await snapshot(), before);
        assert.equal(await page.locator(".authoring-save-status").textContent(), "Unsaved changes");
        // A later history event must not be swallowed by an obsolete rollback counter.
        await traverse(page, direction); await page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true }).waitFor();
        await page.getByRole("button", { name: "Keep editing", exact: true }).click(); await at(page, "admin", "/admin");
        assert.deepEqual(await snapshot(), before);
        await traverse(page, direction); await page.getByRole("button", { name: "Discard changes", exact: true }).click(); await at(page, "wrong", "/exams/exam/wrong");
        await traverse(page, -direction); await at(page, "admin", "/admin");
      }
      assert.equal(await page.evaluate(() => history.length), historyBefore, "Decision reconciliation must not add or overwrite history entries");
      assert.equal(writes.length, initialWrites, "History dismissal never saves the authoring draft");
      console.log(`PASS history ${direction < 0 ? "Back" : "Forward"} repeated${reverse ? "/reversed" : ""}, ${approve ? "approve" : "cancel"}: URL/store, exact draft, subsequent traversal, zero saves`);
      await page.close();
    }
    // Keep Chromium's tight queue case. WebKit can coalesce those two calls,
    // so also issue a real Forward in capture phase as restoration is delivered,
    // before the router's listener reconciles it. Both actual pops are asserted.
    for (const timing of engine === "chromium" ? ["queued", "delivery"] : ["delivery"]) for (const approve of [false, true]) {
      const page = await makePage(), initialWrites = writes.length;
      await go(page, "wrong", "/exams/exam/wrong"); await go(page, "admin", "/admin");
      await go(page, "practice", "/exams/exam/practice"); await traverse(page, -1); await at(page, "admin", "/admin");
      await open(page); const stem = page.getByLabel("Stem · Markdown", { exact: true }); await stem.fill("Exact draft during restoration\n  ");
      await traverse(page, -1); await page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true }).waitFor(); await traverse(page, -1);
      await page.evaluate(timing => {
        const nativeGo = history.go.bind(history);
        window.restoreEvents = [];
        addEventListener("popstate", event => window.restoreEvents.push({ index: event.state?.prepdeckIndex, path: location.pathname, screen: window.store.state.screen }));
        history.go = delta => {
          history.go = nativeGo;
          const forward = () => { nativeGo(1); window.extraForward = true; };
          if (timing === "delivery") addEventListener("popstate", forward, { capture: true, once: true });
          nativeGo(delta);
          if (timing === "queued") forward();
        };
      }, timing);
      await page.getByRole("button", { name: approve ? "Discard changes" : "Keep editing", exact: true }).click();
      await page.waitForFunction(() => window.extraForward);
      if (!approve) {
        // The additional Forward is a new dirty dismissal once restoration
        // reaches Admin. Refusing it must return to the same exact draft.
        await page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.restoreEvents.slice(0, 2).map(event => event.index)), [2, 3], "Restoration and extra Forward both traverse real entries");
        await page.getByRole("button", { name: "Keep editing", exact: true }).click();
        await at(page, "admin", "/admin"); assert.equal(await stem.inputValue(), "Exact draft during restoration\n  ");
        await traverse(page, -1); await page.getByRole("button", { name: "Discard changes", exact: true }).click(); await at(page, "wrong", "/exams/exam/wrong");
      } else {
        await at(page, "admin", "/admin"); assert.equal(await page.locator(".question-drawer").count(), 0);
        assert.deepEqual(await page.evaluate(() => window.restoreEvents.slice(0, 2).map(event => event.index)), [1, 2], "Approved restoration and extra Forward both traverse real entries");
        await traverse(page, -1); await at(page, "wrong", "/exams/exam/wrong");
      }
      await traverse(page, 1); await at(page, "admin", "/admin");
      assert.equal(writes.length, initialWrites, "Forward during restoration does not save a draft");
      console.log(`PASS extra Forward ${timing} during ${approve ? "approved" : "cancelled"} restoration: both native pops, URL/title/store and later traversal agree, zero saves`);
      await page.close();
    }
  }
  if (process.env.AUTHORING_HISTORY_CASE !== "history") {
    const page = await makePage(); await go(page, "admin", "/admin"); await open(page);
    await page.locator(".question-drawer").getByRole("button", { name: "Cancel", exact: true }).click();
    const filter = page.getByLabel("Filter by difficulty", { exact: true }); await filter.selectOption("easy");
    await page.locator(".admin-question-row").getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Difficulty", { exact: true }).selectOption("hard");
    const before = writes.length;
    await page.locator(".question-drawer").getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved revision 2. No unsaved changes.", { exact: true }).waitFor();
    await page.getByText("No questions match the current filters.", { exact: true }).waitFor();
    await page.locator(".question-drawer").getByRole("button", { name: "Cancel", exact: true }).click();
    const heading = page.locator(".admin-question-list-head").getByRole("heading", { name: "Questions", exact: true });
    assert.equal(await heading.evaluate(el => el === document.activeElement), true, "Filtered-away saved row returns focus to the Questions heading");
    assert.equal(await filter.inputValue(), "easy"); assert.equal(await page.locator(".admin-question-row").count(), 0);
    assert.equal(writes.length, before + 1); assert.equal(question.difficulty, "hard");
    console.log("PASS filtered-away saved row: exact filter preserved, one save, connected Questions heading receives focus");
    await page.close();
    question = structuredClone(original);
    const delayed = await makePage(); await go(delayed, "admin", "/admin"); await open(delayed);
    await delayed.getByLabel("Stem · Markdown", { exact: true }).fill("Saved while list refresh waits");
    heldList = { arrived: Promise.withResolvers(), gate: Promise.withResolvers() };
    await delayed.locator(".question-drawer").getByRole("button", { name: "Save", exact: true }).click();
    await heldList.arrived.promise; await delayed.getByText("Saved revision 2. No unsaved changes.", { exact: true }).waitFor();
    await delayed.locator(".question-drawer").getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await delayed.locator(".admin-question-list-head h3").evaluate(el => el === document.activeElement), true, "Closing during refresh immediately returns focus to the connected heading");
    const search = delayed.getByLabel("Search stem or exact internal / external ID", { exact: true });
    await search.fill("Deliberate next search"); heldList.gate.resolve(); heldList = null;
    await delayed.locator(".admin-question-row").filter({ hasText: "Saved while list refresh waits" }).waitFor();
    assert.equal(await search.evaluate(el => el === document.activeElement), true, "Refresh completion must not steal the user's new focus");
    assert.equal(await search.inputValue(), "Deliberate next search");
    console.log("PASS delayed refresh: immediate heading focus, then deliberate search focus survives list completion");
    await delayed.close();
  }
  assert.deepEqual(errors, [], "No browser exceptions");
} finally { heldList?.gate.resolve(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
