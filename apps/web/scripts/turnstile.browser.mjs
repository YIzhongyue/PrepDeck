// Issue #82: Cloudflare Turnstile on sign-in and MCP token issuance, driven
// through the real components against a local fixture. Cloudflare's script is
// replaced by a scripted fake and every other external request is blocked,
// so nothing here reaches Cloudflare.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
  import Login from './src/screens/Login'; import McpTokensCard from './src/components/McpTokensCard';
  import './src/styles/tokens.css'; import './src/styles/app.css';
  const params = new URLSearchParams(location.search);
  if (params.get('theme')) document.documentElement.setAttribute('data-pd-theme', params.get('theme'));
  createRoot(document.getElementById('root')).render(location.pathname === '/mcp'
    ? <div style={{ padding: 20, maxWidth: 800, margin: 'auto' }}><McpTokensCard title="MCP access" description="Connect your AI client." apiBase="/api/mcp-tokens" /></div>
    : <Login verification={params.has('verification')} />);`, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });

// Stands in for https://challenges.cloudflare.com/turnstile/v0/api.js. The
// test decides when each widget passes, expires or fails.
const FAKE_TURNSTILE = `(() => {
  const widgets = new Map(); let next = 0;
  const control = window.fakeTurnstile = { rendered: [], removed: [], resets: [], autoPass: true,
    latest: () => control.rendered.at(-1).id,
    pass: id => widgets.get(id).callback('token-' + id + '-' + (++next)),
    expire: id => widgets.get(id)['expired-callback'](),
    fail: id => widgets.get(id)['error-callback']('300010') };
  window.turnstile = {
    render(el, options) {
      const id = 'w' + (control.rendered.length + 1);
      widgets.set(id, options);
      control.rendered.push({ id, action: options.action, sitekey: options.sitekey, theme: options.theme, size: options.size, responseField: options['response-field'] });
      el.innerHTML = '<div data-fake-widget="' + id + '" style="height:65px;border:1px dashed #999">Fake Turnstile ' + id + '</div>';
      if (control.autoPass) setTimeout(() => widgets.has(id) && control.pass(id), 20);
      return id;
    },
    reset(id) { control.resets.push(id); if (control.autoPass) setTimeout(() => control.pass(id), 20); },
    remove(id) { widgets.delete(id); control.removed.push(id); },
  };
})();`;

const SITE_KEY = "1x00000000000000000000AA";
let turnstileOn = true, signIns = [], mcpWrites = [], refuseNextMcpWrite = false, tokens = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  let raw = ""; for await (const chunk of req) raw += chunk;
  if (url.pathname === "/api/auth/turnstile") return json(200, { siteKey: turnstileOn ? SITE_KEY : null });
  if (url.pathname === "/api/auth/google/start" && req.method === "POST") {
    signIns.push(Object.fromEntries(new URLSearchParams(raw)));
    res.writeHead(303, { Location: "/signed-in" }); return res.end();
  }
  if (url.pathname.startsWith("/api/mcp-tokens")) {
    if (req.method === "GET") return json(200, { credentials: tokens });
    mcpWrites.push({ path: url.pathname, humanToken: req.headers["x-turnstile-token"] ?? null });
    if (refuseNextMcpWrite) { refuseNextMcpWrite = false; return json(403, { error: "Human verification failed or expired. Complete the check again, then retry.", code: "human_verification_failed" }); }
    const id = url.pathname.split("/").at(-2);
    if (url.pathname.endsWith("/rotate")) tokens = tokens.map(t => t.id === id ? { ...t, status: "revoked", revokedAt: Date.now() } : t);
    const credential = { id: `token-${mcpWrites.length}`, name: JSON.parse(raw || "{}").name ?? "rotated", status: "active", createdAt: Date.now(), expiresAt: null, lastUsedAt: null, revokedAt: null };
    tokens.unshift(credential);
    return json(201, { credential, token: `pd_mcp_user_${"a".repeat(64)}` });
  }
  if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
    res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(f => f.path.endsWith(url.pathname.slice(1)))?.contents);
  }
  if (url.pathname.startsWith("/mascot/")) { res.writeHead(404); return res.end(); }
  res.setHeader("Content-Type", "text/html");
  res.end(url.pathname === "/signed-in" ? "<!doctype html><title>Signed in</title><p>Left for Google</p>"
    : '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  let scriptAvailable = true, scriptRequests = 0;
  const open = async (path, viewport = { width: 1100, height: 900 }) => {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route(url => !url.href.startsWith(origin), route => {
      const url = new URL(route.request().url());
      if (url.href !== "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit") return route.abort();
      scriptRequests++;
      return scriptAvailable ? route.fulfill({ contentType: "text/javascript", body: FAKE_TURNSTILE }) : route.abort();
    });
    await page.goto(`${origin}${path}`);
    return { page, errors };
  };
  const fake = (page, expression) => page.evaluate(expression);
  const google = page => page.getByRole("button", { name: "Sign in with Google" });

  // The login screen waits for the check, then posts its token with the page to return to.
  {
    const { page, errors } = await open("/learning/exam?exam=sg&question_id=q1");
    await page.locator("[data-fake-widget]").waitFor();
    assert.deepEqual(await fake(page, () => window.fakeTurnstile.rendered.map(({ action, sitekey, theme, size, responseField }) => ({ action, sitekey, theme, size, responseField }))),
      [{ action: "sign_in", sitekey: SITE_KEY, theme: "light", size: "flexible", responseField: false }]);
    await page.waitForFunction(() => !document.querySelector(".login-google-btn").disabled);

    await fake(page, () => window.fakeTurnstile.expire(window.fakeTurnstile.latest()));
    await page.getByRole("status").filter({ hasText: "The verification expired. Refreshing it…" }).waitFor();
    assert.ok(await google(page).isDisabled(), "an expired token cannot be sent");
    await fake(page, () => window.fakeTurnstile.pass(window.fakeTurnstile.latest()));
    await page.waitForFunction(() => !document.querySelector(".login-google-btn").disabled);

    await fake(page, () => window.fakeTurnstile.fail(window.fakeTurnstile.latest()));
    await page.getByRole("status").filter({ hasText: "The verification check didn't complete." }).waitFor();
    assert.ok(await google(page).isDisabled());
    await page.getByRole("button", { name: "Try again" }).click();
    await page.waitForFunction(() => !document.querySelector(".login-google-btn").disabled);
    assert.equal((await fake(page, () => window.fakeTurnstile.resets)).length, 1);

    // Restored from the back/forward cache after leaving: the spent token is dropped for a new widget.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await page.waitForFunction(() => window.fakeTurnstile.rendered.length === 2 && window.fakeTurnstile.removed.includes("w1"));
    await page.waitForFunction(() => !document.querySelector(".login-google-btn").disabled);

    const token = await page.evaluate(() => `token-${window.fakeTurnstile.latest()}`);
    await google(page).click();
    await page.waitForURL(`${origin}/signed-in`);
    assert.equal(signIns.length, 1);
    assert.equal(signIns[0].returnTo, "/learning/exam?exam=sg&question_id=q1");
    assert.ok(signIns[0]["cf-turnstile-response"].startsWith(`${token}-`), "the current widget's token is posted");
    assert.deepEqual(errors, []);
    await page.close();
    console.log("PASS the login screen waits for Turnstile, recovers from expiry and errors, and posts its token with returnTo");
  }

  // A refused check is explained; Dusk gets the dark widget, and a narrow card the compact one.
  {
    const { page, errors } = await open("/?verification&theme=dusk", { width: 320, height: 700 });
    await page.getByRole("alert").filter({ hasText: "We couldn't confirm you're human" }).waitFor();
    await page.locator("[data-fake-widget]").waitFor();
    assert.deepEqual(await fake(page, () => window.fakeTurnstile.rendered.map(({ theme, size }) => ({ theme, size }))), [{ theme: "dark", size: "compact" }]);
    assert.deepEqual(errors, []);
    await page.close();
    console.log("PASS a refused check is explained, and the widget follows the theme and card width");
  }

  // Cloudflare's script failing to load is reported and can be retried.
  {
    scriptAvailable = false;
    const { page, errors } = await open("/");
    await page.getByRole("status").filter({ hasText: "The verification check couldn't load." }).waitFor();
    assert.ok(await google(page).isDisabled(), "fails closed: no token, no sign-in");
    scriptAvailable = true;
    await page.getByRole("button", { name: "Try again" }).click();
    await page.locator("[data-fake-widget]").waitFor();
    await page.waitForFunction(() => !document.querySelector(".login-google-btn").disabled);
    assert.deepEqual(errors, []);
    await page.close();
    console.log("PASS a script that cannot load keeps sign-in closed until a retry succeeds");
  }

  // Deployments without Turnstile load nothing from Cloudflare and post no token.
  {
    turnstileOn = false; scriptRequests = 0; signIns = [];
    const { page, errors } = await open("/");
    await page.waitForFunction(() => !document.querySelector(".login-google-btn").disabled);
    assert.equal(await page.locator(".turnstile").count(), 0);
    await google(page).click();
    await page.waitForURL(`${origin}/signed-in`);
    assert.deepEqual(signIns, [{}]);
    assert.equal(scriptRequests, 0);
    assert.deepEqual(errors, []);
    await page.close();
    turnstileOn = true;
    console.log("PASS without a site key, sign-in needs no widget and loads no Cloudflare script");
  }

  // MCP tokens: creating and rotating each spend one fresh token, sent in the header.
  {
    const { page, errors } = await open("/mcp");
    page.on("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "+ Create token", exact: true }).click();
    await page.getByPlaceholder("e.g. local-cli").fill("desktop");
    const createButton = page.getByRole("button", { name: "Create token", exact: true });
    const createEnabled = () => page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent === "Create token" && !b.disabled));
    await page.locator("[data-fake-widget]").waitFor();
    assert.equal(await fake(page, () => window.fakeTurnstile.rendered[0].action), "mcp_token");
    await createEnabled();

    refuseNextMcpWrite = true;
    await createButton.click();
    await page.getByText("Human verification failed or expired.").waitFor();
    // The refused token was spent: a new widget replaces it before a retry.
    await page.waitForFunction(() => window.fakeTurnstile.rendered.length === 2 && window.fakeTurnstile.removed.includes("w1"));
    await createEnabled();
    await createButton.click();
    await page.getByRole("textbox", { name: "New MCP token" }).waitFor();
    assert.equal(mcpWrites.length, 2);
    assert.match(mcpWrites[0].humanToken, /^token-w1-/);
    assert.match(mcpWrites[1].humanToken, /^token-w2-/);

    await fake(page, () => { window.fakeTurnstile.autoPass = false; });
    await page.getByRole("button", { name: "Rotate", exact: true }).click();
    await page.getByText('Complete the check to rotate "desktop".').waitFor();
    assert.equal(mcpWrites.length, 2, "rotation waits for the check");
    await page.waitForFunction(() => window.fakeTurnstile.rendered.length === 3);
    await fake(page, () => window.fakeTurnstile.pass("w3"));
    await page.waitForFunction(() => document.querySelectorAll(".mcp-token-verify").length === 0);
    await page.waitForFunction(() => document.querySelectorAll('.mcp-token[data-status="revoked"]').length === 1);
    assert.equal(mcpWrites.length, 3);
    assert.match(mcpWrites[2].path, /\/rotate$/);
    assert.match(mcpWrites[2].humanToken, /^token-w3-/);

    // Cancelling a rotation's check sends nothing.
    await page.getByRole("button", { name: "Rotate", exact: true }).first().click();
    await page.getByText("Rotation starts as soon as it passes.").waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".mcp-token-verify").length === 0);
    assert.equal(mcpWrites.length, 3);
    assert.deepEqual(errors, []);
    await page.close();
    console.log("PASS MCP token creation and rotation each send a fresh Turnstile token, and a refused one is replaced");
  }
} finally {
  await browser?.close();
  server.close();
}
