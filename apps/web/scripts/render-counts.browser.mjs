// Counts which components re-render on the interactions that change the store
// most often: answering a practice question, typing a note and the mock
// exam's one-second countdown. Every store write used to re-render every
// screen, because one context carried the whole state; the store is now split
// into slice contexts, and this keeps it that way.
//
// Renders are counted the way React DevTools does: a stub of its global hook
// receives every commit, and a component rendered in that commit when its
// fiber has the PerformedWork flag. Subtrees React skipped keep their old
// child fibers, so the walk stops wherever a fiber's children did not change.
//
//   node apps/web/scripts/render-counts.browser.mjs           checks the limits
//   RENDER_COUNTS=print node apps/web/scripts/render-counts.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody, waitUntil } from "./browser-fixture.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import {Shell} from './src/App';
function Probe(){window.store=usePrepDeck();return null;}
createRoot(document.getElementById('root')).render(<PrepDeckProvider><Probe/><Shell/></PrepDeckProvider>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false,
  outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });

// Installed before React loads. React (development build) hands every commit
// to this hook, as it would to the DevTools extension.
const HOOK = `(() => {
  const counts = window.__renders = {};
  const PERFORMED_WORK = 1;
  // FunctionComponent, ClassComponent, ForwardRef, SimpleMemoComponent. A
  // MemoComponent (14) is counted through the component it wraps.
  const COMPONENT_TAGS = new Set([0, 1, 11, 15]);
  const nameOf = (type) => type?.displayName || type?.name || type?.render?.name || type?.type?.name || "Anonymous";
  const walk = (fiber) => {
    for (; fiber; fiber = fiber.sibling) {
      if (COMPONENT_TAGS.has(fiber.tag) && (fiber.flags & PERFORMED_WORK)) {
        const name = nameOf(fiber.type);
        counts[name] = (counts[name] ?? 0) + 1;
      }
      // An unchanged child pointer means React reused the subtree as it was.
      if (fiber.alternate && fiber.child === fiber.alternate.child) continue;
      walk(fiber.child);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers: new Map(),
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      const current = root.current;
      if (current.alternate && current.child === current.alternate.child) return;
      walk(current.child);
    },
  };
})();`;

const questions = ["single_choice", "single_choice", "single_choice"].map((type, index) => ({
  id: `q${index + 1}`, examId: "exam", externalId: `Q${index + 1}`, sequenceNumber: index + 1,
  type, chooseCount: 1, stem: `Fixture question ${index + 1}`, tags: ["fixture"], difficulty: "easy", points: 1,
  options: [{ id: "A", text: "Option A" }, { id: "B", text: "Option B" }],
}));
const attempts = new Map(), errors = [];
let serial = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(outputFiles.find(file => file.path.endsWith(url.pathname.slice(1)))?.contents);
    }
    res.setHeader("Content-Type", "text/html");
    return res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><script>${HOOK}</script></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  }
  const { payload } = await readBody(req);
  const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/api/auth/me") return json({ user: { id: "qa", email: "qa@example.test", role: "user", displayName: "QA" } });
  if (url.pathname === "/api/exams") return json({ exams: [{ id: "exam", name: "Render counts", slug: "exam", providers: [], questionCount: questions.length }] });
  if (url.pathname.endsWith("/practice-catalog")) return json({ questions, bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  if (url.pathname.endsWith("/study-status")) return json({ statuses: [] });
  if (url.pathname === "/api/settings") return json({ showSharedNotes: true, timezone: "UTC" });
  if (url.pathname === "/api/annotation-settings") return json({ hl1Alias: "First", hl2Alias: "Second", hl3Alias: "Third" });
  if (url.pathname === "/api/annotations") return json({ annotations: [] });
  if (url.pathname === "/api/notes") return json({ notes: [] });
  if (url.pathname.endsWith("/learning/progress")) return json({ progress: { lastSequenceNumber: 1 } });
  if (url.pathname.endsWith("/ai-explanations")) return json({ explanations: [] });
  if (url.pathname.includes("/knowledge-points")) return json({ knowledgePoints: [], total: 0 });
  if (url.pathname === "/api/attempts/active") return json({ attempt: [...attempts.values()].find(attempt => attempt.mode === "mock" && !attempt.completed) ?? null });
  if (url.pathname === "/api/exams/exam/attempts") {
    const attempt = { ...payload, examId: "exam", attemptId: `attempt-${++serial}`, selectedAnswers: {}, flagged: {}, startedAt: new Date().toISOString() };
    attempts.set(attempt.attemptId, attempt); return json(attempt, 201);
  }
  if (url.pathname.startsWith("/api/attempts/")) {
    const [, , , id, action, qid] = url.pathname.split("/"); const attempt = attempts.get(id);
    if (action === "answers" && req.method === "PUT") { attempt.selectedAnswers[qid] = payload.selectedAnswer; return json({ saved: true }); }
    if (action === "answers") {
      const isCorrect = payload.selectedAnswer?.join() === "A";
      return json({ isCorrect, correctAnswers: ["A"], explanation: "Explanation", answerRevision: 1 });
    }
  }
  return json({ error: "Optional fixture route" }, 503);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

// What each interaction may re-render at most, after the slice split: the
// screen that shows the change, and none of the navigation around it.
const LIMITS = {
  "pick a practice option": { never: ["Shell", "Sidebar", "ExamSelector"] },
  "check a practice answer": { never: ["Shell", "Sidebar", "ExamSelector"] },
  "type 20 characters of a note": { never: ["Shell", "Sidebar", "PracticeLive", "ExplanationPanel", "OptionRow"] },
  "mock countdown, 3 ticks": { never: ["Shell", "Sidebar", "ExamSelector", "MockLive", "OptionRow", "QuestionContent"] },
};

let browser;
const results = {};
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  // Leaving the practice session for the mock asks first.
  page.on("dialog", dialog => dialog.accept());
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.store[method](...args), { method, args });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50))));
  // Renders during `action`, the fixture's Probe (which reads the whole store
  // on purpose) left out.
  const measure = async (label, action) => {
    await settle();
    await page.evaluate(() => { for (const key of Object.keys(window.__renders)) delete window.__renders[key]; });
    await action();
    await settle();
    const counts = await page.evaluate(() => ({ ...window.__renders }));
    delete counts.Probe;
    results[label] = counts;
  };

  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.store?.state.workspaceStatus === "ready");
  await page.getByRole("heading").first().waitFor();

  await invoke("go", "practice");
  await invoke("begin", ["q1", "q2", "q3"]);
  await page.getByText("Fixture question 1", { exact: true }).waitFor();
  await measure("pick a practice option", () => page.getByRole("radio", { name: /Option A/ }).click());
  await measure("check a practice answer", async () => {
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    await page.getByRole("button", { name: "Next question", exact: true }).waitFor();
  });
  await page.getByRole("tab", { name: /Notes/ }).click();
  const note = page.getByRole("textbox", { name: "Note for this question" });
  await note.waitFor();
  await measure("type 20 characters of a note", () => note.pressSequentially("twenty characters!!!"));
  await waitUntil("the typed draft", () => page.evaluate(() => window.store.state.noteDraft), { until: draft => draft === "twenty characters!!!" });

  // Leaving saves a typed draft first, which this fixture has no route for.
  await invoke("setNoteDraft", "");
  await invoke("go", "mock");
  await page.waitForFunction(() => window.store.state.screen === "mock" && !window.store.state.switching);
  await invoke("beginMock");
  await page.waitForFunction(() => window.store.state.mStage === "live");
  await page.getByText(/Fixture question/).first().waitFor();
  // Starts just after a tick, and ends just after the third one from there.
  const left = await page.evaluate(() => window.store.state.mLeft);
  await page.waitForFunction(left => window.store.state.mLeft < left, left);
  await measure("mock countdown, 3 ticks", async () => {
    const start = await page.evaluate(() => window.store.state.mLeft);
    await page.waitForFunction(start => window.store.state.mLeft <= start - 3, start, { timeout: 6000 });
  });

  const total = counts => Object.values(counts).reduce((sum, n) => sum + n, 0);
  for (const [label, counts] of Object.entries(results)) {
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    console.log(`${label}: ${total(counts)} component renders`);
    if (process.env.RENDER_COUNTS === "print") console.log(`  ${top.map(([name, n]) => `${name} ${n}`).join(", ")}`);
  }
  if (process.env.RENDER_COUNTS_JSON) console.log(JSON.stringify(results));
  if (process.env.RENDER_COUNTS !== "print") {
    for (const [label, { never }] of Object.entries(LIMITS)) {
      const rendered = never.filter(name => results[label][name]);
      assert.deepEqual(rendered, [], `${label} re-rendered ${rendered.join(", ")}`);
    }
    console.log("PASS answering, note typing and the mock countdown re-render only what they change");
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.close();
}
