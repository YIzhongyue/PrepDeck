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
const providers = [{ id: "aws", name: "Amazon Web Services", shortName: "AWS", websiteUrl: null, iconUrl: null, archivedAt: null }];
let providerCreates = 0, providerDeletes = 0, failNextIcon = false;
const examPatches = [];
const errors = [];
const apiRequests = [];
// The overview drives the header's status pill (issue #49): it can succeed,
// fail or answer slowly, and report any exam total.
let overviewMode = "ok", overviewExams = exams.length;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
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
  if (url.pathname === "/api/exams") return json({ exams: exams.map(exam => ({ ...exam,
    providers: exam.providers.map(p => providers.find(provider => provider.id === p.id)).filter(p => p && (url.searchParams.get("includeArchived") === "true" || !p.archivedAt)),
  })) });
  if (url.pathname.startsWith("/api/exams/") && req.method === "PATCH") {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const patch = JSON.parse(Buffer.concat(chunks).toString());
    examPatches.push(patch);
    const exam = exams.find(e => e.id === url.pathname.split("/")[3]);
    if (exams.some(e => e !== exam && e.slug === patch.slug)) return json({ error: "An exam with this slug already exists" }, 409);
    Object.assign(exam, patch);
    return json({ exam: { ...exam, providers: exam.providers.map(p => providers.find(provider => provider.id === p.id)).filter(Boolean) } });
  }
  if (url.pathname === "/api/providers" && req.method === "GET") return json({ providers: providers.filter(p => url.searchParams.get("includeArchived") === "true" || !p.archivedAt) });
  if (url.pathname.startsWith("/api/providers") && req.method !== "GET") {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const data = Buffer.concat(chunks).toString();
    if (url.pathname === "/api/providers" && req.method === "POST") {
      const provider = { ...JSON.parse(data), id: `new-${++providerCreates}`, iconUrl: null, archivedAt: null };
      providers.push(provider); return json({ provider }, 201);
    }
    const [, , , id, action] = url.pathname.split("/");
    const provider = providers.find(p => p.id === id);
    if (!provider) return json({ error: "Provider not found" }, 404);
    if (action === "icon") {
      if (failNextIcon) { failNextIcon = false; return json({ error: "Upload temporarily unavailable" }, 503); }
      provider.iconUrl = req.method === "DELETE" ? null : "/fixture-icon.png";
      return json({ iconUrl: provider.iconUrl });
    }
    if (action === "archive" || action === "unarchive") { provider.archivedAt = action === "archive" ? "now" : null; return json({ provider }); }
    if (req.method === "PATCH") { Object.assign(provider, JSON.parse(data)); return json({ provider }); }
    if (req.method === "DELETE") {
      providerDeletes++;
      if (exams.some(exam => exam.providers.some(p => p.id === id))) return json({ error: "Provider is still assigned to exams. Archive it instead." }, 409);
      providers.splice(providers.indexOf(provider), 1); res.writeHead(204); return res.end();
    }
  }
  if (url.pathname === "/api/admin/overview") {
    if (overviewMode === "fail") return json({ error: "Database unavailable" }, 503);
    if (overviewMode === "slow") await new Promise(resolve => setTimeout(resolve, 3200));
    return json({ users: { invited: 1, active: 3, revoked: 0, total: 4 }, exams: { total: overviewExams, archived: 0 },
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

  // The status pill reports the overview request instead of claiming
  // "System operational" whatever happens, and counts are pluralised.
  const pill = page.locator(".admin-status-pill");
  const reopenOverview = async () => {
    await page.getByRole("button", { name: /^People/ }).click();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
  };
  await page.getByText("Across 2 exams", { exact: true }).waitFor();
  assert.match(await pill.textContent(), /^\s*Operational/);
  assert.equal(await pill.getAttribute("class"), "admin-status-pill is-ok");
  overviewExams = 1; await reopenOverview();
  await page.getByText("Across 1 exam", { exact: true }).waitFor();
  overviewMode = "fail"; await reopenOverview();
  await page.getByText("Could not load the overview.").waitFor();
  assert.match(await pill.textContent(), /^\s*Status unavailable/);
  assert.equal(await pill.getAttribute("class"), "admin-status-pill is-down");
  assert.match(await pill.getAttribute("title"), /Database unavailable/);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/admin-status-unavailable.png` });
  overviewMode = "ok"; await page.getByRole("button", { name: "Retry" }).click();
  await page.getByText("Across 1 exam", { exact: true }).waitFor();
  assert.match(await pill.textContent(), /^\s*Operational/);
  overviewMode = "slow"; await reopenOverview();
  await page.waitForFunction(() => document.querySelector(".admin-status-pill")?.classList.contains("is-checking"));
  assert.match(await pill.textContent(), /^\s*Checking status/);
  await page.waitForFunction(() => document.querySelector(".admin-status-pill")?.classList.contains("is-slow"), null, { timeout: 8000 });
  assert.match(await pill.textContent(), /^\s*Slow to respond/);
  overviewMode = "ok"; overviewExams = exams.length;
  console.log("PASS status pill follows the overview request (checking, operational, slow, unavailable, retry) and counts are pluralised");

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
  // Measure the phone layout itself, not the desktop one squeezed to 390px.
  await page.waitForFunction(() => window.store?.width === 390);
  await page.locator(".admin-shell").evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  // The tab row stays one line: every tab shares one top edge and one height,
  // "MCP tokens" included, and the row scrolls rather than wrapping.
  const tabBoxes = await page.locator(".admin-tab").evaluateAll(tabs => tabs.map(tab => {
    const box = tab.getBoundingClientRect();
    return { label: tab.textContent, top: Math.round(box.top), height: Math.round(box.height) };
  }));
  assert.equal(new Set(tabBoxes.map(t => t.top)).size, 1, `tabs wrap onto two rows: ${JSON.stringify(tabBoxes)}`);
  assert.equal(new Set(tabBoxes.map(t => t.height)).size, 1, `a tab label wraps: ${JSON.stringify(tabBoxes)}`);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/admin-tabs-phone.png` });
  await openProvider();
  await coverage("phone");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `page overflows by ${overflow}px at 390px`);
  console.log("PASS narrow viewport: the dialog still covers the window and nothing overflows");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Manage providers", exact: true }).click();
  let row = page.getByRole("region", { name: "Amazon Web Services", exact: true });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "Amazon Web Services");
  await page.getByLabel("Name", { exact: true }).fill("Amazon Cloud");
  await page.getByLabel("Short name", { exact: true }).fill("AC");
  await page.getByLabel("Official URL", { exact: true }).fill("https://example.test");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  row = page.getByRole("region", { name: "Amazon Cloud", exact: true });
  await row.waitFor();
  assert.equal(providers[0].websiteUrl, "https://example.test");
  const catalogLoads = () => apiRequests.filter(path => path.endsWith("/practice-catalog")).length;
  const catalogLoadsBeforeArchive = catalogLoads();
  await row.getByRole("button", { name: "Archive", exact: true }).click();
  await row.waitFor({ state: "detached" });
  await page.waitForFunction(() => window.store.state.exams.find(e => e.id === "exam").providers.length === 0);
  assert.equal(await page.locator(".admin-provider-pill").filter({ hasText: "AC" }).count(), 0);
  // With its only provider archived, the exam moves to "Other", which a pill
  // can still select, instead of an archived group no pill reaches.
  const otherGroup = page.locator(".admin-provider-group").filter({ has: page.locator(".admin-provider-group-head", { hasText: /^Other/ }) });
  assert.equal(await otherGroup.getByText("Solutions Architect Professional", { exact: true }).count(), 1, "an exam whose provider is archived must be listed under Other");
  assert.equal(catalogLoads(), catalogLoadsBeforeArchive, "a provider change must refresh the exam list, not reload the question catalog");
  await page.getByLabel("Show archived providers").check();
  await row.getByText("archived", { exact: true }).waitFor();
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/providers-phone.png` });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await row.getByRole("button", { name: "Restore", exact: true }).click();
  await row.getByText("active", { exact: true }).waitFor();
  await page.waitForFunction(() => window.store.state.exams.find(e => e.id === "exam").providers[0]?.shortName === "AC");
  page.once("dialog", dialog => dialog.dismiss());
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  assert.equal(providerDeletes, 0, "cancelling confirmation must not call DELETE");
  page.once("dialog", dialog => dialog.accept());
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Archive it instead" }).waitFor();
  await row.waitFor();
  console.log("PASS phone provider management: edit, archive/restore, live selector refresh, confirmation and referenced-delete error");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Solutions Architect Professional.*Open/ }).click();
  await page.getByRole("button", { name: "New provider", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Temporary provider");
  await page.getByLabel("Short name", { exact: true }).fill("TMP");
  await page.getByLabel("Icon", { exact: true }).setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: Buffer.from("fixture") });
  failNextIcon = true;
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Provider saved, but its icon could not be updated" }).waitFor();
  assert.equal(providerCreates, 1);
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await layer.waitFor({ state: "detached" });
  assert.equal(providerCreates, 1, "retrying a failed icon upload must reuse the created provider");
  await page.getByRole("button", { name: "Manage providers", exact: true }).click();
  row = page.getByRole("region", { name: "Temporary provider", exact: true });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Remove current icon").check();
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await row.waitFor();
  assert.equal(providers.find(p => p.shortName === "TMP").iconUrl, null);
  page.once("dialog", dialog => dialog.accept());
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.waitFor({ state: "detached" });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".admin-provider-toggle").filter({ hasText: "Temporary provider" }).count(), 0);
  console.log("PASS exam-detail provider creation, icon retry without duplication, icon removal and safe deletion");

  // Issue #95: an exam's details are edited after creation through the same
  // PATCH the format card uses, sending only what changed, and a slug change
  // has to be confirmed because links and imports outside the app use it.
  const details = page.locator(".admin-modal");
  const save = details.getByRole("button", { name: "Save details", exact: true });
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  assert.equal(await details.getByLabel("Name", { exact: true }).inputValue(), "Solutions Architect Professional");
  assert.equal(await details.getByLabel("Slug", { exact: true }).inputValue(), "sap-c02");
  assert.equal(await save.isDisabled(), true, "an unchanged form must not be savable");
  await details.getByLabel("Name", { exact: true }).fill("Solutions Architect Pro");
  await details.getByLabel("Subject", { exact: true }).fill("Architecture");
  await details.getByLabel("Description", { exact: true }).fill("Design for complex organisations.");
  await details.getByLabel("Pass mark (%)", { exact: true }).fill("72");
  await details.getByLabel("Slug", { exact: true }).fill("Bad Slug");
  await details.getByRole("alert").filter({ hasText: "hyphen-separated" }).waitFor();
  assert.equal(await save.isDisabled(), true, "an invalid slug must not be savable");
  await details.getByLabel("Slug", { exact: true }).fill("clf-c02");
  const confirmSlug = details.getByRole("checkbox", { name: /Change the slug to/ });
  await details.getByText("Links that use sap-c02 stop working", { exact: false }).waitFor();
  assert.equal(await save.isDisabled(), true, "a slug change must be confirmed first");
  await confirmSlug.check();
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/exam-details-phone.png` });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await save.click();
  await details.getByRole("alert").filter({ hasText: "An exam with this slug already exists" }).waitFor();
  await details.getByLabel("Slug", { exact: true }).fill("aws-sap-c02");
  assert.equal(await confirmSlug.isChecked(), false, "editing the slug again must ask for a fresh confirmation");
  await confirmSlug.check();
  await save.click();
  await layer.waitFor({ state: "detached" });
  assert.deepEqual(examPatches.at(-1), {
    name: "Solutions Architect Pro", slug: "aws-sap-c02", subject: "Architecture",
    description: "Design for complex organisations.", passMarkPct: 72
  });
  await page.getByRole("heading", { name: "Solutions Architect Pro", exact: true }).waitFor();
  const meta = page.locator(".admin-detail-meta");
  for (const text of ["aws-sap-c02", "Subject · Architecture", "Pass mark · 72%"]) await meta.getByText(text, { exact: true }).waitFor();
  await page.getByText("Design for complex organisations.", { exact: true }).waitFor();
  await page.waitForFunction(() => window.store.state.exams.find(e => e.id === "exam")?.slug === "aws-sap-c02");

  // Blank optional fields clear their value, and nothing else is resent.
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await details.getByLabel("Subject", { exact: true }).fill("");
  await details.getByLabel("Pass mark (%)", { exact: true }).fill("");
  await save.click();
  await layer.waitFor({ state: "detached" });
  assert.deepEqual(examPatches.at(-1), { subject: null, passMarkPct: null });
  await meta.getByText("Subject · —", { exact: true }).waitFor();
  assert.equal(await meta.getByText(/^Pass mark/).count(), 0);
  await page.getByRole("button", { name: "All exams" }).click();
  await page.getByRole("button", { name: /Solutions Architect Pro.*aws-sap-c02/ }).waitFor();
  console.log("PASS exam details: prefilled edit, slug validation and confirmation, conflict error, changed-fields PATCH, clearing, live refresh");

  assert.deepEqual(errors, []);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
