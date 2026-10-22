// Issue #191: the interface in Chinese and Japanese. The real app, started the
// way main.tsx starts it, against a local fixture API:
// - a browser in Japanese opens in Japanese (document language, navigation,
//   tab title), and an unsupported browser language opens in English;
// - switching language mid-session keeps the practice session and its chosen
//   answer, and the unsaved display-name draft in Settings;
// - the choice persists across a reload and beats the browser's language;
// - the sign-in page has its own picker;
// - narrow screens do not overflow sideways with the longer labels.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody } from "./browser-fixture.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const web = fileURLToPath(new URL("../", import.meta.url));
const { outputFiles } = await build({
  stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
    import App from './src/App'; import { initI18n, setLocale } from './src/i18n';
    window.setLocaleForTest = setLocale;
    initI18n().finally(() => createRoot(document.getElementById('root')).render(<App />));`,
    loader: "tsx", resolveDir: web },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic",
  alias: { "@": `${web}src` }, define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
});

const questions = [1, 2, 3].map((n) => ({
  id: `q${n}`, examId: "exam", externalId: `Q${n}`, sequenceNumber: n, type: "single_choice", chooseCount: 1,
  stem: `Fixture question ${n}`, tags: ["Networking"], difficulty: "easy", points: 1,
  options: [{ id: "A", text: "Option A" }, { id: "B", text: "Option B" }],
}));
let signedIn = true;
const attempts = new Map();
const errors = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(outputFiles.find((file) => file.path.endsWith(url.pathname.slice(1)))?.contents);
    }
    res.setHeader("Content-Type", "text/html");
    return res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PrepDeck</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
  const { payload } = await readBody(req);
  const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/api/auth/turnstile") return json({ siteKey: null });
  if (url.pathname === "/api/appearance") return json({ mascotStyle: "3D-Chibi" });
  if (url.pathname === "/api/auth/me") return signedIn ? json({ user: { id: "qa", email: "qa@example.test", role: "user", displayName: "QA" } }) : json({ error: "Unauthorized" }, 401);
  if (url.pathname === "/api/exams") return json({ exams: [{ id: "exam", name: "Network fundamentals", slug: "net", providers: [], questionCount: 3 }] });
  if (url.pathname.endsWith("/practice-catalog")) return json({ questions, bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  if (url.pathname === "/api/settings") return json({ showSharedNotes: false });
  if (url.pathname === "/api/annotation-settings") return json({ hl1Alias: "Service", hl2Alias: "Limit", hl3Alias: "Cost" });
  if (url.pathname === "/api/annotations") return json({ annotations: [] });
  if (url.pathname === "/api/notes") return json({ notes: [] });
  if (url.pathname === "/api/attempts/active") return json({ attempt: null });
  if (url.pathname.endsWith("/learning/progress")) return json({ progress: { lastSequenceNumber: null } });
  if (url.pathname.endsWith("/study-status")) return json({ examId: "exam", statuses: [] });
  if (url.pathname === "/api/exams/exam/attempts" && req.method === "POST") {
    const attempt = { ...payload, examId: "exam", attemptId: `attempt-${attempts.size + 1}`, selectedAnswers: {}, flagged: {}, startedAt: new Date().toISOString() };
    attempts.set(attempt.attemptId, attempt);
    return json(attempt, 201);
  }
  return json({ error: "Optional fixture route" }, 503);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const noSidewaysScroll = (page, label) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  .then((overflow) => assert.ok(overflow <= 1, `${label} scrolls sideways by ${overflow}px`));

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });

  // --- A Japanese browser opens in Japanese --------------------------------
  const ja = await browser.newContext({ locale: "ja-JP", viewport: { width: 1280, height: 900 } });
  const page = await ja.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  const nav = page.getByRole("navigation", { name: "メインナビゲーション" });
  await nav.getByRole("link", { name: "練習" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "ja");
  await page.waitForFunction(() => document.title.startsWith("統計"));
  await page.getByRole("heading", { name: /こんにちは、QA さん/ }).waitFor();

  // --- A practice session survives a language switch -----------------------
  await nav.getByRole("link", { name: "練習" }).click();
  await page.getByRole("heading", { name: "練習を作成" }).waitFor();
  await page.getByRole("button", { name: /開始/ }).click();
  await page.getByRole("heading", { name: /問題 1/ }).waitFor();
  const optionA = page.getByRole("radio", { name: /Option A/ });
  await optionA.click();
  assert.equal(await optionA.getAttribute("aria-checked"), "true");
  assert.equal(await page.evaluate(() => window.setLocaleForTest("zh-CN")), true);
  await page.getByRole("heading", { name: /第 1 题/ }).waitFor();
  assert.equal(await page.getByRole("radio", { name: /Option A/ }).getAttribute("aria-checked"), "true", "the chosen answer is kept");
  await page.getByRole("button", { name: "检查答案" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "zh-CN");
  assert.equal(attempts.size, 1, "no second session was started");
  // Question content is never translated.
  await page.getByText("Fixture question", { exact: false }).first().waitFor();

  // --- Settings: the picker, an unsaved draft, and persistence --------------
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "设置" }).click();
  const name = page.getByRole("textbox", { name: "显示名称" });
  await name.fill("Draft name");
  const picker = page.locator("#settings-language").getByRole("button");
  await picker.click();
  await page.getByRole("option", { name: "English" }).click();
  await page.getByRole("heading", { name: "Display name" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Display name" }).inputValue(), "Draft name", "the unsaved draft is kept");
  assert.equal(await page.evaluate(() => localStorage.getItem("prepdeck.locale")), "en");
  await picker.click();
  await page.getByRole("option", { name: "日本語" }).click();
  await page.getByRole("heading", { name: "表示名" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "設定", level: 1 }).waitFor({ state: "attached" });
  assert.equal(await page.evaluate(() => document.documentElement.lang), "ja", "the choice outlives a reload");
  await ja.close();

  // --- An unsupported language falls back to English; a stored choice wins -
  const fr = await browser.newContext({ locale: "fr-FR", viewport: { width: 1280, height: 900 } });
  const frPage = await fr.newPage();
  await frPage.goto(base);
  await frPage.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Practice" }).waitFor();
  assert.equal(await frPage.evaluate(() => document.documentElement.lang), "en");
  await frPage.evaluate(() => localStorage.setItem("prepdeck.locale", "zh-CN"));
  await frPage.reload();
  await frPage.getByRole("navigation", { name: "主导航" }).waitFor();
  await fr.close();

  // --- The sign-in page has its own picker ----------------------------------
  signedIn = false;
  const zh = await browser.newContext({ locale: "zh-CN", viewport: { width: 390, height: 844 } });
  const login = await zh.newPage();
  login.on("pageerror", (error) => errors.push(error.message));
  await login.goto(base);
  await login.getByRole("heading", { name: "欢迎回来！" }).waitFor();
  await login.getByRole("button", { name: "使用 Google 登录" }).waitFor();
  await noSidewaysScroll(login, "zh-CN sign-in");
  await login.getByRole("combobox", { name: "语言" }).selectOption("ja");
  await login.getByRole("heading", { name: "おかえりなさい！" }).waitFor();
  await noSidewaysScroll(login, "ja sign-in");
  await login.getByRole("combobox", { name: "言語" }).selectOption("en");
  await login.getByRole("heading", { name: "Welcome back!" }).waitFor();
  signedIn = true;

  // --- Phone layouts with the longer labels ---------------------------------
  for (const code of ["zh-CN", "ja"]) {
    await login.evaluate((value) => localStorage.setItem("prepdeck.locale", value), code);
    await login.goto(`${base}/exams/net/practice`);
    await login.locator("html[lang]").evaluate((html, value) => html.lang === value || Promise.reject(new Error(html.lang)), code);
    await login.getByRole("navigation", { name: code === "ja" ? "メインナビゲーション" : "主导航" }).waitFor();
    await login.getByRole("button", { name: code === "ja" ? /開始/ : /开始/ }).waitFor();
    await noSidewaysScroll(login, `${code} practice setup`);
    await login.goto(`${base}/settings`);
    await login.locator("#settings-language").waitFor();
    await noSidewaysScroll(login, `${code} settings`);
  }
  await zh.close();

  assert.deepEqual(errors, []);
  console.log("PASS interface language: detection, switching mid-session, persistence, sign-in picker and phone layouts");
} finally {
  await browser?.close();
  server.close();
}
