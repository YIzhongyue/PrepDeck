// Real React provider/hooks and Chromium tabs; only the HTTP backend is synthetic.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { readBody, waitUntil } from "./browser-fixture.mjs";

const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import("playwright");
const web = fileURLToPath(new URL("../", import.meta.url));
const { outputFiles } = await build({ stdin: { contents: `
  import React, { useEffect } from 'react';
  import { createRoot } from 'react-dom/client';
  import { PrepDeckProvider, usePrepDeck } from './src/store/PrepDeckContext';
  import { apiFetch } from './src/lib/api';
  import { clearSessionKey, hasStoredEncryptedKey } from './src/lib/keyStorage';
  function Probe() { const app = usePrepDeck(); useEffect(() => { window.app = app; }); return null; }
  const root = createRoot(document.getElementById('root'));
  window.mount = () => root.render(<React.StrictMode><PrepDeckProvider><Probe /></PrepDeckProvider></React.StrictMode>);
  window.unmount = () => root.render(null);
  window.revoke = clearSessionKey; window.stored = hasStoredEncryptedKey; window.apiFetch = apiFetch;
  window.mount();
`, resolveDir: web, loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser" });
let account = "alice";
let pauseIdentity = false;
const pendingIdentity = [];
const generations = [];
const user = id => ({ id, email: `${id}@example.test`, role: "user", displayName: id, status: "active" });
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://fixture").pathname;
  const json = data => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
  if (path === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(outputFiles[0].contents); }
  if (!path.startsWith("/api/")) { res.setHeader("Content-Type", "text/html"); return res.end('<div id="root"></div><script src="/fixture.js"></script>'); }
  const { payload } = await readBody(req);
  if (path === "/api/auth/me") {
    const respond = () => { if (!account) { res.statusCode = 401; return json({ error: "Signed out" }); } json({ user: user(account) }); };
    if (pauseIdentity) pendingIdentity.push(respond); else respond();
    return;
  }
  if (path === "/api/auth/logout") { account = null; return json({ ok: true }); }
  if (path === "/api/ai/generate") {
    generations.push({ owner: req.headers["x-prepdeck-key-owner"], account, key: payload.apiKey });
    return json({ cached: false, explanation: { content: "Synthetic", provider: payload.provider, model: payload.model } });
  }
  if (path === "/api/expired") { res.statusCode = 401; return json({ error: "Expired" }); }
  if (path === "/api/exams") return json({ exams: [] });
  if (path === "/api/settings") return json({ showSharedNotes: true, timezone: "UTC" });
  return json({});
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ headless: true });
const context = await browser.newContext();
context.setDefaultTimeout(8000);
await context.route("**/*", route => route.request().url().startsWith(base + "/") ? route.continue() : route.abort());
const errors = [];
const open = async () => {
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(base);
  await page.waitForFunction(() => window.app?.state.me?.id === "alice");
  return page;
};
const keyLoaded = (page, expected) => page.waitForFunction(value => window.app?.state.hasSessionKey === value, expected);
const generate = page => page.evaluate(() => window.app.genAi({ id: "synthetic-question" }));
try {
  const first = await open();
  const second = await open();
  console.log("Mounted two React providers");
  await second.evaluate(() => window.app.loadSessionApiKey("sk-synthetic-alice"));
  await keyLoaded(second, true);
  await generate(second);
  await waitUntil("valid owner generation", () => generations.length === 1);
  assert.deepEqual(generations[0], { owner: "alice", account: "alice", key: "sk-synthetic-alice" });
  console.log("Initial generation passed");

  // Another tab signs out; the real signOut hook broadcasts before navigation.
  await first.evaluate(() => { void window.app.signOut({ removeSavedKey: false }); });
  await keyLoaded(second, false);
  await waitUntil("logout completed", () => account === null);
  account = "bob";
  await generate(second);
  assert.equal(generations.length, 1);
  console.log("Cross-tab logout passed");

  // A missed event is not trusted: revalidate server identity before sending.
  account = "alice";
  await second.reload();
  await second.waitForFunction(() => window.app?.state.me?.id === "alice");
  await second.evaluate(() => window.app.loadSessionApiKey("sk-synthetic-alice"));
  account = "bob";
  await generate(second);
  await second.waitForFunction(() => window.app.state.me.id === "bob" && !window.app.state.hasSessionKey);
  assert.equal(generations.length, 1);
  console.log("Identity refresh passed");

  // Encrypted storage stays per account; a revoke racing PBKDF2 cannot reload memory.
  account = "alice";
  await second.reload();
  await second.waitForFunction(() => window.app?.state.me?.id === "alice");
  await second.evaluate(() => window.app.saveEncryptedApiKey("sk-synthetic-encrypted", "synthetic-passphrase"));
  await keyLoaded(second, true);
  console.log("Encrypted save passed");
  await second.evaluate(() => window.app.clearSessionApiKey());
  await second.evaluate(async () => {
    const unlocking = window.app.unlockSessionKey("synthetic-passphrase");
    window.revoke();
    await unlocking;
  });
  await keyLoaded(second, false);
  console.log("Unlock race passed");
  await second.evaluate(async () => {
    const saving = window.app.saveEncryptedApiKey("sk-synthetic-revoked-save", "different-passphrase");
    window.revoke();
    await saving;
  });
  // The interrupted save must not overwrite Alice's existing encrypted key.
  assert.equal(await second.evaluate(() => window.stored("alice")), true);
  assert.equal(await second.evaluate(() => window.stored("bob")), false);
  await second.evaluate(() => window.app.unlockSessionKey("synthetic-passphrase"));
  await keyLoaded(second, true);

  // An invalidation arriving while the identity preflight waits blocks release.
  pauseIdentity = true;
  await generate(second);
  await waitUntil("pending identity check", () => pendingIdentity.length === 1);
  await second.evaluate(() => window.revoke());
  pauseIdentity = false;
  pendingIdentity.splice(0).forEach(respond => respond());
  await second.waitForFunction(() => window.app.state.ai["synthetic-question"]?.status === "error");
  assert.equal(generations.length, 1);

  await second.evaluate(() => window.app.unlockSessionKey("synthetic-passphrase"));
  await second.evaluate(() => window.apiFetch("/api/expired").catch(() => {}));
  await keyLoaded(second, false);
  await second.evaluate(() => window.app.loadSessionApiKey("sk-synthetic-restored"));
  await second.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await keyLoaded(second, false);
  // React teardown cannot leave a key for a later provider instance.
  await second.evaluate(() => window.app.loadSessionApiKey("sk-synthetic-unmount"));
  await second.evaluate(() => window.unmount());
  await second.evaluate(() => window.mount());
  await second.waitForFunction(() => window.app?.state.me?.id === "alice" && !window.app.state.hasSessionKey);
  assert.deepEqual(errors, []);
  console.log("BYOK React lifecycle, two-tab logout, identity refresh, encrypted unlock/revoke race, preflight race, session loss and restore checks passed");
} finally {
  pendingIdentity.splice(0).forEach(respond => respond());
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
