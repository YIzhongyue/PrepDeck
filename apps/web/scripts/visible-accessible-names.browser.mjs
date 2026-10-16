// Issue #129: real controls, synthetic local data, and browser-computed names.
// Keep the full application axe scan separate and unchanged.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { outputFiles } = await build({ stdin: { contents: [
  "import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';",
  "import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext';",
  "import {ChoiceCard,DifficultyPicker,DomainPicker} from './src/components/study/SetupKit';",
  "import {CopyPromptButton,IC} from './src/components/study/StudyKit';",
  "import TagFilterBar from './src/components/TagFilterBar'; import ExamSelector from './src/components/ExamSelector';",
  "import './src/styles/tokens.css'; import './src/styles/app.css';",
  "const questions=[{tags:['Security','Storage']},{tags:['Security']}];",
  "function CopyFixture({compact}) { const [status,setStatus]=useState('idle');",
  "  return <section aria-label={compact?'Compact copy':'Desktop copy'}><CopyPromptButton compact={compact} status={status}",
  "    onClick={async()=>{try{await navigator.clipboard.writeText('Synthetic question and answers');setStatus('copied');}catch{setStatus('error');}}}/></section>; }",
  "function Fixture(){const app=usePrepDeck();window.fixtureApp=app;",
  "  const [choice,setChoice]=useState('all'),[difficulty,setDifficulty]=useState('all'),[domains,setDomains]=useState([]),[tags,setTags]=useState([]);",
  "  const toggle=(set,name)=>set(values=>values.includes(name)?values.filter(value=>value!==name):[...values,name]);",
  "  return <main className='pd-study' data-pd-theme='light' style={{padding:16}}><h1>Accessible name fixtures</h1>",
  "    <section aria-label='Choices' className='st-cards'>",
  "      <ChoiceCard icon={IC.library} label='All questions' count={2} desc='The full bank for this exam' on={choice==='all'} onSelect={()=>setChoice('all')}/>",
  "      <ChoiceCard icon={IC.bookmark} label='Bookmarked' count={0} desc='Questions you saved for later' on={choice==='bookmarked'} onSelect={()=>setChoice('bookmarked')}/>",
  "      <ChoiceCard icon={IC.eyeOff} label='Skip' desc='Leave them out of this session' on={choice==='skip'} onSelect={()=>setChoice('skip')}/>",
  "    </section>",
  "    <DifficultyPicker value={difficulty} counts={{all:3,easy:1,medium:2,hard:0}} onChange={setDifficulty}/>",
  "    <section aria-label='Setup domains'><DomainPicker questions={questions} selected={domains} onToggle={name=>toggle(setDomains,name)} phone={false}/></section>",
  "    <TagFilterBar questions={questions} selected={tags} onToggle={name=>toggle(setTags,name)} onClear={()=>setTags([])} resultCount={2}/>",
  "    <CopyFixture/><CopyFixture compact/>",
  "    <section aria-label='Expanded exam selector'><ExamSelector/></section>",
  "    <section aria-label='Compact exam selector'><ExamSelector compact/></section>",
  "  </main>;}",
  "createRoot(document.getElementById('root')).render(<PrepDeckProvider><Fixture/></PrepDeckProvider>);",
].join("\n"), loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });

let exams = [
  { id: "one", slug: "cloud-one", name: "Cloud Architecture Fundamentals", providers: [], questionCount: 0 },
  { id: "two", slug: "security-two", name: "Security Engineering Professional", providers: [], questionCount: 0 },
];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://fixture").pathname;
  const json = data => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
  if (path === "/api/auth/me") return json({ user: { id: "qa", email: "qa@example.test", role: "user", displayName: "QA" } });
  if (path === "/api/exams") return json({ exams });
  if (path.endsWith("/practice-catalog")) {
    return json({ questions: [], bookmarkedIds: [], wrongEntries: [], attemptedIds: [], archivedQuestions: [] });
  }
  if (path === "/api/attempts/active") return json({ attempt: null });
  if (path.endsWith("/learning/progress")) return json({ progress: { lastSequenceNumber: null } });
  if (path.endsWith("/study-status")) return json({ statuses: [] });
  if (path === "/api/settings") return json({ showSharedNotes: true });
  if (path === "/api/annotation-settings") return json({ hl1Alias: "First", hl2Alias: "Second", hl3Alias: "Third" });
  if (path === "/api/annotations") return json({ annotations: [] });
  if (path === "/api/notes") return json({ notes: [] });
  if (path.startsWith("/api/")) return json({});
  if (path === "/fixture.js" || path === "/fixture.css") {
    res.setHeader("Content-Type", path.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(file => file.path.endsWith(path.slice(1))).contents);
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForFunction(() => window.fixtureApp.state.workspaceStatus === "ready");
  const button = (scope, name) => scope.getByRole("button", { name, exact: true });
  const pressed = async (control, value) => assert.equal(await control.getAttribute("aria-pressed"), String(value));
  const focused = async control => assert.equal(await control.evaluate(el => el === document.activeElement), true);

  // Exact names include visible counts and descriptions, once and in order.
  const choices = page.getByRole("region", { name: "Choices", exact: true });
  const all = button(choices, "All questions 2 The full bank for this exam");
  const bookmarked = button(choices, "Bookmarked 0 Questions you saved for later");
  const skip = button(choices, "Skip Leave them out of this session");
  await pressed(all, true); await pressed(bookmarked, false);
  assert.equal(await all.getAttribute("aria-describedby"), null, "The description is not announced twice");
  await all.focus(); await page.keyboard.press("Tab"); await focused(bookmarked);
  await page.keyboard.press("Space"); await pressed(bookmarked, true); await pressed(all, false);
  await page.keyboard.press("Tab"); await focused(skip);
  await page.keyboard.press("Enter"); await pressed(skip, true); await pressed(bookmarked, false);
  await all.click(); await pressed(all, true);
  const difficulty = page.getByRole("group", { name: "Difficulty", exact: true });
  for (const name of ["Any 3 questions", "Easy 1 question", "Medium 2 questions", "Hard 0 questions"]) {
    assert.equal(await button(difficulty, name).count(), 1);
  }
  await button(difficulty, "Easy 1 question").press("Space");
  await pressed(button(difficulty, "Easy 1 question"), true);
  await button(difficulty, "Hard 0 questions").press("Enter");
  await pressed(button(difficulty, "Hard 0 questions"), true);
  await pressed(button(difficulty, "Easy 1 question"), false);
  for (const scope of [
    page.getByRole("region", { name: "Setup domains", exact: true }),
    page.getByRole("region", { name: "Filter by tag", exact: true }),
  ]) {
    const one = button(scope, "Storage 1 question"), many = button(scope, "Security 2 questions");
    await pressed(one, false); await pressed(many, false);
    await one.press("Space"); await pressed(one, true); await focused(one);
    await many.press("Enter"); await pressed(many, true);
    await one.click(); await pressed(one, false); await pressed(many, true);
  }

  // The text layout follows each visible outcome; the compact action remains
  // named and icon-only, with the same existing live feedback and click handler.
  for (const [compact, width] of [[false, 1280], [true, 375]]) {
    await page.setViewportSize({ width, height: 900 });
    const scope = page.getByRole("region", { name: compact ? "Compact copy" : "Desktop copy", exact: true });
    let name = "Copy as prompt";
    await button(scope, name).waitFor();
    assert.equal(await button(scope, name).getAttribute("title"), "Copy question and answers as a Markdown prompt");
    for (const [succeed, nextName, announcement] of [
      [true, "Copied", "Markdown prompt copied to clipboard."],
      [false, "Copy failed", "Could not copy the Markdown prompt."],
      [true, "Copied", "Markdown prompt copied to clipboard."],
    ]) {
      await page.evaluate(succeed => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: text => { window.copiedText = text; return succeed ? Promise.resolve() : Promise.reject(new Error("Synthetic clipboard denial")); },
      } }), succeed);
      await button(scope, name).press("Enter");
      name = compact ? "Copy as prompt" : nextName;
      await button(scope, name).waitFor();
      await scope.locator('[aria-live="polite"]').getByText(announcement, { exact: true }).waitFor();
      assert.equal(await button(scope, name).textContent(), compact ? "" : nextName);
      assert.equal(await page.evaluate(() => window.copiedText), "Synthetic question and answers");
      await focused(button(scope, name));
    }
  }

  // Visible slugs differ from the long names. Both layouts still select with
  // the keyboard, close with Escape, and restore trigger focus.
  for (const [compact, width] of [[false, 1280], [true, 375]]) {
    await page.setViewportSize({ width, height: 900 });
    const scope = page.getByRole("region", { name: compact ? "Compact exam selector" : "Expanded exam selector", exact: true });
    const current = () => button(scope, (compact ? "" : "cloud-one — ") + "Select exam, current exam: Cloud Architecture Fundamentals");
    await current().waitFor();
    assert.equal((await current().textContent()).trim(), compact ? "" : "cloud-one");
    await current().press("Enter");
    await focused(scope.getByRole("option", { name: "Cloud Architecture Fundamentals", exact: true }));
    await page.keyboard.press("ArrowDown");
    await focused(scope.getByRole("option", { name: "Security Engineering Professional", exact: true }));
    await page.keyboard.press("Escape"); await focused(current());
    assert.equal(await current().getAttribute("aria-expanded"), "false");
    await current().press("Space"); await page.keyboard.press("End"); await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.fixtureApp.state.examId === "two" && window.fixtureApp.state.workspaceStatus === "ready");
    const changed = button(scope, (compact ? "" : "security-two — ") + "Select exam, current exam: Security Engineering Professional");
    await focused(changed); assert.equal(await changed.getAttribute("aria-expanded"), "false");
    await changed.click(); await page.keyboard.press("Home"); await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.fixtureApp.state.examId === "one" && window.fixtureApp.state.workspaceStatus === "ready");
    await focused(current());
  }
  exams = [];
  await page.reload();
  await page.waitForFunction(() => window.fixtureApp.state.workspaceStatus === "empty");
  const emptyExpanded = button(page.getByRole("region", { name: "Expanded exam selector" }), "Select an exam");
  const emptyCompact = button(page.getByRole("region", { name: "Compact exam selector" }), "Select exam");
  assert.equal(await emptyExpanded.isDisabled(), true);
  assert.equal(await emptyCompact.isDisabled(), true);
  assert.equal((await emptyExpanded.textContent()).trim(), "Select an exam");
  assert.deepEqual(errors, []);
  console.log("PASS visible accessible names: full text/counts, keyboard and selected states, desktop/compact copy success/error/retry, exam slug/name, keyboard/focus and empty state (Chromium " + browser.version() + ")");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
