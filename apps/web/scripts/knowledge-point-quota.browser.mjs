// Real React lifecycle in Chromium; only synthetic loopback responses.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { waitUntil } from "./browser-fixture.mjs";

const { outputFiles } = await build({ stdin: { contents: `
  import React, { StrictMode, useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { KnowledgePointsProvider } from './src/store/useKnowledgePoints';
  import Notice from './src/components/knowledgePoints/KnowledgePointQuotaNotice';
  function Fixture() { const [user, setUser] = useState('a'); window.setIdentity = setUser;
    return <KnowledgePointsProvider><Notice userId={user}/></KnowledgePointsProvider>; }
  createRoot(document.getElementById('root')).render(<StrictMode><Fixture/></StrictMode>);
`, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true,
  write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const limits = { notes: 10000, bodyBytes: 104857600, images: 5000, imageBytes: 524288000 };
const usage = (userId, notes = 12) => ({ userId, notes, bodyBytes: 100, images: 1, imageBytes: 100, limits });
let payload = usage("a"), status = 200, hold = false;
const pending = [];
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://fixture.test").pathname;
  if (path === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(outputFiles[0].text); }
  if (path === "/api/knowledge-points/usage") {
    const answer = () => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); };
    if (hold) return pending.push(res);
    return answer();
  }
  if (path.startsWith("/api/")) { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ knowledgePoints: [], total: 0, groups: [], tags: [] })); }
  res.setHeader("Content-Type", "text/html"); res.end('<div id="root"></div><script type="module" src="/fixture.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
const refresh = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
try {
  await page.goto(origin);
  await page.waitForFunction(() => document.body.textContent.includes("12/10,000"));
  payload = usage("a", 9000); await refresh();
  await page.waitForFunction(() => document.body.textContent.includes("approaching your storage limit"));
  status = 503; await refresh();
  await page.waitForFunction(() => !document.querySelector("aside"));
  status = 200; payload = { knowledgePoint: { id: "wrong-route" } }; await refresh();
  await page.waitForTimeout(50); assert.equal(await page.locator("aside").count(), 0);
  payload = usage("a"); await refresh();
  await page.waitForFunction(() => document.body.textContent.includes("12/10,000"));
  hold = true; await refresh();
  await waitUntil("held A quota request", () => pending.length);
  await page.evaluate(() => window.setIdentity("b"));
  await page.waitForFunction(() => !document.querySelector("aside"));
  await waitUntil("held B quota request", () => pending.length, { until: n => n >= 2 });
  // Even an A response arriving after the B render cannot expose A's usage.
  for (const res of pending.splice(0)) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(usage("a", 7777))); }
  hold = false; payload = usage("b", 34); await refresh();
  await page.waitForFunction(() => document.body.textContent.includes("34/10,000"));
  assert.ok(!(await page.textContent("body")).includes("7777"));
  await page.evaluate(() => window.setIdentity(null));
  await page.waitForFunction(() => !document.querySelector("aside"));
  hold = true;
  await page.evaluate(() => window.setIdentity("b"));
  await waitUntil("new session quota request", () => pending.length);
  assert.equal(await page.locator("aside").count(), 0, "same account reauthentication must not reuse prior-session usage");
  for (const res of pending.splice(0)) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(usage("b", 56))); }
  hold = false;
  await page.waitForFunction(() => document.body.textContent.includes("56/10,000"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, cases: ["success", "near-limit", "HTTP error", "malformed payload", "identity change", "late response", "sign out", "same-account reauthentication"], browser: browser.version() }));
} finally {
  for (const res of pending) res.end();
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
