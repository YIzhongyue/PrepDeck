// Real editor and Learning presentation, synthetic questions, loopback API only.
// The editor deliberately has no study provider: any accidental study hook fails.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody } from "./browser-fixture.mjs";
import { validateQuestionRow } from "../../../packages/shared/src/import-validate.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const types = ["single_choice", "multiple_choice", "true_false", "fill_blank"];
const explanation = "## Reasoning\n\nUse **the stated rule**, with `literal code`.\n\n- First reason\n- Second reason\n\n```text\nvalue = 2\n```\n\n" + "Additional synthetic reasoning.\n\n".repeat(12) + "Explanation end.";
const makeQuestion = type => ({ id: "draft-fixture", examId: "exam", sequenceNumber: 1, revision: 1, type,
  stem: "# Synthetic draft\n\nWhich **answer** follows the rule?\n\n```text\nvalue = 2\n```",
  options: type === "fill_blank" ? null : (type === "true_false" ? ["true", "false"] : ["A", "B", "C"]).map(id => ({ id, text: `**Choice ${id}** with code: \`value\`` })),
  correctAnswers: type === "fill_blank" ? ["two", "2"] : type === "true_false" ? ["true"] : type === "multiple_choice" ? ["A", "C"] : ["A"],
  explanation, externalId: "SYNTHETIC-148", difficulty: "easy", points: 1, tags: [], needsReview: false });
const questions = Object.fromEntries(types.map(type => [type, makeQuestion(type)]));
const calls = [], errors = [];
let saved;

// Expose the real context in this test bundle only. Learning uses a frozen
// snapshot and action spies for reference; the editor is outside this context.
const { outputFiles } = await build({ stdin: { contents: `
  import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
  import QuestionEditorDialog from './src/components/QuestionEditorDialog';
  import LearningLive from './src/screens/LearningLive';
  import {__TestStudyContext} from './src/store/PrepDeckContext';
  import './src/styles/tokens.css'; import './src/styles/app.css';
  const questions = ${JSON.stringify(questions)};
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  window.studyActions = [];
  const action = name => (...args) => window.studyActions.push({name, args});
  function Reference() {
    const [q, setQ] = useState(questions.single_choice);
    window.showLearning = setQ; window.learningQuestion = q;
    const state = freeze({lQueue:[q.id], lIdx:0, lVisit:1, lDetail:{[q.id]:{status:'ready', correctAnswers:q.correctAnswers, explanation:q.explanation, history:[]}},
      notes:[], anns:[], ai:{[q.id]:{status:'idle'}}, provider:'openai', model:'fixture', studyStatus:{}, bookmarks:{}});
    const store = {state, width:1440, learningQ:()=>q, markLearningViewed:action('markLearningViewed'), prefetchQuestions:action('prefetchQuestions')};
    return <__TestStudyContext.Provider value={store}><LearningLive bp={{phone:false, narrow:false, rail:true, landscapePhone:false}}/></__TestStudyContext.Provider>;
  }
  function Editor() {
    const [question, setQuestion] = useState(() => freeze(questions[new URLSearchParams(location.search).get('type') || 'single_choice']));
    const [open, setOpen] = useState(false); window.savedQuestion = question;
    return <><button onClick={()=>setOpen(true)}>Open editor</button>{open && <QuestionEditorDialog examId="exam" question={question} initialType="single_choice"
      onClose={()=>setOpen(false)} onSaved={q=>{setQuestion(freeze(q)); setOpen(false);}}/>}</>;
  }
  createRoot(document.getElementById('root')).render(location.pathname === '/learning' ? <Reference/> : <Editor/>);
`, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  plugins: [{ name: "reference-context", setup(api) {
    api.onLoad({ filter: /[\\/]PrepDeckContext\.tsx$/ }, args => ({ loader: "tsx", contents: readFileSync(args.path, "utf8") + "\nexport const __TestStudyContext = PrepDeckCtx;" }));
  } }], bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname.startsWith("/api/")) {
    const { payload } = await readBody(req);
    calls.push({ method: req.method, path: url.pathname, payload });
    if (req.method === "GET" && url.pathname === "/api/admin/question-tags") return json(200, { tags: [] });
    if (req.method === "PATCH" && url.pathname === "/api/exams/exam/questions/draft-fixture") {
      const issues = validateQuestionRow(payload, "$");
      if (issues.length) return json(422, { issues });
      saved = { ...makeQuestion(payload.type), ...payload, revision: payload.expectedRevision + 1 };
      return json(200, { question: saved });
    }
    return json(500, { error: "Unexpected preview side effect" });
  }
  if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
    res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(file => file.path.endsWith(url.pathname.slice(1))).contents);
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  console.log(`Draft preview browser: Chromium ${browser.version()}`);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext();
  await context.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const reference = await context.newPage();
  await reference.setViewportSize({ width: 1440, height: 1000 });
  reference.on("pageerror", error => errors.push(error.message));
  await reference.goto(`${origin}/learning`);
  const parity = async (preview, q) => {
    const learningQuestion = { ...q, chooseCount: q.correctAnswers.length };
    await reference.evaluate(q => window.showLearning(q), learningQuestion);
    await reference.waitForFunction(q => JSON.stringify(window.learningQuestion) === JSON.stringify(q), learningQuestion);
    for (const selector of [".st-stem", q.type === "fill_blank" ? ".st-answer-box" : ".st-opt-group", ".st-official"]) {
      assert.equal(await preview.locator(selector).innerHTML(), await reference.locator(selector).innerHTML(), `${q.type}: ${selector} matches actual Learning markup`);
    }
    // Compare computed presentation too; inherited study theme variables must exist.
    const styles = locator => locator.evaluate(async el => {
      await Promise.all(el.getAnimations().map(animation => animation.finished));
      const s = getComputedStyle(el);
      return [s.color, s.backgroundColor, s.boxShadow, s.borderRadius, s.fontSize, s.lineHeight];
    });
    const selector = q.type === "fill_blank" ? ".st-answer-box" : '.st-opt[data-state="correct"]';
    assert.deepEqual(await styles(preview.locator(selector).first()), await styles(reference.locator(selector).first()));
  };
  for (const width of [390, 1440]) for (const type of types) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 1000 });
    page.setDefaultTimeout(10000);
    page.on("pageerror", error => errors.push(error.message));
    let confirms = 0;
    page.on("dialog", async dialog => { confirms++; await dialog.dismiss(); });
    await page.goto(`${origin}/?type=${type}`);
    await page.evaluate(() => localStorage.setItem('preview-study-sentinel', '{"studied":false,"answers":["unchanged"]}'));
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    const start = calls.length;
    const preview = page.locator("#question-preview");
    const show = async () => { if (width < 1100) await page.getByRole("button", { name: "Preview", exact: true }).click(); };
    const edit = async () => { if (width < 1100) await page.getByRole("button", { name: "Edit", exact: true }).click(); };
    const open = async () => {
      await page.getByRole("button", { name: "Open editor" }).click();
      await page.locator(".question-drawer").evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)); });
    };
    await open();
    if (width < 1100) assert.equal(await preview.locator("*").count(), 0, "Still lazy before first activation");
    await show();
    await parity(preview, questions[type]);
    assert.equal(await preview.locator('button, input, textarea, [role="radio"], [role="checkbox"], [aria-checked]').count(), 0, "Preview has no answering or AI controls");
    assert.equal(await preview.locator(".st-collapse-body").evaluate(el => el.style.maxHeight), "", "Official explanation is fully expanded by default");
    await preview.getByText("Explanation end.", { exact: true }).waitFor();
    if (type !== "fill_blank") {
      const list = preview.getByRole("list", { name: "Answer options", exact: true });
      assert.equal(await list.getByRole("listitem").count(), questions[type].options.length);
      assert.equal(await list.getByText("Correct answer", { exact: true }).count(), questions[type].correctAnswers.length);
      await list.getByRole("listitem").last().click();
      assert.equal(await list.locator("[tabindex]").count(), 0);
    }
    await preview.focus(); await page.keyboard.press("1"); await page.keyboard.press("Enter"); await page.keyboard.press("Space");
    await edit(); await show();
    assert.deepEqual(await page.evaluate(() => window.savedQuestion), questions[type], "Rendering and clicking leave the frozen source question unchanged");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(confirms, 0, "Opening and switching preview does not introduce dirty state");
    assert.ok(calls.slice(start).every(call => call.method === "GET" && call.path === "/api/admin/question-tags"), "Preview has no API side effects");
    assert.deepEqual(await page.evaluate(() => window.studyActions), []);
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), storage);

    await open();
    const draft = structuredClone(questions[type]);
    draft.stem = "# Unsaved stem\n\nA **draft** with `code`.";
    draft.explanation = "## Unsaved reasoning\n\n" + explanation;
    await page.getByLabel("Stem · Markdown", { exact: true }).fill(draft.stem);
    await page.getByLabel("Official explanation · Markdown", { exact: true }).fill(draft.explanation);
    if (type === "fill_blank") {
      draft.correctAnswers = ["literal **answer**", "答案", "  spaced  "];
      await page.getByLabel("Accepted answers (one per line)").fill(draft.correctAnswers.join("\n\n") + "\n");
    } else {
      const last = draft.options.at(-1);
      last.text = "**Unsaved option** with `new code`.";
      await page.getByLabel(`Option ${last.id} · Markdown`, { exact: true }).fill(last.text);
      if (type === "multiple_choice") {
        await page.getByLabel("Correct answer A", { exact: true }).uncheck();
        await page.getByLabel("Correct answer B", { exact: true }).check();
        draft.correctAnswers = ["C", "B"];
      } else {
        await page.getByLabel(`Correct answer ${last.id}`, { exact: true }).check();
        draft.correctAnswers = [last.id];
      }
    }
    await show(); await parity(preview, draft);
    assert.deepEqual(await page.evaluate(() => window.savedQuestion), questions[type], "Unsaved changes stay in the draft");
    assert.equal(await page.locator(".question-drawer").evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await preview.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.ok(calls.slice(start).every(call => call.method === "GET"), "Typing and previewing never save");
    if (process.env.SCREENSHOT_DIR && type === "multiple_choice") {
      mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      await preview.evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/learning-card-preview-${width}.png` });
    }
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(saved.stem, draft.stem); assert.equal(saved.explanation, draft.explanation);
    assert.deepEqual(saved.correctAnswers, draft.correctAnswers, "Save preserves the exact answer order and fill-in whitespace");
    assert.deepEqual(saved.options ?? null, draft.options);
    assert.equal(calls.slice(start).filter(call => call.method !== "GET").length, 1, "Only explicit Save writes");
    assert.deepEqual(await page.evaluate(() => window.studyActions), []);
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), storage);
    await open(); await show(); await parity(preview, draft);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(confirms, 0, "Saved draft reopens clean");
    // Incomplete drafts keep their useful context; no invented correct answer.
    await open();
    await page.getByLabel("Type", { exact: true }).selectOption(type === "fill_blank" ? "single_choice" : "fill_blank");
    await page.getByLabel("Stem · Markdown", { exact: true }).fill("");
    await page.getByLabel("Official explanation · Markdown", { exact: true }).fill("");
    await show();
    await preview.getByText(/Not selected/).waitFor();
    assert.equal(await preview.locator('[data-state="correct"], .st-official').count(), 0);
    assert.equal(await preview.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.close({ runBeforeUnload: false });
    console.log(`PASS ${type} at ${width}px: Learning markup/styles, unsaved draft, answers, official explanation, clean dismissal, save/reopen, incomplete draft and state isolation`);
  }
  assert.deepEqual(errors, []);
  assert.ok(calls.every(call => call.path === "/api/admin/question-tags" || call.method === "PATCH" && call.path === "/api/exams/exam/questions/draft-fixture"));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
