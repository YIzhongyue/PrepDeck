// Optional integration suite: actual React screens and editor against a local,
// deterministic HTTP fixture. No real account, database, or external API is used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";

const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import("playwright");
const web = fileURLToPath(new URL("../", import.meta.url));
const { outputFiles } = await build({ stdin: { contents: `
  import React, { useEffect } from 'react'; import { createRoot } from 'react-dom/client';
  import { PrepDeckProvider, usePrepDeck } from './src/store/PrepDeckContext';
  import KnowledgePoints from './src/screens/KnowledgePoints';
  import PracticeLive from './src/screens/PracticeLive'; import LearningLive from './src/screens/LearningLive';
  import MockSetup from './src/screens/MockSetup'; import MockLive from './src/screens/MockLive'; import MockResults from './src/screens/MockResults';
  import { breakpointsFor } from './src/lib/responsive';
  import './src/styles/tokens.css'; import './src/styles/app.css';
  function Fixture() { const app=usePrepDeck(); window.fixtureApp=app;
    useEffect(() => app.go('knowledgePoints'), []);
    return <main data-pd-theme={app.state.theme} style={{minHeight:'100vh',background:'var(--color-bg)',color:'var(--color-text)',padding:16}}>
      <nav><button onClick={()=>app.go('knowledgePoints')}>Fixture notes</button><button onClick={()=>app.go('dash')}>Fixture dashboard</button></nav>
      {app.state.actionError && <p role="alert">{app.state.actionError}</p>}
      {app.state.screen==='knowledgePoints' && <KnowledgePoints bp={breakpointsFor(app.width)}/>}
      {app.state.screen==='practice' && app.state.pStage==='live' && <PracticeLive bp={breakpointsFor(app.width)}/>}
      {app.state.screen==='learning' && app.state.lStage==='live' && <LearningLive bp={breakpointsFor(app.width)}/>}
      {app.state.screen==='mock' && (app.state.mStage==='results' ? <MockResults/> : app.state.mStage==='live' ? <MockLive bp={breakpointsFor(app.width)}/> : <MockSetup bp={breakpointsFor(app.width)}/>)}
    </main>;
  }
  createRoot(document.getElementById('root')).render(<PrepDeckProvider><Fixture/></PrepDeckProvider>);
`, loader: "tsx", resolveDir: web }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });

let png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yacoAAAAASUVORK5CYII=", "base64");
const body = '# Access policies\n\n**Bold concept** and *careful reasoning*.\n\n> Private study note\n\n- Identity\n- Resource\n\n| Policy | Scope |\n| --- | --- |\n| IAM | Account |\n\n```typescript\nconst policy = "deny";\n```\n\n```mermaid\nflowchart TD\n  A[Identity] --> B[Policy]\n```\n\n![Policy screenshot](/api/kp-images/picture)\n\nPreserve <span data-example="raw">inline HTML</span> here.\n';
const note = (id, title, markdown = "") => ({ id, title, bodyMarkdown: markdown, groupId: "group", groupName: "Cloud fundamentals", tags: [], linkedQuestions: [], images: [], position: 1024, revision: 1, createdAt: "2026-09-19T00:00:00Z", updatedAt: "2026-09-19T00:00:00Z" });
let notes = [note("a", "Access policies", body), note("b", "Service boundaries", "Second note body"), note("c", "Recovery drills", "Third note body")];
let order = ["a", "b", "c"], orderRevision = 1, writes = [], questionNotes = [], creations = 0;
let failSave = 0, delaySave = 0, failUpload = false, uploadGate = null, metadataGate = null, failReorder = false, failLink = false, mockStarts = 0;
let concurrentWrites = 0, maxConcurrentWrites = 0;
let failDelete = false, deleteGate = null, deleteRequests = 0;
const q = id => ({ id, externalId: id, sequenceNumber: id === "Q1" ? 1 : 2, type: "single_choice", chooseCount: 1, stem: `Question ${id}`, options: [{ id: "A", text: "Identity" }, { id: "B", text: "Resource" }], tags: [], difficulty: "easy" });
const summary = n => ({ ...n, excerpt: n.bodyMarkdown.slice(0, 90), linkedQuestionCount: n.linkedQuestions.length, imageCount: n.images.length, diagramCount: 1 });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://fixture");
    const path = url.pathname;
    const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    if (path === "/fixture.js" || path === "/fixture.css") { res.setHeader("Content-Type", path.endsWith("css") ? "text/css" : "text/javascript"); return res.end(outputFiles.find(f => f.path.endsWith(path.slice(1)))?.contents); }
    if (!path.startsWith("/api/")) { res.setHeader("Content-Type", "text/html"); return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
    if (path.startsWith("/api/kp-images/") && req.method === "GET") { res.setHeader("Content-Type", "image/png"); return res.end(png); }
    let raw = Buffer.alloc(0); for await (const part of req) raw = Buffer.concat([raw, part]);
    const input = req.headers["content-type"]?.startsWith("image/") ? {} : JSON.parse(raw.toString() || "{}");
    if (path === "/api/auth/me") return json(200, { user: { id: "me", displayName: "Student", role: "user" } });
    if (path === "/api/exams") return json(200, { exams: [{ id: "exam", slug: "cloud", name: "Cloud fundamentals" }] });
    if (path.includes("practice-catalog")) return json(200, { questions: [q("Q1"), q("Q2")], bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
    if (path === "/api/attempts/active") return json(200, { attempt: null });
    if (path.endsWith("/learning/progress")) return json(200, { progress: { lastSequenceNumber: null } });
    if (path.endsWith("/learning-detail")) return json(200, { question: { ...q("Q1"), correctAnswers: ["A"], explanation: "Explanation" }, history: [] });
    if (path.endsWith("/ai-explanations")) return json(200, { explanations: [] });
    if (path === "/api/annotations") return json(200, { annotations: [] });
    if (path === "/api/notes") return json(200, { notes: [] });
    if (path === "/api/settings") return json(200, { showSharedNotes: true });
    if (path === "/api/annotation-settings") return json(200, { hl1Alias: "Important", hl2Alias: "Review", hl3Alias: "Question" });
    if (path === "/api/daily-email-settings") return json(200, { enabled: false });
    if (path === "/api/knowledge-point-groups") return json(200, { groups: [{ id: "group", name: "Cloud fundamentals", noteCount: notes.length }], ungroupedCount: 0 });
    if (path === "/api/knowledge-point-tags") return json(200, { tags: [{ id: "tag", name: "Cloud", noteCount: 0 }] });
    if (path === "/api/knowledge-points/linkable-questions") return json(200, { questions: [{ questionId: "Q1", examId: "exam", examSlug: "cloud", examName: "Cloud fundamentals", externalId: "Q1", stemExcerpt: "Question Q1", linked: false }], total: 1 });
    if (path === "/api/knowledge-points" && req.method === "GET") {
      let rows = order.map(id => notes.find(n => n.id === id)).filter(Boolean);
      if (url.searchParams.get("q")) rows = rows.filter(n => (n.title + n.bodyMarkdown).includes(url.searchParams.get("q")));
      if (url.searchParams.get("sort") === "title") rows.sort((a, b) => a.title.localeCompare(b.title));
      return json(200, { knowledgePoints: rows.map(summary), total: rows.length, limit: 200, offset: 0, orderRevision: url.searchParams.has("groupId") || url.searchParams.has("ungrouped") ? orderRevision : null });
    }
    if (path === "/api/knowledge-points" && req.method === "POST") { const n = note(`new-${++creations}`, "Untitled knowledge point"); notes.push(n); order.push(n.id); return json(201, { knowledgePoint: n }); }
    if (path.startsWith("/api/kp-images/") && req.method === "POST") {
      if (uploadGate) await uploadGate.promise;
      if (failUpload) return json(503, { error: "Upload temporarily unavailable" });
      return json(201, { image: { id: "uploaded", url: "/api/kp-images/uploaded", status: "pending" } });
    }
    if (path.startsWith("/api/knowledge-points/")) {
      const id = path.split("/")[3], n = notes.find(note => note.id === id);
      if (!n) return json(404, { error: "Not found" });
      if (req.method === "GET") return json(200, { knowledgePoint: n });
      if (req.method === "DELETE") {
        // Detaching a tag or unlinking a question returns the updated note
        // (like its POST counterpart), so the editor needs no second fetch.
        const sub = path.split("/").slice(4);
        if (sub[0] === "tags") { n.tags = n.tags.filter(tag => tag.id !== sub[1]); return json(200, { knowledgePoint: n }); }
        if (sub[0] === "questions") { n.linkedQuestions = n.linkedQuestions.filter(q => q.questionId !== sub[1]); return json(200, { knowledgePoint: n }); }
        deleteRequests++;
        if (deleteGate) await deleteGate.promise;
        if (failDelete) return json(503, { error: "Delete temporarily unavailable" });
        notes = notes.filter(note => note.id !== id); order = order.filter(noteId => noteId !== id);
        res.writeHead(204); return res.end();
      }
      if (path.endsWith("/reorder")) {
        if (failReorder) { failReorder = false; return json(503, { error: "Order temporarily unavailable" }); }
        if (input.expectedOrderRevision !== orderRevision) return json(409, { error: "order_conflict" });
        order = order.filter(x => x !== id); order.splice(input.beforeId ? order.indexOf(input.beforeId) : order.length, 0, id); orderRevision++;
        return json(200, { position: order.indexOf(id) * 1024 });
      }
      if (path.endsWith("/tags")) { if (metadataGate) await metadataGate.promise; n.tags.push({ id: `tag-${input.name}`, name: input.name }); return json(201, { knowledgePoint: n }); }
      if (path.endsWith("/questions")) { if (failLink) return json(503, { error: "Link temporarily unavailable" }); n.linkedQuestions.push({ questionId: input.questionId, examId: "exam", examSlug: "cloud", externalId: input.questionId, accessible: true, stemExcerpt: "Question Q1" }); return json(201, { knowledgePoint: n }); }
      if (req.method === "PUT") {
        writes.push({ id, ...input }); concurrentWrites++; maxConcurrentWrites = Math.max(maxConcurrentWrites, concurrentWrites);
        if (delaySave) await new Promise(resolve => setTimeout(resolve, delaySave));
        concurrentWrites--;
        if (failSave) return json(failSave, { error: "Test save failure" });
        if (input.baseRevision !== n.revision) return json(409, { error: "revision_conflict", latest: n });
        Object.assign(n, { title: input.title, bodyMarkdown: input.bodyMarkdown, revision: n.revision + 1, updatedAt: new Date().toISOString() });
        return json(200, { knowledgePoint: n });
      }
    }
    if (path === "/api/exams/exam/attempts") return json(201, { attemptId: input.mode === "mock" ? `mock-${++mockStarts}` : "practice", startedAt: new Date().toISOString() });
    if (/\/api\/attempts\/mock-\d+\/complete/.test(path)) return json(200, { score: 100, passed: true, durationSeconds: 10, totalQuestions: 1, correctCount: 1, breakdown: [{ questionId: "Q1", selectedAnswer: ["A"], correctAnswers: ["A"], isCorrect: true }] });
    if (/\/api\/attempts\/mock-\d+\/answers\//.test(path)) return json(200, {});
    if (path === "/api/attempts/practice/answers") return json(200, { isCorrect: true, correctAnswers: ["A"], explanation: "Explanation" });
    if (path === "/api/attempts/practice/complete") return json(200, {});
    if (/\/api\/questions\/[^/]+\/notes/.test(path)) { const saved = { id: `note-${questionNotes.length}`, questionId: path.split("/")[3], content: input.content, visibility: input.visibility, author: { id: "me", displayName: "Student" }, isMine: true }; questionNotes.push(saved); return json(201, { note: saved }); }
    return json(404, { error: `Unknown fixture route ${req.method} ${path}` });
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, hasTouch: true });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("https://**", route => route.abort());
const url = `http://127.0.0.1:${server.address().port}`;
const wait = async (predicate, label) => { for (let i = 0; i < 160; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error(`Timed out: ${label}`); };
const saved = () => page.getByText(/^Saved ·/).waitFor();
const openA = async () => { await page.getByRole("link", { name: "Access policies", exact: true }).click(); await page.getByRole("textbox", { name: "Knowledge point body", exact: true }).waitFor(); };
async function checkDeletionRecovery() {
  for (const scenario of ["validation", "upload", "pending-save"]) {
    await page.goto(url);
    await page.getByRole("button", { name: "New knowledge point", exact: true }).click();
    const title = page.getByRole("textbox", { name: "Knowledge point title" });
    await title.waitFor(); await saved();
    const id = notes.at(-1).id;
    if (scenario === "validation") {
      await title.fill("   ");
      await page.getByRole("button", { name: "Retry now", exact: true }).waitFor();
      failDelete = true;
    } else if (scenario === "upload") {
      failUpload = true;
      await page.locator('input[type="file"]').setInputFiles({ name: "failed.png", mimeType: "image/png", buffer: png });
      await page.getByRole("button", { name: "Retry upload", exact: true }).waitFor();
    } else {
      failSave = 503; delaySave = 1200; deleteGate = Promise.withResolvers();
      await title.fill("Draft awaiting deletion");
      await wait(() => concurrentWrites === 1, "save in flight before deletion");
    }
    await page.getByRole("button", { name: "Delete this note", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Delete knowledge point" });
    const pendingDelete = deleteRequests;
    await dialog.getByRole("button", { name: "Delete note", exact: true }).click();
    if (scenario === "validation") {
      await dialog.getByText("Could not delete this note. Please retry.").waitFor();
      assert.ok(notes.some(note => note.id === id), "Failed deletion retains the note");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await title.inputValue(), "   ", "Failed deletion retains the unsaved title");
      await page.getByRole("button", { name: "Retry now", exact: true }).waitFor();
      failDelete = false;
      await page.getByRole("button", { name: "Delete this note", exact: true }).click();
      await dialog.getByRole("button", { name: "Delete note", exact: true }).click();
    } else if (scenario === "pending-save") {
      assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
      await page.locator(".dialog-backdrop").click({ position: { x: 2, y: 2 } });
      assert.equal(await dialog.isVisible(), true, "Pending deletion cannot dismiss into a different editor");
      await wait(() => deleteRequests > pendingDelete, "delete waits for the failed in-flight save");
      failSave = 0; delaySave = 0; deleteGate.resolve(); deleteGate = null;
    }
    await page.getByRole("button", { name: "New knowledge point", exact: true }).waitFor();
    assert.ok(!notes.some(note => note.id === id));
    failUpload = false;
    const writesAfterDelete = writes.length;
    await page.getByRole("button", { name: "Fixture dashboard", exact: true }).click();
    await page.waitForFunction(() => window.fixtureApp.state.screen === "dash", null, { timeout: 3000 });
    assert.equal(await page.getByRole("alert").count(), 0, `${scenario}: deleted note cannot block navigation`);
    if (scenario === "pending-save") {
      await page.waitForTimeout(2200);
      assert.equal(writes.length, writesAfterDelete, "Deleted note has no delayed autosave retry");
    }
  }
  console.log("PASS failed save/upload deletion, failed-delete draft retention and pending-delete navigation safety");
}
try {
  png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 480; canvas.height = 180;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#eff6ff"; ctx.fillRect(0, 0, 480, 180);
    ctx.font = "bold 20px system-ui"; ctx.fillStyle = "#172033"; ctx.fillText("Policy evaluation", 24, 34);
    for (const [x, label] of [[24, "Identity"], [188, "Policy"], [352, "Resource"]]) {
      ctx.fillStyle = "#dbeafe"; ctx.fillRect(x, 67, 108, 68); ctx.fillStyle = "#1d4ed8"; ctx.font = "16px system-ui"; ctx.fillText(label, x + 12, 107);
    }
    ctx.fillStyle = "#2563eb"; ctx.fillText("→", 151, 107); ctx.fillText("→", 315, 107);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  await checkDeletionRecovery();
  const beforeOpening = writes.length;
  await page.goto(url); await openA();
  const visual = page.getByRole("textbox", { name: "Knowledge point body", exact: true });
  await saved(); assert.equal(writes.length, beforeOpening, "Opening must not autosave or normalize stored source");
  assert.equal(await visual.locator("strong").filter({ hasText: "Bold concept" }).count(), 1);
  assert.equal(await visual.locator("table tr").count(), 2);
  assert.equal(await page.getByText("Unsupported Markdown — editable source").count(), 1);
  await page.getByRole("textbox", { name: "Image alt text", exact: true }).fill("Account [policy] screenshot");
  await wait(() => notes[0].bodyMarkdown.includes("Account \\[policy\\] screenshot"), "alt text save");
  await saved();
  assert.ok(notes[0].bodyMarkdown.includes('<span data-example="raw">inline HTML</span>'));
  assert.ok(notes[0].bodyMarkdown.includes('```mermaid\nflowchart TD'));
  assert.ok(notes[0].bodyMarkdown.includes('```typescript\nconst policy = "deny";'));
  await page.getByRole("button", { name: "View larger image", exact: true }).click();
  await page.getByRole("dialog", { name: "Enlarged image" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Preview diagram", exact: true }).click();
  await page.getByRole("button", { name: "View larger diagram", exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit diagram source", exact: true }).click();
  await visual.locator("td").first().click();
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  assert.equal(await visual.locator("table tr").count(), 3);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  assert.equal(await visual.locator("table th").count(), 3);
  await saved();
  await page.getByRole("link", { name: "All notes", exact: true }).click(); await openA();
  assert.equal(await visual.locator("table tr").count(), 3);
  assert.equal(await visual.locator("table th").count(), 3);
  assert.equal(await page.getByRole("textbox", { name: "Image alt text" }).inputValue(), "Account [policy] screenshot");
  console.log("PASS visual Markdown/table/image/Mermaid/raw-source roundtrip");

  // An ordinary edit stays undoable after the server acknowledges autosave.
  await visual.locator("p").first().click(); await page.keyboard.press("End");
  await page.keyboard.type(" undo survives"); await wait(() => notes[0].bodyMarkdown.includes("undo survives"), "undo test save");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await wait(() => !notes[0].bodyMarkdown.includes("undo survives"), "undo after save");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await wait(() => notes[0].bodyMarkdown.includes("undo survives"), "redo after save");
  const preComposition = writes.length;
  await visual.locator("p").first().click(); await page.keyboard.press("End");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "中文", selectionStart: 2, selectionEnd: 2 });
  await new Promise(resolve => setTimeout(resolve, 1200)); assert.equal(writes.length, preComposition, "No partial IME autosave");
  await cdp.send("Input.insertText", { text: "中文日本語" });
  await cdp.detach();
  await wait(() => notes[0].bodyMarkdown.includes("中文日本語"), "completed composition save");
  console.log("PASS IME composition and undo/redo across autosave");

  // Failed saves retain text, block navigation, and can be explicitly retried.
  failSave = 422;
  await page.getByRole("textbox", { name: "Knowledge point title", exact: true }).fill("Retained title");
  await page.getByText("Save failed — Retry", { exact: true }).waitFor();
  const attempts = writes.length; await new Promise(resolve => setTimeout(resolve, 2100)); assert.equal(writes.length, attempts, "Do not retry validation errors");
  await page.getByRole("link", { name: "All notes", exact: true }).click();
  await page.locator('p[role="alert"]').filter({ hasText: "Test save failure" }).waitFor(); assert.equal(await visual.count(), 1);
  failSave = 0; await page.getByRole("button", { name: "Retry now", exact: true }).click(); await saved();
  assert.equal(notes[0].title, "Retained title");
  notes[0].revision++; notes[0].bodyMarkdown += "\n\nRemote edit";
  await page.getByRole("textbox", { name: "Knowledge point title", exact: true }).fill("My local title");
  await page.getByRole("button", { name: "Keep mine", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Knowledge point title" }).inputValue(), "My local title");
  await page.getByRole("button", { name: "Keep mine", exact: true }).click(); await saved();
  assert.equal(notes[0].title, "My local title");
  await page.getByRole("textbox", { name: "Knowledge point title" }).fill("Access policies"); await saved();
  notes[0].revision++; notes[0].bodyMarkdown += "\n\nRemote text before metadata";
  await page.getByRole("textbox", { name: "Knowledge point title" }).fill("Local metadata race");
  await page.getByPlaceholder("Add tag…").fill("Race"); await page.getByPlaceholder("Add tag…").press("Enter");
  await page.getByRole("button", { name: "Keep mine", exact: true }).waitFor();
  assert.ok(notes[0].bodyMarkdown.includes("Remote text before metadata"), "Metadata acknowledgement must not bypass the content revision conflict");
  await page.getByRole("button", { name: "Reload latest", exact: true }).click();
  await saved();
  assert.ok((await visual.innerText()).includes("Remote text before metadata"));
  delaySave = 1600;
  await page.getByRole("textbox", { name: "Knowledge point title" }).fill("Slow first");
  await wait(() => concurrentWrites === 1, "slow write starts");
  await page.getByRole("textbox", { name: "Knowledge point title" }).fill("Access policies");
  await wait(() => notes[0].title === "Access policies" && concurrentWrites === 0, "latest slow edit saved");
  assert.equal(maxConcurrentWrites, 1); delaySave = 0;
  console.log("PASS validation/retry, conflict recovery and serialized slow saves");

  // Uploaded references are inserted into the original note and Saved waits.
  uploadGate = Promise.withResolvers();
  await page.locator('input[type="file"]').setInputFiles({ name: "screen.png", mimeType: "image/png", buffer: png });
  await page.getByText("Uploading image…", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Markdown source", exact: true }).isDisabled(), true, "Pending uploads cannot publish into a stale hidden visual document");
  assert.equal(await page.getByRole("button", { name: "Image", exact: true }).isDisabled(), true, "Finish one upload before adding another");
  await visual.press("Control+End"); await page.keyboard.type(" text during upload");
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(await page.getByText(/^Saved ·/).count(), 0);
  assert.equal(await page.locator("[data-kp-upload]").count(), 1, "Typing during upload retains its insertion placeholder");
  uploadGate.resolve(); uploadGate = null;
  await wait(() => notes[0].bodyMarkdown.includes("/api/kp-images/uploaded"), "attachment reference saved"); await saved();
  assert.ok(notes[0].bodyMarkdown.includes("text during upload"));
  await page.getByRole("button", { name: "Markdown source", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
  await source.fill((await source.inputValue()) + "\n\nSource edit after upload"); await saved();
  assert.ok(notes[0].bodyMarkdown.includes("Source edit after upload"));
  await page.getByRole("button", { name: "Write", exact: true }).click();
  failUpload = true;
  await page.locator('input[type="file"]').setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Retry upload" }).waitFor();
  assert.equal(await page.getByText(/^Saved ·/).count(), 0);
  failUpload = false; await page.getByRole("button", { name: "Retry upload" }).click(); await saved();
  console.log("PASS pending/failed uploads, retry and saved status");

  metadataGate = Promise.withResolvers();
  await page.getByPlaceholder("Add tag…").fill("Cloud");
  await page.getByPlaceholder("Add tag…").press("Enter");
  await page.getByRole("link", { name: "All notes", exact: true }).click();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await page.getByRole("textbox", { name: "Knowledge point title" }).inputValue(), "Access policies", "Navigation waits for metadata acknowledgement");
  assert.equal(await page.getByText(/^Saved ·/).count(), 0);
  metadataGate.resolve(); metadataGate = null;
  await page.getByRole("link", { name: "Service boundaries", exact: true }).click();
  await page.getByRole("textbox", { name: "Knowledge point title" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Knowledge point title" }).inputValue(), "Service boundaries");
  assert.equal(notes[0].title, "Access policies");
  console.log("PASS metadata status/navigation prevents stale responses crossing note identity");

  // Library order uses a CAS revision; failed/conflicting writes cannot clobber it.
  await page.getByRole("link", { name: "All notes", exact: true }).click();
  await page.getByRole("button", { name: /^Cloud fundamentals/ }).click();
  await page.getByRole("button", { name: "Move Service boundaries up" }).click();
  await wait(() => order[0] === "b", "move up");
  await page.getByRole("button", { name: "Move Service boundaries up" }).isDisabled();
  failReorder = true;
  await page.getByRole("button", { name: "Move Recovery drills up" }).click();
  await page.getByText(/Could not save the new order/).waitFor(); assert.deepEqual(order, ["b", "a", "c"]);
  orderRevision++;
  await page.getByRole("button", { name: "Move Recovery drills up" }).click();
  await page.getByText(/The order changed in another tab/).waitFor(); assert.deepEqual(order, ["b", "a", "c"]);
  await page.getByRole("button", { name: "Title", exact: true }).click();
  await page.getByRole("button", { name: "Custom order", exact: true }).click();
  assert.deepEqual(order, ["b", "a", "c"]);
  await page.getByRole("link", { name: "Service boundaries", exact: true }).click();
  await page.getByRole("button", { name: "Next in Cloud fundamentals" }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Knowledge point title"]')?.value === "Access policies");
  assert.equal(await page.getByRole("textbox", { name: "Knowledge point title" }).inputValue(), "Access policies");
  console.log("PASS order persistence/failure/conflict and previous/next sequence");

  // Review links do not create attempts; live practice input retains normal keys.
  await page.getByRole("button", { name: "Link a question", exact: true }).click();
  await page.getByRole("dialog", { name: "Link a question", exact: true }).getByRole("button", { name: "Link", exact: true }).click();
  await page.getByRole("dialog", { name: "Link a question", exact: true }).getByText("Linked", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.waitForFunction(() => window.fixtureApp.state.screen === "learning" && window.fixtureApp.state.lStage === "live");
  assert.equal(await page.evaluate(() => window.fixtureApp.state.attemptId), null);
  await page.evaluate(() => window.fixtureApp.begin(["Q1", "Q2"]));
  await page.waitForFunction(() => window.fixtureApp.state.screen === "practice");
  assert.equal(await page.getByRole("button", { name: "Link existing", exact: true }).count(), 0, "Live answering hides related-note hints");
  await page.getByRole("button", { name: /Identity/ }).click();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  const draft = page.getByPlaceholder("Write a note for this question…"); await draft.waitFor();
  assert.equal(await page.getByRole("button", { name: "Link existing", exact: true }).count(), 1, "Graded review exposes related notes");
  await draft.fill(""); await draft.pressSequentially("abcd1234"); await draft.press("Enter");
  assert.equal(await draft.inputValue(), "abcd1234\n");
  assert.equal(await page.evaluate(() => window.fixtureApp.state.idx), 0);
  await page.getByRole("button", { name: "Next question", exact: true }).click();
  await page.waitForFunction(() => window.fixtureApp.state.idx === 1);
  assert.equal(questionNotes.at(-1).questionId, "Q1");
  assert.equal(questionNotes.at(-1).content, "abcd1234\n");
  console.log("PASS review boundary, editable-field hotkeys and note ownership on Next");

  await page.evaluate(() => window.fixtureApp.go("mock"));
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page.waitForFunction(() => window.fixtureApp.state.mStage === "live");
  assert.equal(await page.getByRole("button", { name: "Link existing", exact: true }).count(), 0, "Mock answering hides review shortcuts");
  const activeMockId = await page.evaluate(() => window.fixtureApp.state.mockAttemptId);
  await page.getByRole("button", { name: "Fixture dashboard", exact: true }).click();
  await page.waitForFunction(() => window.fixtureApp.state.screen === "dash");
  await page.evaluate(() => window.fixtureApp.go("mock"));
  await page.waitForFunction(() => window.fixtureApp.state.screen === "mock");
  assert.equal(await page.evaluate(() => window.fixtureApp.state.mStage), "live");
  assert.equal(await page.evaluate(() => window.fixtureApp.state.mockAttemptId), activeMockId);
  assert.equal(mockStarts, 1, "Returning to an active mock resumes the same attempt");
  await page.evaluate(() => window.fixtureApp.finishMock());
  await page.getByRole("button", { name: "Knowledge points", exact: true }).click();
  failLink = true;
  const beforeReviewCreation = creations;
  await page.getByRole("button", { name: "+ New note", exact: true }).click();
  await page.getByText(/Could not create and link your note/).waitFor();
  failLink = false;
  await page.getByRole("button", { name: "+ New note", exact: true }).click();
  await page.getByRole("textbox", { name: "Knowledge point title" }).waitFor();
  assert.equal(creations, beforeReviewCreation + 1, "Retrying a review link keeps the originally created draft");
  assert.equal(notes.at(-1).linkedQuestions[0].questionId, "Q1");
  await page.evaluate(() => window.fixtureApp.go("mock"));
  await page.getByRole("button", { name: "New mock", exact: true }).click();
  await page.getByRole("button", { name: "Begin exam", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureApp.state.mStage), "setup");
  assert.equal(mockStarts, 1, "New mock opens setup without prematurely creating an attempt");
  console.log("PASS mock review note linking/retry, active attempt resume and New mock setup");

  // The same actual screens are exercised at 375px under every supported theme.
  await page.getByRole("button", { name: "Fixture notes", exact: true }).click(); await openA();
  await page.getByRole("button", { name: "Preview diagram", exact: true }).click();
  await page.getByRole("button", { name: "View larger diagram", exact: true }).waitFor();
  const screenshotDir = process.env.KP_SCREENSHOTS;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const theme of ["light", "cream", "sage", "clay", "dusk"]) {
    await page.evaluate(theme => window.fixtureApp.setTheme(theme), theme);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(100);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${theme} ${width}px has page overflow`);
      assert.ok(await page.locator(".kp-editor").evaluate(el => el.getBoundingClientRect().bottom <= el.parentElement.getBoundingClientRect().bottom + 1), `${theme} ${width}px editor is clipped vertically`);
      if (screenshotDir && (width === 375 || theme === "light")) await page.screenshot({ path: resolve(screenshotDir, `kp-editor-${theme}-${width}.png`), fullPage: true });
    }
  }
  for (const theme of ["light", "cream", "sage", "clay", "dusk"]) {
    await page.evaluate(theme => window.fixtureApp.setTheme(theme), theme);
    for (const label of ["Link a question", "View larger image", "View larger diagram"]) {
      await page.getByRole("button", { name: label, exact: true }).first().click();
      const dialog = page.getByRole("dialog"); await dialog.waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${theme} 375px ${label} dialog overflow`);
      await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
      assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), `${label} retains keyboard focus`);
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    }
  }
  await page.getByRole("link", { name: "All notes", exact: true }).click();
  await page.getByRole("button", { name: /^Cloud fundamentals/ }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "375px library overflow");
  if (screenshotDir) await page.screenshot({ path: resolve(screenshotDir, "kp-library-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Move Recovery drills up" }).tap();
  await wait(() => order[1] === "c", "touch move control");
  await page.getByRole("button", { name: "Move Recovery drills up" }).waitFor({ state: "visible" });
  await page.waitForTimeout(150);
  const beforeDrag = order.join(",");
  const firstGrip = page.getByRole("button", { name: "Reorder Service boundaries with arrow keys, or drag" });
  await firstGrip.scrollIntoViewIfNeeded();
  const grip = await firstGrip.boundingBox();
  const touch = await page.context().newCDPSession(page);
  const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let distance = 20; distance <= 260; distance += 20) {
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + distance }] });
    await page.waitForTimeout(20);
  }
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await wait(() => order.join(",") !== beforeDrag, "native touch drag order");
  await touch.detach();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  for (const theme of ["light", "cream", "sage", "clay", "dusk"]) {
    await page.evaluate(theme => window.fixtureApp.setTheme(theme), theme);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${theme} 375px group management overflow`);
  }
  console.log("PASS 375px/desktop all themes, mobile library/manage and native touch ordering");

  await page.getByRole("link", { name: "Knowledge points", exact: true }).click();
  await page.getByRole("button", { name: "New knowledge point", exact: true }).focus(); await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Knowledge point title" }).waitFor();
  const created = creations, beforeBlank = writes.length;
  await page.getByRole("textbox", { name: "Knowledge point title" }).fill("   ");
  await visual.fill("Retained new note body");
  await page.getByText("A title is required before this note can be saved.").waitFor();
  await page.waitForTimeout(1200); assert.equal(writes.length, beforeBlank, "Blank title never reaches the server");
  failSave = 503;
  await page.getByRole("textbox", { name: "Knowledge point title" }).fill("Draft capture");
  await page.getByRole("button", { name: "Retry now", exact: true }).waitFor();
  failSave = 0; await page.getByRole("button", { name: "Retry now", exact: true }).click(); await saved();
  assert.equal(creations, created, "First content-save retry uses the existing stable note ID");
  assert.equal(notes.at(-1).bodyMarkdown, "Retained new note body");
  const paste = text => visual.evaluate((el, text) => { const data = new DataTransfer(); data.setData("text/plain", text); el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data })); }, text);
  const plainTextOffer = page.getByRole("button", { name: "Paste as plain text instead", exact: true });
  const selectOldParagraph = async () => {
    // Filling a rich document's DOM retains its heading type. Reset through
    // the source UI so this case starts with exactly one ordinary paragraph.
    await page.getByRole("button", { name: "Markdown source", exact: true }).click();
    await source.fill("Old paragraph");
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await saved();
    // Synthetic paste does not wait for native selectionchange. Set the model
    // selection, then verify that the browser selected the intended text too.
    await visual.evaluate(el => el.editor.chain().focus().setTextSelection({ from: 1, to: 4 }).run());
    await page.waitForFunction(() => window.getSelection()?.toString() === "Old");
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "Old");
  };
  const reopenDraft = async () => {
    await page.getByRole("link", { name: "All notes", exact: true }).click();
    await page.getByRole("link", { name: "Draft capture", exact: true }).click();
    await visual.waitFor();
  };
  // A paste lands immediately; the banner only offers the other reading of it.
  await visual.fill(""); await paste("## Pasted section\n\n**Formatted content**");
  assert.equal(await visual.locator("h2").innerText(), "Pasted section", "Paste applies without waiting on a choice");
  await plainTextOffer.waitFor();
  await visual.press("Control+End"); await visual.press("Enter"); await paste("**literal example**");
  assert.equal(await visual.locator("strong").filter({ hasText: "literal example" }).count(), 1);
  await plainTextOffer.click();
  assert.ok((await visual.innerText()).includes("**literal example**"));
  assert.equal(await visual.locator("strong").filter({ hasText: "literal example" }).count(), 0);
  await saved();
  await selectOldParagraph();
  await paste("NEW"); await plainTextOffer.waitFor();
  await page.keyboard.type("X");
  // Withdrawing the offer must never withdraw the pasted CONTENT: typing
  // after a paste used to discard the clipboard text entirely.
  assert.equal(await plainTextOffer.count(), 0, "A later edit withdraws the stale plain-text offer");
  assert.equal((await visual.innerText()).trimEnd(), "NEWX paragraph", "The paste itself survives typing after it");
  await saved();
  assert.equal(notes.at(-1).bodyMarkdown, "NEWX paragraph", "Pasted text reaches the server as one paragraph");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await wait(() => notes.at(-1).bodyMarkdown === "Old paragraph", "undo paste after autosave");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await wait(() => notes.at(-1).bodyMarkdown === "NEWX paragraph", "redo paste after autosave");
  await reopenDraft();
  assert.equal((await visual.innerText()).trimEnd(), "NEWX paragraph");

  await selectOldParagraph(); await paste("Old"); await plainTextOffer.waitFor();
  await page.keyboard.type("X"); await plainTextOffer.waitFor({ state: "hidden" });
  assert.equal((await visual.innerText()).trimEnd(), "OldX paragraph", "Typing after an identical paste withdraws its stale alternative");
  await saved();
  assert.equal(notes.at(-1).bodyMarkdown, "OldX paragraph");

  await selectOldParagraph();
  // Keep both transactions inside the history grouping window even on slow CI.
  // Do not wait for autosave before accepting the alternative.
  await page.clock.setFixedTime(new Date());
  await paste("**NEW**"); await plainTextOffer.click();
  await page.clock.setSystemTime(new Date());
  assert.equal((await visual.innerText()).trimEnd(), "**NEW** paragraph");
  assert.equal(await visual.locator("strong").count(), 0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await visual.innerText()).trimEnd(), "NEW paragraph", "One undo restores the formatted paste, without a half-undone literal mark");
  assert.equal(await visual.locator("strong").innerText(), "NEW");
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await saved();
  assert.equal((await visual.innerText()).trimEnd(), "**NEW** paragraph");
  assert.equal(await visual.locator("strong").count(), 0);

  await selectOldParagraph();
  await visual.press("Control+a");
  assert.equal(await visual.evaluate(el => el.editor.state.selection.toJSON().type), "all", "Ctrl+A creates an AllSelection");
  await paste("**NEW**"); await plainTextOffer.click();
  assert.equal(await visual.evaluate(el => el.editor.state.selection.from), 8, "The caret accounts for the inserted paragraph wrapper");
  // Tiptap restores DOM focus on the next animation frame after the click.
  await page.waitForFunction(() => document.activeElement === document.querySelector('[aria-label="Knowledge point body"]'));
  await page.keyboard.type("X");
  assert.equal((await visual.innerText()).trimEnd(), "**NEW**X", "Whole-document paste leaves the caret after all literal text");
  assert.equal(await visual.locator("strong").count(), 0);
  await saved(); await reopenDraft();
  assert.equal((await visual.innerText()).trimEnd(), "**NEW**X", "Whole-document literal paste survives autosave and reopening");

  for (const [markdown, selector, text] of [["# Heading", "h1", "Heading"], ["- item", "li", "item"], ["> quote", "blockquote", "quote"]]) {
    await selectOldParagraph(); await paste(markdown); await plainTextOffer.waitFor();
    assert.equal((await visual.locator(selector).innerText()).trim(), text, "Single Markdown blocks retain their type");
    await plainTextOffer.click();
    assert.equal((await visual.innerText()).trimEnd(), `${markdown} paragraph`, "The alternative restores the surrounding paragraph");
    assert.equal(await visual.locator(selector).count(), 0);
    await saved(); await reopenDraft();
    assert.equal((await visual.innerText()).trimEnd(), `${markdown} paragraph`, "Literal block syntax survives reopening");
    assert.equal(await visual.locator(selector).count(), 0);
  }

  await selectOldParagraph(); await paste("**NEW**"); await plainTextOffer.waitFor();
  notes.at(-1).bodyMarkdown = "REMOTE content is authoritative"; notes.at(-1).revision++;
  await page.getByRole("button", { name: "Reload latest", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Knowledge point body"]')?.textContent === "REMOTE content is authoritative");
  await plainTextOffer.waitFor({ state: "hidden" });
  assert.equal(await plainTextOffer.count(), 0, "Reloading another revision withdraws the old paste range");
  assert.equal(notes.at(-1).bodyMarkdown, "REMOTE content is authoritative");
  await page.getByRole("button", { name: "Markdown source", exact: true }).click();
  await source.fill("Before Old after");
  await page.getByRole("button", { name: "Write", exact: true }).click(); await saved();
  await visual.evaluate(el => el.editor.chain().focus().setTextSelection({ from: 8, to: 11 }).run());
  await page.waitForFunction(() => window.getSelection()?.toString() === "Old");
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "Old");
  await paste("   "); await saved();
  assert.equal(notes.at(-1).bodyMarkdown, "Before     after", "Whitespace-only paste replaces the selection with the clipboard spaces");
  console.log("PASS paragraph paste, single-transaction alternative undo, literal block reopen and conflict reload safety");
  const literalFence = "```prepdeck-source\n# Literal code\n```";
  const linkedImage = "[![linked screenshot](https://example.test/image.png)](https://example.test/page)";
  await page.getByRole("button", { name: "Markdown source", exact: true }).click();
  await source.fill(`${literalFence}\n\n${linkedImage}\n\nEditable text`);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await visual.press("Control+End"); await page.keyboard.type(" updated"); await saved();
  assert.ok(notes.at(-1).bodyMarkdown.includes(literalFence), "Literal code cannot collide with the internal source marker");
  assert.ok(notes.at(-1).bodyMarkdown.includes(linkedImage), "Linked images retain their target URL after visual edits");
  await page.getByRole("button", { name: "Mermaid", exact: true }).click();
  await page.locator('[aria-label="Code source"]').fill("this is not valid Mermaid !!!");
  await page.getByRole("button", { name: "Preview diagram", exact: true }).click();
  await page.getByText(/Diagram didn.*render/).waitFor();
  await page.getByRole("button", { name: "Edit diagram source", exact: true }).click();
  await page.locator('[aria-label="Code source"]').fill("x".repeat(12001));
  await page.getByRole("button", { name: "Preview diagram", exact: true }).click();
  await page.getByText(/Diagram is too large/).waitFor(); await saved();
  console.log("PASS keyboard creation, blank validation, first-save identity, Markdown/plain paste and diagram error isolation");
  assert.deepEqual(errors, [], "No unhandled browser errors");
  console.log(`Knowledge Points browser regression passed (${writes.length} acknowledged/failed save attempts exercised).`);
} finally { uploadGate?.resolve(); metadataGate?.resolve(); deleteGate?.resolve(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
