// Preloaded into every browser regression by scripts/browser-regressions.mjs
// (`node --import`), so a failing script leaves more behind than one stack
// trace (issue #83). It hooks Playwright's chromium.launch and, when a context
// or the browser is closed, which each script does in its `finally`, saves
// every page still open: a screenshot, its DOM, and a log of its console,
// uncaught errors and requests. The runner keeps that folder only for a
// script that failed. Without BROWSER_DIAGNOSTICS_DIR this module does nothing,
// and it never fails a test itself: every capture is best effort.
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.env.BROWSER_DIAGNOSTICS_DIR;
const LOG_LINES = 300;
const CAPTURE_TIMEOUT = 5_000;

if (dir) {
  const spec = process.env.PLAYWRIGHT_MODULE;
  const playwright = await import(spec ? (isAbsolute(spec) ? pathToFileURL(spec).href : spec) : "playwright").catch(() => null);
  const chromium = playwright?.chromium ?? playwright?.default?.chromium;
  if (chromium) hook(chromium);
}

function hook(chromium) {
  const logs = new WeakMap(), captured = new WeakSet(), browsers = new Set();
  let count = 0;
  const within = promise => {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), CAPTURE_TIMEOUT); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  };

  const watchPage = page => {
    if (logs.has(page)) return;
    const log = [];
    logs.set(page, log);
    const push = line => { log.push(`${new Date().toISOString().slice(11, 23)} ${line}`); if (log.length > LOG_LINES) log.shift(); };
    page.on("console", message => push(`console.${message.type()}: ${message.text()}`));
    page.on("pageerror", error => push(`pageerror: ${error.stack ?? error.message}`));
    page.on("request", request => { if (isApi(request.url())) push(`→ ${request.method()} ${path(request.url())}`); });
    page.on("response", response => { if (isApi(response.url())) push(`← ${response.status()} ${response.request().method()} ${path(response.url())}`); });
    page.on("requestfailed", request => push(`✗ ${request.method()} ${path(request.url())}: ${request.failure()?.errorText ?? "failed"}`));
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) push(`navigated to ${frame.url()}`); });
  };

  const capture = async pages => {
    for (const page of pages) {
      if (captured.has(page) || page.isClosed()) continue;
      captured.add(page);
      const base = join(dir, `page-${String(++count).padStart(2, "0")}`);
      try {
        mkdirSync(dir, { recursive: true });
        const header = [`url: ${page.url()}`, `viewport: ${JSON.stringify(page.viewportSize())}`];
        await within(page.title()).then(title => header.push(`title: ${title}`), () => {});
        await within(page.screenshot({ path: `${base}.png` })).catch(error => header.push(`screenshot failed: ${error.message}`));
        await within(page.content()).then(html => writeFileSync(`${base}.html`, html), error => header.push(`DOM capture failed: ${error.message}`));
        writeFileSync(`${base}.log`, [...header, "", ...(logs.get(page) ?? ["(no events recorded)"])].join("\n") + "\n");
      } catch { /* Diagnostics are best effort. */ }
    }
  };
  const pagesOf = contexts => contexts.flatMap(context => context.pages());

  const watchContext = context => {
    for (const page of context.pages()) watchPage(page);
    context.on("page", watchPage);
    const close = context.close;
    context.close = async function (...args) { await capture(context.pages()); return close.apply(this, args); };
    return context;
  };

  const launch = chromium.launch;
  chromium.launch = async function (...args) {
    const browser = await launch.apply(this, args);
    browsers.add(browser);
    const { newContext, newPage, close } = browser;
    browser.newContext = async function (...a) { return watchContext(await newContext.apply(this, a)); };
    browser.newPage = async function (...a) { const page = await newPage.apply(this, a); watchPage(page); return page; };
    browser.close = async function (...a) { browsers.delete(browser); await capture(pagesOf(browser.contexts())); return close.apply(this, a); };
    return browser;
  };

  // The runner's per-script timeout sends SIGTERM; a hung script is exactly
  // the one whose pages are worth seeing.
  process.once("SIGTERM", async () => {
    await Promise.race([capture([...browsers].flatMap(browser => pagesOf(browser.contexts()))), new Promise(resolve => setTimeout(resolve, 15_000))]);
    process.exit(143);
  });
}

const isApi = url => { try { return new URL(url).pathname.startsWith("/api/"); } catch { return false; } };
const path = url => { try { const { pathname, search } = new URL(url); return pathname + search; } catch { return url; } };
