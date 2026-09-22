// Drive the real Admin console inside the real application shell, because the
// thing this has to get right — a modal that dims the whole window rather than
// the column it is rendered in — only exists in a browser. The backdrop is a
// containing-block problem: `position: fixed` is only as wide as the nearest
// transformed ancestor, and the Admin screen has an entrance animation, so the
// bug is invisible to any test that renders the dialog on its own.
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

const exams = [
  { id: "exam", name: "Solutions Architect Professional", slug: "sap-c02", questionCount: 12, archivedAt: null, badgeIconUrl: null, providers: [{ id: "aws", name: "Amazon Web Services", shortName: "AWS" }] },
  { id: "exam-2", name: "Cloud Practitioner", slug: "clf-c02", questionCount: 4, archivedAt: null, badgeIconUrl: null, providers: [] }
];
const providers = [{ id: "aws", name: "Amazon Web Services", shortName: "AWS", websiteUrl: null, iconUrl: null }];
const errors = [];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(outputFiles.find(file => file.path.endsWith(url.pathname.slice(1)))?.contents);
    }
    res.setHeader("Content-Type", "text/html");
    return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
  const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/api/auth/me") return json({ user: { id: "root", email: "root@example.test", role: "admin", displayName: "Root" } });
  if (url.pathname === "/api/exams") return json({ exams });
  if (url.pathname === "/api/providers") return json({ providers });
  if (url.pathname === "/api/admin/overview") {
    return json({ users: { invited: 1, active: 3, revoked: 0, total: 4 }, exams: { total: exams.length, archived: 0 },
      questions: { total: 16, byExam: exams.map(e => ({ examId: e.id, examName: e.name, questionCount: e.questionCount })) }, attempts: { total: 42 } });
  }
  if (url.pathname === "/api/admin/users") return json({ users: [{ id: "root", email: "root@example.test", displayName: "Root", role: "admin", status: "active", createdAt: "2026-01-01T00:00:00Z", lastSeenAt: null }] });
  if (url.pathname === "/api/settings") return json({ showSharedNotes: true });
  if (url.pathname === "/api/annotation-settings") return json({ hl1Alias: "First", hl2Alias: "Second", hl3Alias: "Third" });
  if (url.pathname === "/api/annotations") return json({ annotations: [] });
  if (url.pathname === "/api/notes") return json({ notes: [] });
  if (url.pathname === "/api/attempts/active") return json({ attempt: null });
  if (url.pathname.endsWith("/learning/progress")) return json({ progress: { lastSequenceNumber: null } });
  if (url.pathname.endsWith("/practice-catalog")) return json({ questions: [], bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
  if (url.pathname === "/api/daily-email-settings") return json({ enabled: false, questionsPerEmail: 3, source: "wrong", sendHourLocal: 8, timezone: "UTC" });
  return json({ error: "Optional fixture route" }, 503);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(() => window.store.go("admin"));
  await page.getByRole("heading", { name: "Access & content" }).waitFor();
  await page.getByRole("button", { name: /^Content/ }).click();

  // Whatever the dialog is mounted in — the assertions below are about what the
  // user sees, not about which element paints it.
  const panel = page.locator(".admin-modal");
  const layer = panel.locator("..");
  const openProvider = async () => {
    await page.getByRole("button", { name: "New provider", exact: true }).click();
    await layer.waitFor();
    // Settle the entrance animation the dialog is rendered inside, so nothing
    // below measures a frame that is still moving.
    await page.locator(".admin-shell").evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  };

  // What the bug looked like: the wash started where the Admin content column
  // started, leaving the sidebar and the page margins undimmed. Measure the
  // layer against the viewport, and hit-test the four corners — the sidebar
  // sits under the top-left one.
  const coverage = async label => {
    const viewport = page.viewportSize();
    const cover = await layer.boundingBox();
    assert.deepEqual(
      { x: Math.round(cover.x), y: Math.round(cover.y), width: Math.round(cover.width), height: Math.round(cover.height) },
      { x: 0, y: 0, width: viewport.width, height: viewport.height },
      `${label}: the modal layer does not cover the viewport`
    );
    const corners = await layer.evaluate((el, { width, height }) => [[6, 6], [width - 6, 6], [6, height - 6], [width - 6, height - 6]]
      .map(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit === el ? "covered" : `${hit?.tagName.toLowerCase()}.${hit?.className || ""}`; }), viewport);
    assert.deepEqual(corners, Array(4).fill("covered"), `${label}: page still showing through at the corners — ${JSON.stringify(corners)}`);
    // And that cover is the app's own wash, resolved from theme tokens the layer
    // still inherits from where it sits in the tree — the top layer does not cut
    // an element off from them.
    const wash = await layer.evaluate(el => {
      const probe = document.createElement("div");
      probe.style.background = "color-mix(in srgb, var(--color-neutral-900) 50%, transparent)";
      el.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { expected, painted: [getComputedStyle(el).backgroundColor, getComputedStyle(el, "::backdrop").backgroundColor] };
    });
    assert.ok(wash.painted.includes(wash.expected), `${label}: the dimming wash is not painted (${JSON.stringify(wash)})`);
    // Centred, and wholly inside the window it is centred in.
    const box = await panel.boundingBox();
    assert.ok(Math.abs((box.x + box.width / 2) - viewport.width / 2) <= 1, `${label}: the dialog is off-centre`);
    assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, `${label}: the dialog does not fit the viewport`);
  };

  await openProvider();
  await coverage("desktop");

  // The top layer is what makes the page behind it inert: a background control
  // takes neither focus nor a click while the dialog is up.
  const background = page.getByRole("button", { name: "New exam", exact: true });
  const reached = await background.evaluate(el => { el.focus(); const focused = document.activeElement === el; el.click(); return focused; });
  assert.equal(reached, false, "a background button still takes focus behind the modal");
  assert.equal(await layer.count(), 1, "a background click opened a second dialog behind the modal");
  assert.ok(await panel.evaluate(el => el.contains(document.activeElement)), "focus is not inside the dialog");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden", "the page behind the modal still scrolls");
  console.log("PASS New provider: the wash covers the window, the sidebar included, and the page behind it is inert");

  // Escape and the wash both close through the caller, so the state that
  // renders the dialog stays in step with the element.
  await page.keyboard.press("Escape");
  await layer.waitFor({ state: "detached" });
  await openProvider();
  await page.mouse.click(6, 6);
  await layer.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.body.style.overflow), "", "closing the modal left the page unscrollable");
  console.log("PASS dismissal: Escape and the backdrop both close the dialog and hand the page back");

  // Narrow viewport: the same guarantee, on the layout that has no sidebar.
  await page.setViewportSize({ width: 390, height: 780 });
  await openProvider();
  await coverage("phone");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `page overflows by ${overflow}px at 390px`);
  console.log("PASS narrow viewport: the dialog still covers the window and nothing overflows");

  assert.deepEqual(errors, []);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
