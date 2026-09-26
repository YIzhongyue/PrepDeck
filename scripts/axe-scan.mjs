// Automated accessibility check (issue #56): axe-core over PrepDeck's main
// screens in every colour scheme, against the Worker-served build (the one that
// applies production headers). Serious and critical WCAG 2.1 A/AA violations
// fail the check unless they are listed in KNOWN_EXCEPTIONS below with a reason.
//
// Used by `npm run test:local:smoke -- --browser`, and runnable on its own
// against a running `npm run dev`:
//
//   node scripts/axe-scan.mjs            # scan, exit 1 on violations
//   node scripts/axe-scan.mjs --report   # list every violation, never fail
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export const THEMES = ["light", "cream", "sage", "clay", "dusk"];

// Rule id + a substring of the node's selector, and why it is accepted.
// Keep this empty unless a violation is a false positive or out of our hands.
export const KNOWN_EXCEPTIONS = [];

// Each screen: how to reach it from the signed-in app, and what proves it rendered.
// `leaves: true` marks screens that leave the main layout (a live session or a
// public page); the app is reloaded before the next screen.
export const SCREENS = [
  { name: "Statistics", open: page => nav(page, "Statistics"), ready: page => page.getByText("Answered", { exact: true }).first() },
  { name: "Practice setup", open: page => nav(page, "Practice"), ready: page => page.getByRole("button", { name: /Start session/ }) },
  { name: "Practice question", open: async page => { await nav(page, "Practice"); await page.getByRole("button", { name: /Start session/ }).click(); }, ready: page => page.getByRole("button", { name: /Check answer/ }), leaves: true },
  { name: "Mock setup", open: page => nav(page, "Mock exam"), ready: page => page.getByRole("button", { name: /Begin exam|Resume/ }).first() },
  { name: "Learning setup", open: page => nav(page, "Learning"), ready: page => page.getByRole("button", { name: "Start learning", exact: true }) },
  { name: "Learning question", open: async page => { await nav(page, "Learning"); await page.getByRole("button", { name: "Start learning", exact: true }).click(); }, ready: page => page.locator(".st-q").first(), leaves: true },
  { name: "Knowledge points", open: page => nav(page, "Knowledge points"), ready: page => page.getByRole("heading", { level: 1 }).first() },
  { name: "Bookmarks", open: page => nav(page, "Bookmarks"), ready: page => page.getByRole("heading", { name: "Bookmarks" }) },
  { name: "Wrong questions", open: page => nav(page, "Wrong questions"), ready: page => page.getByRole("heading", { name: "Wrong question book" }) },
  { name: "Annotations", open: page => nav(page, "Annotations"), ready: page => page.getByRole("heading", { name: "My annotations" }) },
  { name: "Settings", open: page => nav(page, "Settings"), ready: page => page.getByRole("heading", { name: "Settings", exact: true }) },
  { name: "Admin", open: page => nav(page, "Admin"), ready: page => page.getByRole("heading", { name: "Access & content" }) },
  // Public pages, always in the Light scheme.
  { name: "Privacy policy", open: (page, base) => page.goto(`${base}/privacy`), ready: page => page.getByRole("heading", { level: 1 }).first(), leaves: true },
  { name: "Terms of service", open: (page, base) => page.goto(`${base}/terms`), ready: page => page.getByRole("heading", { level: 1 }).first(), leaves: true },
];

async function nav(page, label) {
  // By title: a count badge ("Bookmarks 3") becomes part of the button's name.
  await page.getByRole("navigation", { name: "Main navigation" }).getByTitle(label, { exact: true }).click();
}

async function settle(page) {
  // Entrance animations fade content in; axe must measure the resting colours.
  // Looping animations (spinners, pulses) never finish, so only finite ones are awaited.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
    .map(a => a.finished.catch(() => {}))));
  await page.waitForTimeout(150);
}

/** Runs axe on the current page; returns serious/critical violations not excepted. */
export async function axeViolations(page) {
  if (!(await page.evaluate(() => typeof window.axe === "object"))) await page.evaluate(AXE_SOURCE);
  const result = await page.evaluate(() => window.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    resultTypes: ["violations"],
  }));
  return result.violations
    .filter(v => v.impact === "serious" || v.impact === "critical")
    .flatMap(v => v.nodes.map(node => ({ rule: v.id, impact: v.impact, target: node.target.join(" "), summary: node.failureSummary?.split("\n").slice(1, 2).join(" ").trim() ?? "", html: node.html.slice(0, 160) })))
    .filter(found => !KNOWN_EXCEPTIONS.some(ex => ex.rule === found.rule && found.target.includes(ex.target)));
}

/** Scans every screen in every scheme; returns [{ theme, screen, ...violation }]. */
export async function scanApp(page, { base, themes = THEMES, screens = SCREENS, log = () => {} } = {}) {
  const found = [];
  for (const theme of themes) {
    // Storage is per origin: set the scheme on the origin being scanned.
    await page.goto(`${base}/`);
    await page.evaluate(t => localStorage.setItem("prepdeck.theme", t), theme);
    // Screens are reached through the app's own navigation. Reloading for each
    // one would refetch the workspace every time and trip the Worker's read
    // rate limit (300 requests a minute) partway through the run.
    let reload = true;
    for (const screen of screens) {
      // The limit is shared by everything local, so a long run can still hit it.
      // A throttled screen shows an error state instead of its content: wait out
      // the window and open it again rather than scan the wrong page.
      for (let attempt = 1; ; attempt++) {
        const throttled = [];
        const onResponse = response => { if (response.status() === 429) throttled.push(Number(response.headers()["retry-after"]) || 60); };
        page.on("response", onResponse);
        let failure;
        try {
          if (reload) {
            await page.goto(`${base}/`);
            await page.waitForFunction(t => document.querySelector("[data-pd-theme]")?.getAttribute("data-pd-theme") === t, theme);
          }
          await screen.open(page, base);
          await screen.ready(page).waitFor({ timeout: 15000 });
          // Let the screen's own data requests land, so a 429 among them is seen.
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        } catch (error) { failure = error; }
        page.off("response", onResponse);
        if (throttled.length && attempt < 3) {
          const wait = Math.max(...throttled);
          log(`${theme} · ${screen.name}: rate limited, retrying in ${wait}s`);
          await page.waitForTimeout(wait * 1000);
          reload = true;
          continue;
        }
        if (failure || throttled.length) {
          const text = (await page.locator("body").innerText()).slice(0, 400);
          throw new Error(`${theme} · ${screen.name} did not open: ${failure ? failure.message.split("\n")[0] : "still rate limited"}\nPage text: ${text}`);
        }
        break;
      }
      reload = !!screen.leaves;
      await settle(page);
      const violations = await axeViolations(page);
      log(`${theme} · ${screen.name}: ${violations.length} violation(s)`);
      for (const violation of violations) found.push({ theme, screen: screen.name, ...violation });
    }
  }
  return found;
}

/** Collapses identical findings across schemes and screens for a readable report. */
export function summarize(found) {
  const groups = new Map();
  for (const f of found) {
    const key = `${f.rule} | ${f.target} | ${f.summary}`;
    const g = groups.get(key) ?? { ...f, themes: new Set(), screens: new Set() };
    g.themes.add(f.theme); g.screens.add(f.screen); groups.set(key, g);
  }
  return [...groups.values()].map(g => `${g.rule} [${[...g.screens].join(", ")}] (${[...g.themes].join(", ")})\n    ${g.target}\n    ${g.summary}\n    ${g.html}`).join("\n");
}

/** Signs in through the local helper in a fresh context, then scans the Worker-served build. */
export async function scanLocal(browser, options = {}) {
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:8788");
    await page.getByRole("button", { name: "Sign in as local admin" }).click();
    await page.waitForURL("http://localhost:5173/");
    return await scanApp(page, { base: "http://localhost:8787", ...options });
  } finally { await context.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const themes = process.env.AXE_THEMES?.split(",") ?? THEMES;
    const found = await scanLocal(browser, { themes, log: line => console.error(line) });
    console.log(found.length ? summarize(found) : "No serious or critical accessibility violations.");
    if (found.length && !process.argv.includes("--report")) process.exitCode = 1;
  } finally { await browser.close(); }
}
