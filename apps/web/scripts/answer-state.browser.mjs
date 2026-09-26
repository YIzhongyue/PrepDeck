// Exercise real screens and the provider against a persistent, isolated API.
// In particular, reloading must not change wrong-book membership or counts.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { normalizeImportFile } from "../../../packages/shared/src/question-components.ts";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import {Shell} from './src/App';
function Probe(){window.store=usePrepDeck();return null;}
createRoot(document.getElementById('root')).render(<PrepDeckProvider><Probe/><Shell/></PrepDeckProvider>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false,
  outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const questions = ["single_choice", "multiple_choice", "fill_blank"].map((type, index) => ({
  id: `q${index + 1}`, examId: "exam", externalId: `Q${index + 1}`, sequenceNumber: index + 1,
  type, chooseCount: type === "multiple_choice" ? 2 : 1, stem: `Fixture ${type}`, tags: [], difficulty: "easy", points: 1,
  options: type === "fill_blank" ? null : [{ id: "A", text: "Option A" }, { id: "B", text: "Option B" }],
}));
const attempts = new Map(), wrong = new Map(), calls = [], errors = [];
let serial = 0, expired = false, failDraft = false;
const selected = answer => answer?.some(value => value.trim()) ? answer : [];
function grade(qid, answer) { return qid === "q3" ? answer.some(value => value.trim() === "green") : answer.join() === "A"; }
function recordWrong(qid) {
  const previous = wrong.get(qid);
  wrong.set(qid, { questionId: qid, wrongCount: (previous?.wrongCount ?? 0) + 1, lastWrongAt: new Date().toISOString(), mastered: false });
}
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
  if (url.pathname === "/api/exams") return json({ exams: [{ id: "exam", name: "Answer state", slug: "exam", providers: [], questionCount: 3 }, { id: "other", name: "Other exam", slug: "other", providers: [], questionCount: 0 }] });
  if (url.pathname === "/api/exams/other/practice-catalog") return json({ questions: [], bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  if (url.pathname.endsWith("/practice-catalog")) return json({ questions, bookmarkedIds: [], wrongEntries: [...wrong.values()].filter(row => !row.mastered), attemptedIds: [] });
  if (url.pathname === "/api/settings") return json({ showSharedNotes: true });
  if (url.pathname === "/api/annotation-settings") return json({ hl1Alias: "First", hl2Alias: "Second", hl3Alias: "Third" });
  if (url.pathname === "/api/annotations") return json({ annotations: [] });
  if (url.pathname === "/api/notes") return json({ notes: [] });
  if (url.pathname.endsWith("/learning/progress")) return json({ progress: { lastSequenceNumber: 1 } });
  if (url.pathname.endsWith("/learning-detail")) return json({ question: { correctAnswers: ["green"], explanation: "Explanation", answerRevision: 1 }, history: [] });
  if (url.pathname.endsWith("/ai-explanations")) return json({ explanations: [] });
  if (url.pathname.endsWith("/knowledge-points")) return json({ knowledgePoints: [], total: 0 });
  if (url.pathname.endsWith("/wrong-book/mastered")) { wrong.get(url.pathname.split("/")[3]).mastered = true; return json({ mastered: true }); }
  if (url.pathname === "/api/attempts/active") return json({ attempt: [...attempts.values()].find(attempt => attempt.mode === "mock" && !attempt.completed) ?? null });
  if (url.pathname === "/api/exams/exam/attempts") {
    const attempt = { ...payload, examId: "exam", attemptId: `attempt-${++serial}`, selectedAnswers: {}, flagged: {}, startedAt: new Date().toISOString() };
    attempts.set(attempt.attemptId, attempt); return json(attempt, 201);
  }
  if (url.pathname.startsWith("/api/attempts/")) {
    const [, , , id, action, qid] = url.pathname.split("/"); const attempt = attempts.get(id);
    if (action === "answers" && req.method === "PUT") {
      if (failDraft) return json({ error: "Draft unavailable" }, 503);
      if (attempt.completed) return json({ completed: true, error: "Attempt already completed" }, 409);
      if (expired) return json({ expired: true, error: "This mock exam has expired." }, 409);
      attempt.selectedAnswers[qid] = selected(payload.selectedAnswer); return json({ saved: true });
    }
    if (action === "flags") {
      if (attempt.completed) return json({ completed: true, error: "Attempt already completed" }, 409);
      attempt.flagged[qid] = payload.flagged; return json({ saved: true });
    }
    if (action === "answers") {
      const isCorrect = grade(payload.questionId, payload.selectedAnswer);
      if (!isCorrect) recordWrong(payload.questionId);
      return json({ isCorrect, correctAnswers: ["green"], explanation: "Explanation", answerRevision: 1 });
    }
    if (action === "complete") {
      const breakdown = attempt.questionIds.map(questionId => {
        const answer = selected(attempt.selectedAnswers[questionId] ?? []), isCorrect = grade(questionId, answer);
        if (!attempt.completed && !isCorrect && answer.length) recordWrong(questionId);
        return { questionId, selectedAnswer: answer, isCorrect, correctAnswers: questionId === "q3" ? ["green"] : ["A"], gradedAnswers: [], answerRevision: 1, currentAnswerRevision: 1 };
      });
      attempt.completed = true;
      return json({ attemptId: id, mode: attempt.mode, score: 0, passed: false, correctCount: 0, totalQuestions: 3, durationSeconds: 1, breakdown });
    }
  }
  return json({ error: "Optional fixture route" }, 503);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => window.store?.state.workspaceStatus === "ready");
  const state = () => page.evaluate(() => window.store.state);
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.store[method](...args), { method, args });
  const pick = (id, answer) => page.evaluate(({ id, answer }) => window.store.mockPick(window.store.state.catalogBy[id], answer), { id, answer });
  const show = id => page.evaluate(id => window.store.mockGoto(window.store.state.mQueue.indexOf(id)), id);
  const startMock = async () => { await invoke("go", "mock"); await invoke("beginMock"); await page.waitForFunction(() => window.store.state.mStage === "live"); };
  const complete = async () => { await invoke("finishMock"); await page.waitForFunction(() => window.store.state.mStage === "results"); };
  const checkWrong = async expected => {
    await invoke("go", "wrong");
    await page.getByRole("button", { name: `Practice these ${expected.length}`, exact: true }).waitFor();
    assert.deepEqual(await page.locator(".card .tag-neutral").allTextContents(), expected.map(id => id.toUpperCase()));
    assert.equal(await page.getByText(/Invalid Date/).count(), 0);
    for (const id of expected) assert.ok(Number.isFinite(Date.parse((await state()).wrong[id].at)));
  };
  await page.goto(`http://127.0.0.1:${server.address().port}`); await ready();
  await startMock();
  await pick("q1", "B"); await pick("q2", "A"); await pick("q2", "A");
  await show("q3"); await page.getByText("Fill in the blank", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Your answer" }).fill("green");
  await page.getByRole("textbox", { name: "Your answer" }).fill("   ");
  await page.getByText("Answered 1 of 3", { exact: true }).waitFor();
  assert.equal(await page.getByRole("complementary", { name: "Question palette" }).locator('button[data-state="answered"]').count(), 1);
  await invoke("askSubmit"); await page.getByText(/You have answered 1 of 3/).waitFor(); await invoke("cancelSubmit");
  const firstId = (await state()).mockAttemptId;
  await invoke("go", "wrong"); // drains the actual draft queue before leaving
  assert.deepEqual(attempts.get(firstId).selectedAnswers.q2, []);
  assert.deepEqual(attempts.get(firstId).selectedAnswers.q3, []);
  attempts.get(firstId).selectedAnswers.q3 = ["   "]; // legacy restored draft
  await page.reload(); await ready(); await startMock();
  await page.getByText("Answered 1 of 3", { exact: true }).waitFor();
  assert.equal(await page.getByRole("complementary", { name: "Question palette" }).locator('button[data-state="answered"]').count(), 1);
  await complete(); await checkWrong(["q1"]);
  await page.reload(); await ready(); await checkWrong(["q1"]);
  console.log("PASS deselection, blank fill, restored drafts and partial submission agree across UI and reload");

  await invoke("markMastered", "q1"); await page.getByRole("button", { name: "Practice these 0", exact: true }).waitFor();
  await startMock(); await complete(); await checkWrong([]);
  assert.equal((await state()).mastered.q1, true, "Skipping a mastered question preserves mastery");
  await page.reload(); await ready(); await checkWrong([]);
  await startMock(); await pick("q3", "red"); await complete(); await checkWrong(["q3"]);
  await page.reload(); await ready(); await checkWrong(["q3"]);
  await page.getByRole("button", { name: "Practice these 1", exact: true }).click();
  await page.waitForFunction(() => window.store.state.pStage === "live");
  assert.deepEqual((await state()).queue, ["q3"]);
  await page.getByText("Fill in the blank", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Your answer" }).fill("   ");
  assert.equal(await page.getByRole("button", { name: "Check answer", exact: true }).isDisabled(), true);
  await invoke("submit"); assert.equal((await state()).done.q3, undefined);
  const answerWrites = () => calls.filter(call => call.method === "POST" && call.path.endsWith("/answers")).length;
  const beforeBlankSwitch = answerWrites();
  page.once("dialog", dialog => dialog.accept());
  await invoke("setExamId", "other");
  assert.equal(answerWrites(), beforeBlankSwitch, "Switching study context does not submit a blank practice answer");
  await invoke("setExamId", "exam"); await ready(); await checkWrong(["q3"]);
  await page.getByRole("button", { name: "Practice these 1", exact: true }).click();
  await page.waitForFunction(() => window.store.state.pStage === "live");
  await page.getByRole("textbox", { name: "Your answer" }).fill("red");
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.waitForFunction(() => window.store.state.done.q3 === "no");
  await checkWrong(["q3"]); assert.equal((await state()).wrong.q3.c, 2);
  await invoke("goToQuestionForReview", "exam", "q3");
  await page.getByText("Fill in the blank", { exact: true }).waitFor();
  console.log("PASS skipped/mastered wrong-book membership, valid dates and question labels in all study modes");

  await invoke("endSession");
  await startMock(); await pick("q1", "B"); await invoke("go", "wrong"); await invoke("go", "mock");
  expired = true; await pick("q1", "A");
  await page.waitForFunction(() => window.store.state.actionError?.startsWith("Time is up."));
  const beforeSubmit = calls.filter(call => call.method === "PUT").length;
  await page.waitForFunction(() => window.store.state.mStage === "results");
  assert.deepEqual((await state()).mockResult.breakdown.find(row => row.questionId === "q1").selectedAnswer, ["B"]);
  assert.equal(calls.filter(call => call.method === "PUT").length, beforeSubmit, "Expired writes are not retried");
  expired = false; await startMock(); failDraft = true; await pick("q1", "A");
  await page.waitForFunction(() => window.store.state.actionError?.includes("not saved yet"));
  failDraft = false; expired = true; await complete();
  assert.deepEqual((await state()).mockResult.breakdown.find(row => row.questionId === "q1").selectedAnswer, []);
  console.log("PASS expired writes and retries cannot block submission of the server's saved answers");

  // Custom mock fields keep what is typed and validate it instead of clamping
  // every keystroke (issue #55): 120 used to become 300 and 45 became 55.
  expired = false;
  await invoke("go", "mock", { newMock: true });
  const countField = page.getByRole("spinbutton", { name: "Questions", exact: true });
  const minutesField = page.getByRole("spinbutton", { name: "Time limit (minutes)", exact: true });
  const beginExam = page.getByRole("button", { name: "Begin exam", exact: true });
  const retype = async (field, text) => {
    await field.click(); await field.press("Control+a");
    if (text) await page.keyboard.type(text); else await page.keyboard.press("Backspace");
  };
  await retype(minutesField, "120"); assert.equal(await minutesField.inputValue(), "120");
  await retype(minutesField, "45"); assert.equal(await minutesField.inputValue(), "45");
  await retype(minutesField, ""); assert.equal(await minutesField.inputValue(), "", "the field can be empty while editing");
  await page.getByText("Enter a whole number of minutes from 5 to 300.", { exact: true }).waitFor();
  assert.equal(await beginExam.isDisabled(), true, "an empty time limit cannot start an exam");
  await retype(minutesField, "400"); assert.equal(await beginExam.isDisabled(), true);
  assert.equal(await page.locator(".st-big-pair-v").nth(1).textContent(), "—", "the summary does not show the 40 typed on the way to 400");
  assert.equal(await minutesField.getAttribute("aria-invalid"), "true");
  await retype(countField, "4");
  await page.getByText("Enter a whole number from 1 to 3.", { exact: true }).waitFor();
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/mock-custom-fields-invalid.png`, animations: "disabled" });
  await retype(countField, "2"); await retype(minutesField, "45");
  assert.equal(await beginExam.isDisabled(), false);
  assert.equal(await page.getByText(/Enter a whole number/).count(), 0);
  await beginExam.click();
  await page.waitForFunction(() => window.store.state.mStage === "live");
  const customAttempt = attempts.get((await state()).mockAttemptId);
  assert.equal(customAttempt.timeLimitSeconds, 45 * 60);
  assert.equal(customAttempt.questionIds.length, 2);
  await complete();
  // The following blocks draw all three questions again.
  await invoke("go", "mock", { newMock: true }); await retype(countField, "3");
  await page.waitForFunction(() => window.store.state.mockCount === 3);
  console.log("PASS custom mock fields accept typed values, flag empty or out-of-range ones and start with what was typed");

  // Submitted from another tab or device: a write to it leads to its result, and
  // a draft this tab never managed to save cannot block the Submit button.
  expired = false;
  await startMock(); await pick("q1", "B");
  attempts.get((await state()).mockAttemptId).completed = true;
  await pick("q1", "A");
  await page.waitForFunction(() => window.store.state.mStage === "results");
  assert.match((await state()).actionError, /another tab or device/);
  assert.deepEqual((await state()).mockResult.breakdown.find(row => row.questionId === "q1").selectedAnswer, ["B"], "The result is the one graded elsewhere");
  await invoke("dismissActionError");
  await startMock(); failDraft = true; await pick("q1", "A");
  await page.waitForFunction(() => window.store.state.actionError?.includes("not saved yet"));
  failDraft = false; attempts.get((await state()).mockAttemptId).completed = true;
  await invoke("askSubmit"); await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.waitForFunction(() => window.store.state.mStage === "results");
  assert.deepEqual((await state()).mockResult.breakdown.find(row => row.questionId === "q1").selectedAnswer, []);
  await invoke("dismissActionError");
  console.log("PASS an attempt submitted elsewhere shows its result instead of blocking Submit");
  // Exercise component rendering and actual provider draft persistence in Mock.
  const componentRows = ["code", "case-with-figure", "combination"].flatMap(name => normalizeImportFile(JSON.parse(readFileSync(new URL(`../../../tests/fixtures/components/${name}.json`, import.meta.url), "utf8"))).questions);
  questions.splice(0, questions.length, ...componentRows.map((row, n) => ({ ...row, correctAnswers: undefined, id: `component-${n}`, examId: "exam", sequenceNumber: n + 1, chooseCount: 1, tags: [] })));
  await page.reload(); await ready(); await startMock();
  await show("component-0");
  await page.locator("pre code").filter({ hasText: "values = [1, 2, 3]" }).waitFor();
  await page.getByRole("combobox", { name: "Position 1", exact: true }).selectOption("read");
  await page.getByRole("combobox", { name: "Position 2", exact: true }).selectOption("sum");
  await page.getByRole("combobox", { name: "Position 3", exact: true }).selectOption("print");
  await show("component-1");
  await page.getByRole("img", { name: "After is twice as high as Before." }).waitFor();
  assert.equal(await page.getByRole("img", { name: "After is twice as high as Before." }).evaluate(img => img.complete && img.naturalWidth > 0), true);
  await page.getByRole("combobox", { name: "Match low", exact: true }).selectOption("before");
  await page.getByRole("combobox", { name: "Match high", exact: true }).selectOption("after");
  await invoke("go", "mock"); // drains outstanding drafts
  await page.reload(); await ready(); await startMock();
  await show("component-0");
  assert.equal(await page.getByRole("combobox", { name: "Position 1", exact: true }).inputValue(), "read");
  assert.equal(await page.getByRole("combobox", { name: "Position 3", exact: true }).inputValue(), "print");
  await show("component-1");
  assert.equal(await page.getByRole("combobox", { name: "Match high", exact: true }).inputValue(), "after");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= 390);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/component-figure-match-mobile.png`, animations: "disabled", fullPage: false });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, "Component screen overflows the mobile viewport");
  await show("component-2"); await page.getByRole("table").waitFor();
  assert.ok((await page.locator(".component-content").allTextContents()).some(text => text.includes("Isolate")));
  await page.setViewportSize({ width: 1280, height: 900 });
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/component-combination-desktop.png`, fullPage: true });
  await invoke("begin", ["component-0"]);
  await page.waitForFunction(() => window.store.state.pStage === "live");
  await page.getByRole("combobox", { name: "Position 1", exact: true }).selectOption("read");
  await page.getByRole("combobox", { name: "Position 2", exact: true }).selectOption("sum");
  await page.getByRole("combobox", { name: "Position 3", exact: true }).selectOption("print");
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("1");
  assert.deepEqual((await state()).sel["component-0"], ["read", "sum", "print"], "Choice shortcuts must not replace a structured response");
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.waitForFunction(() => !!window.store.state.done["component-0"]);
  assert.equal(await page.getByRole("combobox", { name: "Position 1", exact: true }).isDisabled(), true);
  console.log("PASS component figures/tables/code, order/match controls, restored drafts, practice grading state, keyboard isolation and mobile layout");
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
