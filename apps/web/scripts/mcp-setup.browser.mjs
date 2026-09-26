// Real component, local fixtures only. No production token or network is needed.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
  import McpTokensCard from './src/components/McpTokensCard'; import './src/styles/tokens.css'; import './src/styles/app.css';
  const root = createRoot(document.getElementById('root'));
  const admin = location.pathname === '/admin';
  root.render(<McpTokensCard title={admin ? 'Admin MCP tokens' : 'MCP access'} description="Connect your AI client to PrepDeck."
    apiBase={admin ? '/api/admin/mcp-tokens' : '/api/mcp-tokens'} enableSetupPrompt />);
  window.unmountFixture = () => root.unmount();`, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, loader: { ".woff": "dataurl", ".woff2": "dataurl" }, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
let tokens = [], writes = 0, nextExpiry = null, failRotation = false;
const freshToken = n => `pd_mcp_user_${n.toString(16).padStart(64, "a")}`;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  if (url.pathname.startsWith("/api/")) {
    if (req.method === "GET") return json(200, { credentials: tokens });
    writes++;
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const id = url.pathname.split("/").at(-2);
    if (url.pathname.endsWith("/revoke") || url.pathname.endsWith("/rotate")) {
      tokens = tokens.map(t => t.id === id ? { ...t, status: "revoked", revokedAt: Date.now() } : t);
      if (url.pathname.endsWith("/revoke")) return json(200, { ok: true });
      if (failRotation) return json(500, { error: "The predecessor was revoked; replacement failed." });
    }
    const credential = { id: `token-${writes}`, name: body.name ?? "rotated", status: "active", createdAt: Date.now(), expiresAt: nextExpiry, lastUsedAt: null, revokedAt: null };
    nextExpiry = null;
    tokens.unshift(credential);
    return json(201, { credential, token: freshToken(writes) });
  }
  if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
    res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(f => f.path.endsWith(url.pathname.slice(1)))?.contents);
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root" style="padding:20px;max-width:800px;margin:auto"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.copied = [];
    window.clipboardMode = "success";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => {
      if (window.clipboardMode === "fail") throw new Error("denied");
      if (window.clipboardMode === "pending") return new Promise((_resolve, reject) => { window.rejectCopy = reject; });
      window.copied.push(value);
    } } });
  });
  const normal = () => page.getByRole("button", { name: "Copy setup prompt", exact: true });
  const inclusive = () => page.getByRole("button", { name: "Copy setup prompt with token", exact: true });
  const create = async name => {
    await page.getByRole("button", { name: "+ Create token", exact: true }).click();
    await page.getByPlaceholder("e.g. local-cli").fill(name);
    await page.getByRole("button", { name: "Create token", exact: true }).click();
    await inclusive().waitFor();
  };
  await page.goto(`${origin}/settings/nested?tab=mcp`);
  await normal().focus(); await page.keyboard.press("Enter");
  await page.getByRole("status").filter({ hasText: "Setup prompt copied." }).waitFor();
  assert.equal(writes, 0);
  let copied = await page.evaluate(() => window.copied.at(-1));
  assert.ok(copied.includes(`Endpoint: ${origin}/mcp\n`));
  assert.ok(copied.includes("<PREPDECK_USER_MCP_TOKEN>"));
  assert.equal(await inclusive().count(), 0);

  await create("desktop");
  await inclusive().click();
  await page.getByRole("status").waitFor();
  assert.ok((await page.evaluate(() => window.copied.at(-1))).includes(freshToken(1)));
  await normal().click();
  assert.ok((await page.evaluate(() => window.copied.at(-1))).includes("<PREPDECK_USER_MCP_TOKEN>"));
  assert.equal(writes, 1);

  // Denied clipboard shows a keyboard-selectable fallback and no false success.
  await page.evaluate(() => { window.clipboardMode = "fail"; });
  await inclusive().click();
  const fallback = page.getByRole("textbox", { name: "Setup prompt to copy manually" });
  await fallback.waitFor();
  assert.ok((await fallback.inputValue()).includes(freshToken(1)));
  await fallback.focus();
  assert.equal(await fallback.evaluate(e => e.selectionEnd - e.selectionStart), (await fallback.inputValue()).length);
  assert.equal(await page.getByRole("status").count(), 0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  assert.equal(await fallback.count(), 0);
  assert.equal(await inclusive().count(), 0);
  await normal().click();
  assert.ok((await fallback.inputValue()).includes("<PREPDECK_USER_MCP_TOKEN>"));
  if (process.env.SCREENSHOT_DIR) {
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/mcp-setup-desktop.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/mcp-setup-mobile.png`, fullPage: true });

  // A late failed clipboard promise cannot restore secret content after Done.
  await create("late-copy");
  await page.evaluate(() => { window.clipboardMode = "pending"; });
  await inclusive().click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.evaluate(() => window.rejectCopy(new Error("denied late")));
  assert.equal(await fallback.count(), 0);

  await create("revoked");
  await page.evaluate(() => { window.clipboardMode = "fail"; });
  await inclusive().click(); await fallback.waitFor();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Revoke", exact: true }).first().click();
  await inclusive().waitFor({ state: "detached" });
  assert.equal(await fallback.count(), 0);

  await create("rotate");
  const beforeRotate = writes;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Rotate", exact: true }).first().click();
  await page.getByText('Copy "rotated" now', { exact: false }).waitFor();
  await inclusive().click(); await fallback.waitFor();
  assert.ok(!(await fallback.inputValue()).includes(freshToken(beforeRotate)));
  assert.ok((await fallback.inputValue()).includes(freshToken(writes)));
  failRotation = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Rotate", exact: true }).first().click();
  await page.getByText("The predecessor was revoked; replacement failed.").waitFor();
  assert.equal(await inclusive().count(), 0); assert.equal(await fallback.count(), 0);
  failRotation = false;

  nextExpiry = Date.now() + 1800;
  await create("expiring");
  await inclusive().click(); await fallback.waitFor();
  await inclusive().waitFor({ state: "detached" });
  assert.equal(await fallback.count(), 0);

  await create("reload");
  await page.reload(); await normal().waitFor();
  assert.equal(await inclusive().count(), 0);
  await normal().click();
  assert.ok((await page.evaluate(() => window.copied.at(-1))).includes("<PREPDECK_USER_MCP_TOKEN>"));

  // Legacy fallback success/failure, without Clipboard API.
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }); document.execCommand = () => true; });
  await normal().click(); await page.getByRole("status").waitFor();
  assert.equal(await page.locator("body > textarea").count(), 0);
  await page.evaluate(() => { document.execCommand = () => false; });
  await normal().click(); await fallback.waitFor();
  assert.equal(await page.locator("body > textarea").count(), 0);

  await page.evaluate(() => { document.execCommand = () => { throw new Error("Legacy API unavailable"); }; });
  await normal().click(); await fallback.waitFor();
  assert.equal(await page.locator("body > textarea").count(), 0);

  await create("unmount");
  await inclusive().click(); await fallback.waitFor();
  await page.evaluate(() => window.unmountFixture());
  assert.equal(await fallback.count(), 0); assert.equal(await inclusive().count(), 0);
  await page.goto(`${origin}/admin`);
  await page.getByRole("heading", { name: "Admin MCP tokens" }).waitFor();
  assert.equal(await normal().count(), 0);
  assert.equal(await inclusive().count(), 0);
  assert.deepEqual(errors, []);
  console.log("MCP setup browser regression passed (clipboard, lifecycle, audience, keyboard, 360px layout).");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
