// Drive the real Bookmarks and Wrong Question Book screens against a fixture
// API, because what this filter has to get right is only observable in a
// browser: a tag set large enough to bury the questions, an active filter
// surviving a collapse, availability following the list as it changes, and the
// whole thing still fitting a phone.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import {Shell} from './src/App';
function Probe(){window.store=usePrepDeck();return null;}
createRoot(document.getElementById('root')).render(<PrepDeckProvider><Probe/><Shell/></PrepDeckProvider>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false,
  outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });

// 14 wrong questions across 14 tags — the wall of chips this page used to be —
// against 4 bookmarks across 3 tags, which is the small list the same bar has
// to keep quiet. The first question carries two tags, so "Security" covers more
// of the list than anything else and one card can match two active filters.
const DOMAINS = ["Networking", "Security", "Storage", "Compute", "Databases", "Migration", "Cost", "Monitoring",
  "Serverless", "Containers", "Identity", "Analytics", "Resilience", "Governance"];
const questions = DOMAINS.flatMap((domain, index) => {
  const base = { examId: "exam", type: "single_choice", chooseCount: 1, difficulty: "easy", points: 1, options: [{ id: "A", text: "Option A" }, { id: "B", text: "Option B" }] };
  // The first stem runs long on purpose: it is what makes its card taller than
  // the one beside it, which is the only way the card-action alignment below
  // can be caught getting it wrong.
  const stem = index === 0 ? `Wrong ${domain} — ${"a stem long enough to run past the line and push this card taller than the one next to it. ".repeat(3)}` : `Wrong ${domain}`;
  const rows = [{ ...base, id: `w${index + 1}`, externalId: `W${index + 1}`, sequenceNumber: index + 1, stem, tags: index === 0 ? [domain, "Security"] : [domain] }];
  return rows;
});
// Bookmarks keep their own tag set, including one the wrong book never has.
for (const [index, tags] of [["Networking"], ["Storage"], ["Storage"], ["Billing"]].entries()) {
  questions.push({ examId: "exam", id: `b${index + 1}`, externalId: `B${index + 1}`, sequenceNumber: 100 + index, type: "single_choice", chooseCount: 1, stem: `Bookmarked ${tags[0]}`, tags, difficulty: "easy", points: 1, options: [{ id: "A", text: "Option A" }, { id: "B", text: "Option B" }] });
}
const wrong = new Map(questions.filter(q => q.id.startsWith("w")).map(q => [q.id, { questionId: q.id, wrongCount: 2, lastWrongAt: new Date().toISOString(), mastered: false }]));
const bookmarkedIds = questions.filter(q => q.id.startsWith("b")).map(q => q.id);
const errors = [];

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
  const payload = JSON.parse(raw || "{}");
  const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/api/auth/me") return json({ user: { id: "qa", email: "qa@example.test", role: "user", displayName: "QA" } });
  if (url.pathname === "/api/exams") return json({ exams: [{ id: "exam", name: "Review lists", slug: "exam", providers: [], questionCount: questions.length }] });
  if (url.pathname.endsWith("/practice-catalog")) {
    return json({ questions, bookmarkedIds: bookmarkedIds.filter(id => !payload.removed), wrongEntries: [...wrong.values()].filter(row => !row.mastered), attemptedIds: [] });
  }
  if (url.pathname === "/api/settings") return json({ showSharedNotes: true });
  if (url.pathname === "/api/annotation-settings") return json({ hl1Alias: "First", hl2Alias: "Second", hl3Alias: "Third" });
  if (url.pathname === "/api/annotations") return json({ annotations: [] });
  if (url.pathname === "/api/notes") return json({ notes: [] });
  if (url.pathname === "/api/attempts/active") return json({ attempt: null });
  if (url.pathname.endsWith("/learning/progress")) return json({ progress: { lastSequenceNumber: 1 } });
  if (url.pathname.endsWith("/wrong-book/mastered")) { wrong.get(url.pathname.split("/")[3]).mastered = true; return json({ mastered: true }); }
  if (url.pathname.endsWith("/bookmark")) { return json({ bookmarked: false }); }
  return json({ error: "Optional fixture route" }, 503);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const shots = process.env.REVIEW_LIST_SCREENSHOTS ?? process.env.SCREENSHOT_DIR;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.store[method](...args), { method, args });
  const open = async screen => {
    await invoke("go", screen);
    await page.waitForFunction(id => window.store.state.screen === id, screen);
    await page.locator(".tag-filter").waitFor();
  };
  const chips = page.locator(".tag-filter__chip");
  const chipNames = () => chips.locator(".tag-filter__name").allTextContents();
  const cards = page.locator(".card.elev-sm");
  const capture = async name => { if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: `${shots}/review-lists-${name}.png`, fullPage: true }); } };

  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.store?.state.workspaceStatus === "ready");
  await open("wrong");

  // A 14-tag list opens as one compact bar, not as every tag it owns.
  assert.equal(await cards.count(), 14);

  // Card actions live in the bottom-right corner, against the card's own
  // padding, whatever the stem does above them — so the grid reads as a column
  // of controls instead of a staircase following the text.
  const actionCorners = () => cards.evaluateAll(nodes => nodes.map(card => {
    const style = getComputedStyle(card);
    const box = card.getBoundingClientRect();
    const buttons = card.querySelectorAll("button");
    const last = buttons[buttons.length - 1].getBoundingClientRect();
    return {
      id: card.querySelector(".tag-neutral").textContent,
      bottomGap: box.bottom - parseFloat(style.paddingBottom) - last.bottom,
      rightGap: box.right - parseFloat(style.paddingRight) - last.right,
      gapToStem: last.top - card.querySelector("p").getBoundingClientRect().bottom,
      stemHeight: card.querySelector("p").getBoundingClientRect().height,
      bottom: Math.round(last.bottom),
    };
  }));
  const corners = await actionCorners();
  assert.deepEqual(corners.filter(c => Math.abs(c.bottomGap) > 1 || Math.abs(c.rightGap) > 1), [],
    "every card parks its actions in the bottom-right corner");
  assert.ok(corners.every(c => c.gapToStem >= 8), "actions keep clear of the question text");
  assert.ok(corners[0].stemHeight > corners[1].stemHeight + 10, "the fixture pairs a long stem with a short one");
  assert.equal(corners[0].bottom, corners[1].bottom, "two cards of different text lengths land their actions on one line");
  assert.equal(await chips.count(), 6, "collapsed bar shows a fixed handful of chips");
  const more = page.getByRole("button", { name: /^Show \d+ more$/ });
  assert.equal(await more.textContent(), "Show 8 more", "the bar says how much it is holding back");
  const barHeight = await page.locator(".tag-filter").evaluate(node => node.getBoundingClientRect().height);
  assert.ok(barHeight < 200, `filter bar is ${barHeight}px tall, not a wall of chips`);
  // Security covers two questions; the rest cover one each and break the tie
  // alphabetically, which is what keeps the chip order stable between renders.
  assert.deepEqual((await chipNames()).slice(0, 3), ["Security", "Analytics", "Compute"], "widest-covering tags lead");
  await capture("wrong-collapsed");

  // A tag the collapsed bar holds back is found by searching, not by scrolling
  // a wall of chips — and selecting it drives the cards, the practice action
  // and the status line together.
  assert.equal(await page.getByRole("button", { name: /^Storage, / }).count(), 0, "Storage starts out behind More");
  await more.click();
  const search = page.getByRole("searchbox", { name: "Search tags" });
  await search.fill("sto");
  await page.waitForFunction(() => document.querySelectorAll(".tag-filter__chip").length === 1);
  await page.getByRole("button", { name: "Storage, 1 question" }).click();
  await page.getByRole("button", { name: "Practice these 1", exact: true }).waitFor();
  assert.equal(await cards.count(), 1);
  await page.getByText("1 of 14 questions · 1 tag selected").waitFor();

  // Searching for a different tag must not take the active filter off screen:
  // it is still filtering the page, and its chip is the only way to switch it
  // off. Selected chips are pinned ahead of the matches, search or no search.
  await search.fill("sec");
  await page.getByRole("button", { name: "Security, 2 questions" }).waitFor();
  assert.deepEqual(await chipNames(), ["Storage", "Security"], "the active filter is pinned while the search narrows the rest");
  assert.equal(await page.locator('.tag-filter__chip[aria-pressed="true"]').count(), 1);
  assert.equal(await cards.count(), 1, "searching filters chips, never questions");
  await capture("wrong-search-pinned");

  // Even a search that matches nothing keeps it, and says what it is that
  // found nothing.
  await search.fill("zzz");
  await page.getByText("No other tags match “zzz”.").waitFor();
  assert.deepEqual(await chipNames(), ["Storage"]);
  await page.getByRole("button", { name: "Storage, 1 question" }).click();
  await page.getByRole("button", { name: "Practice these 14", exact: true }).waitFor();
  assert.equal(await page.locator(".tag-filter__clear").count(), 0, "the filter was switched off from where it stood, mid-search");
  // Nothing pinned now, so the same empty result speaks for the whole tag set.
  await page.getByText("No tags match “zzz”.").waitFor();
  assert.deepEqual(await chipNames(), []);
  await search.fill("sto");
  await page.getByRole("button", { name: "Storage, 1 question" }).click();
  await page.getByRole("button", { name: "Practice these 1", exact: true }).waitFor();
  await search.fill("zzz");

  // Collapsing keeps the filter and pulls its chip to the front, where a
  // top-six-by-coverage bar would not have shown it at all.
  await page.getByRole("button", { name: "Show fewer" }).click();
  assert.equal((await chipNames())[0], "Storage", "an active filter leads the collapsed bar");
  assert.equal(await cards.count(), 1, "collapsing changes no filter");
  assert.equal(await page.getByRole("searchbox", { name: "Search tags" }).count(), 0);

  // OR matching, stated in lib/tagFilter.ts and visible here: a second tag
  // widens the list rather than intersecting it away.
  await page.getByRole("button", { name: "Security, 2 questions" }).click();
  await page.getByRole("button", { name: "Practice these 3", exact: true }).waitFor();
  await page.getByText("3 of 14 questions · 2 tags selected").waitFor();
  assert.equal(await page.locator('.tag-filter__chip[aria-pressed="true"]').count(), 2);
  assert.deepEqual(await page.locator('.tag-filter__chip[aria-pressed="true"] .tag-filter__check').evaluateAll(ticks =>
    ticks.map(tick => getComputedStyle(tick).width)), ["12px", "12px"], "a selected chip shows its tick at once, hovered or not");
  assert.equal(await page.locator(".card.elev-sm .tag-accent-2").evaluateAll(tags =>
    tags.filter(tag => tag.style.boxShadow.includes("--color-accent")).length), 3, "matched card tags carry the accent ring");
  await capture("wrong-filtered");

  // Mastering the only Storage question retires the tag, and with it the part
  // of the filter it was applying. The rest of the filter still holds.
  await page.locator(".card.elev-sm").filter({ hasText: "Wrong Storage" }).getByRole("button", { name: "Mark mastered" }).click();
  await page.getByRole("button", { name: "Practice these 2", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Storage, / }).count(), 0, "a tag with no questions left leaves the bar");
  await page.getByText("2 of 13 questions · 1 tag selected").waitFor();

  // Retiring the last question of the only active tag hands the whole list
  // back rather than leaving an invisible filter over an empty page.
  await page.getByRole("button", { name: "Security, 2 questions" }).click();
  await page.getByRole("button", { name: "Compute, 1 question" }).click();
  await page.getByRole("button", { name: "Practice these 1", exact: true }).waitFor();
  await page.locator(".card.elev-sm").filter({ hasText: "Wrong Compute" }).getByRole("button", { name: "Mark mastered" }).click();
  await page.getByText("12 questions · all tags").waitFor();
  assert.equal(await cards.count(), 12);

  // Clearing is one control away, whatever is selected.
  await page.getByRole("button", { name: "Security, 2 questions" }).click();
  await page.getByRole("button", { name: "Databases, 1 question" }).click();
  await page.getByRole("button", { name: "Practice these 3", exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Practice these 12", exact: true }).waitFor();
  assert.equal(await page.locator('.tag-filter__chip[aria-pressed="true"]').count(), 0);
  console.log("PASS wrong book: collapsed by default, searchable, OR matching, and availability follows the list");

  // Keyboard operation: a chip is reachable, togglable and visibly focused.
  const first = chips.first();
  await first.focus();
  await page.keyboard.press("Space");
  assert.equal(await first.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".tag-filter__clear").count(), 1);
  await page.keyboard.press("Enter");
  assert.equal(await first.getAttribute("aria-pressed"), "false");
  const outline = await first.evaluate(node => { node.focus(); return getComputedStyle(node).outlineWidth; });
  assert.notEqual(outline, "0px", "a focused chip shows a ring");

  // The same component on the short list: no overflow control at all.
  await open("bookmarks");
  assert.equal(await cards.count(), 4);
  // Same component, so the same corner — Remove bookmark sits where Mark
  // mastered does on the other list.
  assert.deepEqual((await actionCorners()).filter(c => Math.abs(c.bottomGap) > 1 || Math.abs(c.rightGap) > 1), [],
    "bookmark cards park their actions in the same corner");
  assert.deepEqual(await chipNames(), ["Storage", "Billing", "Networking"]);
  assert.equal(await page.getByRole("button", { name: /^Show \d+ more$/ }).count(), 0, "a three-tag list has nothing to collapse");
  assert.equal(await page.getByRole("searchbox", { name: "Search tags" }).count(), 0);
  assert.equal(await page.locator(".tag-filter__clear").count(), 0, "clear appears only with something to clear");
  await page.getByRole("button", { name: "Storage, 2 questions" }).click();
  await page.getByRole("button", { name: "Practice these 2", exact: true }).waitFor();
  await page.getByText("2 of 4 questions · 1 tag selected").waitFor();
  await capture("bookmarks-filtered");

  // Switching lists reuses one filter state; tags the other list does not have
  // must not follow it there.
  await open("wrong");
  assert.equal(await page.locator('.tag-filter__chip[aria-pressed="true"]').count(), 0, "a bookmark-only tag does not filter the wrong book");
  await page.getByRole("button", { name: "Practice these 12", exact: true }).waitFor();
  console.log("PASS bookmarks: same bar, same states, and no filter leaks between the two lists");

  // Phone width: everything still fits and still works.
  await page.setViewportSize({ width: 375, height: 800 });
  await open("wrong");
  await page.getByRole("button", { name: /^Show \d+ more$/ }).click();
  await page.getByRole("searchbox", { name: "Search tags" }).fill("net");
  await page.getByRole("button", { name: "Networking, 1 question" }).click();
  await page.getByRole("button", { name: "Practice these 1", exact: true }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `page overflows by ${overflow}px at 375px`);
  const chipBox = await chips.first().boundingBox();
  assert.ok(chipBox.height >= 36, `chip is ${chipBox.height}px tall on a touch target`);
  await capture("wrong-phone");
  console.log("PASS narrow viewport: no horizontal overflow and the filter still operates");

  assert.deepEqual(errors, []);
  if (shots) await writeFile(`${shots}/review-lists.txt`, "Bookmarks and wrong-book tag filter captures\n");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
