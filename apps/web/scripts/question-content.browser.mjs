// Real screens/provider with delayed component snapshots, cache refreshes and
// network failures. Metadata alone must never become an answerable question.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import {Shell} from './src/App';
function Probe(){window.store=usePrepDeck();return null;}
createRoot(document.getElementById('root')).render(<PrepDeckProvider><Probe/><Shell/></PrepDeckProvider>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false,
  outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1cAAAAASUVORK5CYII=";
const paragraph = (id, text) => ({ id, type: "paragraph", text });
const figureContent = text => ({ version: "1.0", body: [paragraph("stem", text), { id: "figure", type: "figure", assetId: "image", alt: "Question figure" }], stimuli: [],
  assets: [{ id: "image", mediaType: "image/png", data: image }], interaction: { id: "answer", type: "choice", multiple: false,
    options: ["A", "B"].map(id => ({ id, body: [paragraph(`option-${id}`, `Choice ${id}`)] })) } });
const contents = {
  q1: figureContent("Original component question"),
  q2: { version: "1.0", body: [{ id: "code", type: "code", text: "print(read())", language: "python" }], stimuli: [], assets: [],
    interaction: { id: "answer", type: "order", options: ["read", "print"].map(id => ({ id, body: [paragraph(id, id)] })) } },
  other: figureContent("Other exam component"),
};
const revisions = { q1: 1, q2: 1, other: 1 };
const questions = ["q1", "q2", "legacy"].map((id, i) => ({ id, externalId: id, sequenceNumber: i + 1,
  type: id === "q2" ? "ordering" : "single_choice", chooseCount: 1, stem: `${id} text projection`, tags: [], difficulty: "easy", points: 1,
  options: (id === "q2" ? ["read", "print"] : ["A", "B"]).map(id => ({ id, text: `Choice ${id}` })), hasContent: id !== "legacy", revision: 1 }));
const otherQuestions = [{ ...questions[0], id: "other", externalId: "other" }];
const attempts = new Map(), calls = [], errors = [], deferred = new Set(), failures = new Set(), pending = [];
let serial = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(outputFiles.find(file => file.path.endsWith(url.pathname.slice(1)))?.contents);
    }
    res.setHeader("Content-Type", "text/html");
    return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
  let raw = ""; for await (const chunk of req) raw += chunk;
  const payload = JSON.parse(raw || "{}"); calls.push({ path: url.pathname, method: req.method, payload });
  const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/api/auth/me") return json({ user: { id: "qa", email: "qa@example.test", role: "user", displayName: "QA" } });
  if (url.pathname === "/api/exams") return json({ exams: ["exam", "other"].map(id => ({ id, name: id, slug: id, providers: [] })) });
  if (url.pathname.endsWith("/practice-catalog")) return json({ questions: url.pathname.includes("/other/") ? otherQuestions : questions, bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  const detail = url.pathname.match(/\/practice-catalog\/([^/]+)$/);
  if (detail) {
    const id = detail[1];
    if (failures.has(id)) return json({ error: "Question content is temporarily unavailable." }, 503);
    const snapshot = JSON.parse(JSON.stringify({ content: contents[id] ?? null, revision: revisions[id] }));
    if (deferred.has(id)) { pending.push({ id, path: url.pathname, reply: () => json(snapshot) }); return; }
    return json(snapshot);
  }
  if (url.pathname === "/api/settings") return json({ showSharedNotes: true });
  if (url.pathname === "/api/annotation-settings") return json({ hl1Alias: "First", hl2Alias: "Second", hl3Alias: "Third" });
  if (url.pathname === "/api/annotations") return json({ annotations: [] });
  if (url.pathname === "/api/notes") return json({ notes: [] });
  if (url.pathname.endsWith("/learning/progress")) return json({ progress: { lastSequenceNumber: 1 } });
  if (url.pathname.endsWith("/learning-detail")) {
    const id = url.pathname.split("/")[3];
    return json({ question: { content: contents[id], revision: revisions[id], correctAnswers: id === "q2" ? ["read", "print"] : ["A"], explanation: "Explanation", answerRevision: 1 }, history: [] });
  }
  if (url.pathname.endsWith("/ai-explanations")) return json({ explanations: [] });
  if (url.pathname.endsWith("/knowledge-points")) return json({ knowledgePoints: [], total: 0 });
  if (url.pathname === "/api/attempts/active") return json({ attempt: null });
  if (/\/exams\/[^/]+\/attempts$/.test(url.pathname)) {
    const attempt = { ...payload, examId: url.pathname.split("/")[3], attemptId: `attempt-${++serial}`, selectedAnswers: {}, flagged: {}, startedAt: new Date().toISOString() };
    attempts.set(attempt.attemptId, attempt); return json(attempt, 201);
  }
  if (url.pathname.startsWith("/api/attempts/")) {
    const [, , , id, action, qid] = url.pathname.split("/"); const attempt = attempts.get(id);
    if (action === "answers" && req.method === "PUT") { attempt.selectedAnswers[qid] = payload.selectedAnswer; return json({ saved: true }); }
    if (action === "flags") return json({ saved: true });
    if (action === "answers") return json({ isCorrect: true, correctAnswers: payload.questionId === "q2" ? ["read", "print"] : ["A"], explanation: "Explanation", answerRevision: 1 });
    if (action === "complete") return json({ attemptId: id, mode: attempt.mode, score: 100, passed: true, correctCount: 1, totalQuestions: attempt.questionIds.length, durationSeconds: 1,
      breakdown: attempt.questionIds.map(questionId => ({ questionId, selectedAnswer: attempt.selectedAnswers[questionId] ?? [], correctAnswers: ["A"], isCorrect: true })) });
  }
  return json({ error: "Optional fixture route" }, 503);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const waitFor = async predicate => {
  const deadline = Date.now() + 10000;
  while (!predicate()) { assert.ok(Date.now() < deadline, "fixture request timed out"); await new Promise(resolve => setTimeout(resolve, 20)); }
};
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => window.store?.state.workspaceStatus === "ready");
  const state = () => page.evaluate(() => window.store.state);
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.store[method](...args), { method, args });
  const choose = (method, id, answer) => page.evaluate(({ method, id, answer }) => window.store[method](window.store.state.catalogBy[id], answer), { method, id, answer });
  const release = async index => {
    const request = pending.splice(index, 1)[0];
    const response = page.waitForResponse(response => response.url().endsWith(request.path));
    request.reply(); await response;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const detailCalls = () => calls.filter(call => /\/practice-catalog\/[^/]+$/.test(call.path));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await ready();
  assert.equal(detailCalls().length, 0, "loading setup does not fetch every component snapshot");
  deferred.add("q1"); await invoke("begin", ["q1", "q2", "legacy"]);
  await waitFor(() => pending.length === 1);
  await page.getByText("Loading question…", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Check answer", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "End session", exact: true }).isVisible(), true);
  await page.keyboard.press("a"); await page.keyboard.press("Enter");
  await choose("pick", "q1", "A"); await invoke("submit");
  assert.deepEqual((await state()).sel, {});
  assert.equal(calls.filter(call => call.path.endsWith("/answers")).length, 0);
  deferred.delete("q1"); await release(0);
  await page.getByRole("img", { name: "Question figure", exact: true }).waitFor();
  assert.equal(await page.getByRole("img", { name: "Question figure", exact: true }).evaluate(img => img.complete && img.naturalWidth > 0), true);
  await choose("pick", "q1", "A"); await invoke("submit");
  await page.waitForFunction(() => window.store.state.done.q1 === "ok");
  failures.add("q2"); await invoke("next");
  await page.getByRole("button", { name: "Retry question", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Position 1", exact: true }).count(), 0);
  await invoke("prevQ"); await page.getByRole("img", { name: "Question figure", exact: true }).waitFor();
  assert.equal((await state()).done.q1, "ok"); assert.deepEqual((await state()).sel.q1, ["A"]);
  await invoke("next"); failures.delete("q2"); await page.getByRole("button", { name: "Retry question", exact: true }).click();
  await page.getByRole("combobox", { name: "Position 1", exact: true }).selectOption("read");
  await page.getByRole("combobox", { name: "Position 2", exact: true }).selectOption("print");
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.waitForFunction(() => window.store.state.done.q2 === "ok");
  assert.deepEqual(calls.findLast(call => call.path.endsWith("/answers")).payload.selectedAnswer, ["read", "print"]);
  console.log("PASS lazy Practice loading blocks answers, retries failures, renders figures/ordering and retains graded state");

  // An older request must not attach its content after a same-exam refresh.
  await page.reload(); await ready(); deferred.add("q1"); await invoke("begin", ["q1"]); await waitFor(() => pending.length === 1);
  contents.q1 = figureContent("Refreshed component question");
  revisions.q1 = questions[0].revision = 2;
  await page.evaluate(() => window.dispatchEvent(new Event("prepdeck:question-bank-changed")));
  await waitFor(() => pending.length === 2);
  await release(0);
  assert.equal((await state()).catalogBy.q1.content, undefined);
  await page.getByText("Loading question…", { exact: true }).waitFor();
  deferred.delete("q1"); await release(0);
  await page.getByText("Refreshed component question", { exact: true }).waitFor();
  console.log("PASS a same-exam refresh ignores older content and loads the refreshed snapshot");

  // A DB edit can precede catalogue KV invalidation. Do not combine an old
  // choice projection with a newly returned ordering interaction.
  await page.reload(); await ready();
  contents.q1 = contents.q2; revisions.q1 = 3;
  await invoke("begin", ["q1"]);
  await page.getByText("This question changed. Refresh the exam and try again.", { exact: true }).waitFor();
  await choose("pick", "q1", "A"); await invoke("submit");
  assert.equal((await state()).catalogBy.q1.content, undefined);
  assert.equal((await state()).sel.q1, undefined);
  Object.assign(questions[0], { revision: 3, type: "ordering", options: questions[1].options });
  await page.getByRole("button", { name: "Refresh exam", exact: true }).click();
  await page.getByRole("combobox", { name: "Position 1", exact: true }).waitFor();
  assert.equal((await state()).catalogBy.q1.type, "ordering");
  contents.q1 = figureContent("Refreshed component question"); revisions.q1 = 4;
  Object.assign(questions[0], { revision: 4, type: "single_choice", options: questions[2].options });
  console.log("PASS mismatched catalogue/detail revisions block answering until metadata is refreshed");

  // The workspace generation also rejects content arriving after an exam switch.
  await page.reload(); await ready(); deferred.add("q1"); await invoke("begin", ["q1"]); await waitFor(() => pending.length === 1);
  page.once("dialog", dialog => dialog.accept()); await invoke("setExamId", "other"); await ready();
  await invoke("begin", ["other"]); await page.getByText("Other exam component", { exact: true }).waitFor();
  deferred.delete("q1"); await release(0);
  assert.equal((await state()).examId, "other"); assert.equal((await state()).catalogBy.q1, undefined);
  console.log("PASS switching exams during loading cannot reinsert the old question");

  page.once("dialog", dialog => dialog.accept()); await invoke("setExamId", "exam"); await ready();
  const beforeLearning = detailCalls().length;
  await invoke("go", "learning"); await invoke("beginLearning", 1);
  await page.getByText("Refreshed component question", { exact: true }).waitFor();
  assert.equal(detailCalls().length, beforeLearning, "Learning hydrates from its existing detail endpoint");
  assert.equal((await state()).lDetail.q1.status, "ready");
  assert.ok((await state()).catalogBy.q1.content.assets.length);
  console.log("PASS Learning uses its existing answer/history fetch to hydrate full component content");

  // A failed current question must not hide the mock timer/palette or prevent
  // submission of answers already saved to other questions.
  await page.reload(); await ready(); failures.add("q1");
  await invoke("go", "mock"); await invoke("beginMock");
  await page.waitForFunction(() => window.store.state.mStage === "live");
  await page.evaluate(() => window.store.mockGoto(window.store.state.mQueue.indexOf("q1")));
  await page.getByRole("button", { name: "Retry question", exact: true }).waitFor();
  assert.equal(await page.getByRole("complementary", { name: "Question palette", exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Submit exam", exact: true }).isVisible(), true);
  const left = (await state()).mLeft;
  await page.waitForFunction(previous => window.store.state.mLeft < previous, left);
  await choose("mockPick", "q1", "A"); assert.equal((await state()).mSel.q1, undefined);
  await page.evaluate(() => window.store.mockGoto(window.store.state.mQueue.indexOf("legacy")));
  await choose("mockPick", "legacy", "B");
  await page.evaluate(() => window.store.mockGoto(window.store.state.mQueue.indexOf("q1")));
  await page.getByRole("button", { name: "Retry question", exact: true }).waitFor();
  await invoke("finishMock"); await page.waitForFunction(() => window.store.state.mStage === "results");
  assert.deepEqual((await state()).mockResult.breakdown.find(row => row.questionId === "legacy").selectedAnswer, ["B"]);
  assert.deepEqual((await state()).mockResult.breakdown.find(row => row.questionId === "q1").selectedAnswer, []);
  console.log("PASS Mock keeps timer/palette/navigation available and submits saved answers during content failure");
  assert.deepEqual(errors, []);
} finally {
  for (const request of pending) request.reply();
  await browser?.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
