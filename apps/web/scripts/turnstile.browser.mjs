// Issue #82: Cloudflare Turnstile on sign-in and MCP token issuance, driven
// through the real components against a local fixture. Cloudflare's script is
// replaced by a scripted fake and every other external request is blocked,
// so nothing here reaches Cloudflare. Like the real widget, the fake puts its
// iframe in a closed shadow root, out of reach of focus-trap bookkeeping.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
  import Login from './src/screens/Login'; import McpTokensCard from './src/components/McpTokensCard';
  import SessionExpiredDialog from './src/components/SessionExpiredDialog';
  import './src/styles/tokens.css'; import './src/styles/app.css';
  const params = new URLSearchParams(location.search);
  if (params.get('theme')) document.documentElement.setAttribute('data-pd-theme', params.get('theme'));
  const screens = {
    '/mcp': () => <div style={{ padding: 20, maxWidth: 800, margin: 'auto' }}><McpTokensCard title="MCP access" description="Connect your AI client." apiBase="/api/mcp-tokens" /></div>,
    '/dialog': () => <SessionExpiredDialog />,
  };
  createRoot(document.getElementById('root')).render((screens[location.pathname] ?? (() => <Login verification={params.get('verification') ?? undefined} />))());`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  // The session-expired dialog reads two things from the app store; this is all of it it needs.
  plugins: [{ name: "store-stub", setup(stub) {
    stub.onResolve({ filter: /store\/PrepDeckContext$/ }, () => ({ path: "store", namespace: "stub" }));
    stub.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents:
      "export function usePrepDeck() { return { state: { mStage: 'setup', mockAttemptId: null, exams: [], examId: null }, preserveForReauth() {} }; }" }));
  } }] });

// Stands in for https://challenges.cloudflare.com/turnstile/v0/api.js. The
// test decides when each widget passes, expires or fails; ticking the fake
// iframe's checkbox passes it too, as a keyboard user would.
const FAKE_TURNSTILE = `(() => {
  const widgets = new Map(); let next = 0;
  const control = window.fakeTurnstile = { rendered: [], removed: [], resets: [], autoPass: window.fakeAutoPass ?? true,
    latest: () => control.rendered.at(-1).id,
    pass: id => widgets.get(id).options.callback('token-' + id + '-' + (++next)),
    expire: id => widgets.get(id).options['expired-callback'](),
    fail: id => widgets.get(id).options['error-callback']('300010') };
  window.addEventListener('message', event => { const id = event.data && event.data.fakeTurnstile; if (widgets.has(id)) control.pass(id); });
  window.turnstile = {
    render(el, options) {
      const id = 'w' + (control.rendered.length + 1);
      const host = document.createElement('div');
      host.setAttribute('data-fake-widget', id);
      const frame = document.createElement('iframe');
      frame.title = 'Fake Turnstile ' + id;
      frame.style.cssText = 'display:block;width:300px;height:65px;border:1px dashed #999';
      frame.srcdoc = '<label><input type="checkbox"> Verify you are human</label><script>document.querySelector("input").addEventListener("change", () => parent.postMessage({ fakeTurnstile: "' + id + '" }, "*"))</script>';
      host.attachShadow({ mode: 'closed' }).append(frame);
      el.append(host);
      widgets.set(id, { options, host });
      control.rendered.push({ id, action: options.action, sitekey: options.sitekey, theme: options.theme, size: options.size, responseField: options['response-field'] });
      if (control.autoPass) setTimeout(() => widgets.has(id) && control.pass(id), 20);
      return id;
    },
    reset(id) { control.resets.push(id); if (control.autoPass) setTimeout(() => control.pass(id), 20); },
    remove(id) { widgets.get(id)?.host.remove(); widgets.delete(id); control.removed.push(id); },
  };
})();`;

const SITE_KEY = "1x00000000000000000000AA";
let turnstileOn = true, configStatus = 200, signIns = [], mcpWrites = [], refuseNextMcpWrite = false, tokens = [];
const refusal = { error: "Human verification failed or expired. Complete the check again, then retry.", code: "human_verification_failed" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  let raw = ""; for await (const chunk of req) raw += chunk;
  if (url.pathname === "/api/auth/turnstile") return configStatus === 200 ? json(200, { siteKey: turnstileOn ? SITE_KEY : null }) : json(configStatus, { error: "Service temporarily restricted" });
  if (url.pathname === "/api/auth/google/start" && req.method === "POST") {
    signIns.push(Object.fromEntries(new URLSearchParams(raw)));
    res.writeHead(303, { Location: "/signed-in" }); return res.end();
  }
  if (url.pathname.startsWith("/api/mcp-tokens")) {
    if (req.method === "GET") return json(200, { credentials: tokens });
    const humanToken = req.headers["x-turnstile-token"] ?? null;
    mcpWrites.push({ path: url.pathname, humanToken });
    // Like the Worker: with a site key, no token is no token issued.
    if (turnstileOn && !humanToken) return json(403, refusal);
    if (refuseNextMcpWrite) { refuseNextMcpWrite = false; return json(403, refusal); }
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
  const open = async (path, { viewport = { width: 1100, height: 900 }, autoPass = true } = {}) => {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const dialogs = []; page.on("dialog", dialog => { dialogs.push(dialog.message()); dialog.accept(); });
    await page.addInitScript(value => { window.fakeAutoPass = value; }, autoPass);
    await page.route(url => !url.href.startsWith(origin), route => {
      const url = new URL(route.request().url());
      if (url.href !== "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit") return route.abort();
      scriptRequests++;
      return scriptAvailable ? route.fulfill({ contentType: "text/javascript", body: FAKE_TURNSTILE }) : route.abort();
    });
    await page.goto(`${origin}${path}`);
    return { page, errors, dialogs };
  };
  const fake = (page, expression, arg) => page.evaluate(expression, arg);
  const google = page => page.getByRole("button", { name: "Sign in with Google" });
  const enabled = (page, label) => page.waitForFunction(text => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === text && !b.disabled), label);

  // The login screen waits for the check, then posts its token with the page to return to.
  {
    const { page, errors } = await open("/learning/exam?exam=sg&question_id=q1");
    await page.locator("[data-fake-widget]").waitFor();
    assert.deepEqual(await fake(page, () => window.fakeTurnstile.rendered.map(({ action, sitekey, theme, size, responseField }) => ({ action, sitekey, theme, size, responseField }))),
      [{ action: "sign_in", sitekey: SITE_KEY, theme: "light", size: "flexible", responseField: false }]);
    await enabled(page, "Sign in with Google");

    await fake(page, () => window.fakeTurnstile.expire(window.fakeTurnstile.latest()));
    await page.getByRole("status").filter({ hasText: "The verification expired. Refreshing it…" }).waitFor();
    assert.ok(await google(page).isDisabled(), "an expired token cannot be sent");
    await fake(page, () => window.fakeTurnstile.pass(window.fakeTurnstile.latest()));
    await enabled(page, "Sign in with Google");

    await fake(page, () => window.fakeTurnstile.fail(window.fakeTurnstile.latest()));
    await page.getByRole("status").filter({ hasText: "The verification check didn't complete." }).waitFor();
    assert.ok(await google(page).isDisabled());
    await page.getByRole("button", { name: "Try again" }).click();
    await enabled(page, "Sign in with Google");
    assert.equal((await fake(page, () => window.fakeTurnstile.resets)).length, 1);

    // Restored from the back/forward cache after leaving: the spent token is dropped for a new widget.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await page.waitForFunction(() => window.fakeTurnstile.rendered.length === 2 && window.fakeTurnstile.removed.includes("w1"));
    await enabled(page, "Sign in with Google");

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

  // A refused check says what to do: verify again (and then that it worked), try later, or ask an admin.
  {
    const { page, errors } = await open("/?verification=failed&theme=dusk", { viewport: { width: 320, height: 700 }, autoPass: false });
    await page.getByRole("alert").filter({ hasText: "We couldn't confirm you're human" }).waitFor();
    await page.locator("[data-fake-widget]").waitFor();
    assert.deepEqual(await fake(page, () => window.fakeTurnstile.rendered.map(({ theme, size }) => ({ theme, size }))), [{ theme: "dark", size: "compact" }]);
    await fake(page, () => window.fakeTurnstile.pass("w1"));
    await page.getByRole("status").filter({ hasText: "Verification complete. You can sign in now." }).waitFor();
    assert.equal(await page.getByText("We couldn't confirm you're human").count(), 0, "the old failure no longer stands beside a passed check");
    assert.deepEqual(errors, []);
    await page.close();

    for (const [kind, text] of [["unavailable", "Human verification is unavailable right now"], ["misconfigured", "Contact your admin."]]) {
      const { page: notice, errors: noticeErrors } = await open(`/?verification=${kind}`);
      await notice.getByRole("alert").filter({ hasText: text }).waitFor();
      await enabled(notice, "Sign in with Google");
      assert.equal(await notice.getByRole("alert").filter({ hasText: text }).count(), 1, `the ${kind} notice stays: a new check does not fix the server`);
      assert.equal(await notice.getByText("We couldn't confirm you're human").count(), 0, `${kind} is not blamed on the learner's check`);
      assert.deepEqual(noticeErrors, []);
      await notice.close();
    }
    console.log("PASS a refused check is explained by cause, a completed retry says so, and the widget follows the theme and card width");
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
    await enabled(page, "Sign in with Google");
    assert.deepEqual(errors, []);
    await page.close();
    console.log("PASS a script that cannot load keeps sign-in closed until a retry succeeds");
  }

  // Not knowing whether verification is on is not the same as it being off.
  {
    configStatus = 503;
    const { page, errors } = await open("/");
    await page.getByRole("alert").filter({ hasText: "Couldn't check whether human verification is needed." }).waitFor();
    assert.ok(await google(page).isDisabled(), "unknown is not treated as off");
    configStatus = 200;
    await page.getByRole("button", { name: "Try again" }).click();
    await page.locator("[data-fake-widget]").waitFor();
    await enabled(page, "Sign in with Google");
    assert.deepEqual(errors, []);
    await page.close();
    console.log("PASS a failed configuration lookup keeps sign-in closed and can be retried in place");
  }

  // Deployments without Turnstile load nothing from Cloudflare and post no token.
  {
    turnstileOn = false; scriptRequests = 0; signIns = [];
    const { page, errors } = await open("/");
    await enabled(page, "Sign in with Google");
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

  // The session-expired dialog: a keyboard reaches the check and completes sign-in.
  {
    signIns = [];
    const { page, errors } = await open("/dialog", { autoPass: false });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("prepdeck:session-expired")));
    const dialog = page.getByRole("dialog", { name: "Your session has expired" });
    await dialog.waitFor();
    await page.locator("[data-fake-widget]").waitFor();
    const notNow = dialog.getByRole("button", { name: "Not now" });
    const signIn = dialog.getByRole("button", { name: "Sign in again" });
    assert.ok(await signIn.isDisabled(), "no sign-in before the check");
    const focused = () => page.evaluate(() => {
      const active = document.activeElement;
      return active?.matches("[data-fake-widget]") ? "check" : active?.matches(".turnstile-widget") ? "check box" : active?.textContent.trim() || active?.tagName;
    });

    await notNow.focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await focused(), "check", "Shift+Tab from Not now goes into the check");
    await page.keyboard.press("Tab");
    assert.equal(await focused(), "Not now", "and Tab comes back out");
    await page.keyboard.press("Tab");
    assert.equal(await focused(), "check box", "Tab from the last control wraps to the check, not back onto Not now");
    await page.keyboard.press("Tab");
    assert.equal(await focused(), "check", "and the next Tab goes in");
    await page.keyboard.press("Space");
    await enabled(page, "Sign in again");
    await page.keyboard.press("Tab");
    assert.equal(await focused(), "Not now");
    await page.keyboard.press("Tab");
    assert.equal(await focused(), "Sign in again");
    await page.keyboard.press("Tab");
    assert.equal(await focused(), "check box", "the trap still wraps once every control is enabled");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await focused(), "Sign in again", "and Shift+Tab from the check's box wraps to the end");
    await page.keyboard.press("Enter");
    await page.waitForURL(`${origin}/signed-in`);
    assert.match(signIns[0]["cf-turnstile-response"], /^token-w1-/, "signed in with the token the keyboard earned");
    assert.deepEqual(errors, []);
    await page.close();
    console.log("PASS the session-expired dialog lets a keyboard into the check and on to sign in");
  }

  // MCP tokens: creating spends one fresh token per attempt, sent in the header.
  {
    const { page, errors } = await open("/mcp");
    await page.getByRole("button", { name: "+ Create token", exact: true }).click();
    await page.getByPlaceholder("e.g. local-cli").fill("desktop");
    const createButton = page.getByRole("button", { name: "Create token", exact: true });
    await page.locator("[data-fake-widget]").waitFor();
    assert.equal(await fake(page, () => window.fakeTurnstile.rendered[0].action), "mcp_token");
    await enabled(page, "Create token");

    refuseNextMcpWrite = true;
    await createButton.click();
    await page.getByText("Human verification failed or expired.").waitFor();
    // The refused token was spent: a new widget replaces it before a retry.
    await page.waitForFunction(() => window.fakeTurnstile.rendered.length === 2 && window.fakeTurnstile.removed.includes("w1"));
    await enabled(page, "Create token");
    await createButton.click();
    await page.getByRole("textbox", { name: "New MCP token" }).waitFor();
    assert.equal(mcpWrites.length, 2);
    assert.match(mcpWrites[0].humanToken, /^token-w1-/);
    assert.match(mcpWrites[1].humanToken, /^token-w2-/);
    assert.deepEqual(errors, []);
    await page.close();
    console.log("PASS MCP token creation sends a fresh Turnstile token, and a refused one is replaced");
  }

  // Rotating asks in the row and waits for its own button, which the check enables.
  {
    const { page, errors, dialogs } = await open("/mcp", { autoPass: false });
    const writes = mcpWrites.length;
    await page.getByRole("button", { name: "Rotate", exact: true }).click();
    await page.getByText('Rotating "desktop" stops the current token immediately and issues a new one. Complete the check, then rotate.').waitFor();
    assert.deepEqual(dialogs, [], "the row replaces the browser confirmation");
    const rotateButton = page.getByRole("button", { name: "Rotate token", exact: true });
    await page.locator("[data-fake-widget]").waitFor();
    assert.ok(await rotateButton.isDisabled(), "nothing to rotate with before the check");
    const widget = await fake(page, () => window.fakeTurnstile.latest());
    await fake(page, id => window.fakeTurnstile.pass(id), widget);
    await enabled(page, "Rotate token");
    await page.waitForTimeout(100);
    assert.equal(mcpWrites.length, writes, "a passed check alone rotates nothing");
    await rotateButton.click();
    await page.waitForFunction(() => document.querySelectorAll(".mcp-token-verify").length === 0);
    await page.waitForFunction(() => document.querySelectorAll('.mcp-token[data-status="revoked"]').length === 1);
    assert.equal(mcpWrites.length, writes + 1);
    assert.match(mcpWrites.at(-1).path, /\/rotate$/);
    assert.match(mcpWrites.at(-1).humanToken, new RegExp(`^token-${widget}-`));

    // Cancelling a rotation sends nothing.
    await page.getByRole("button", { name: "Rotate", exact: true }).first().click();
    await page.locator(".mcp-token-verify").waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".mcp-token-verify").length === 0);
    assert.equal(mcpWrites.length, writes + 1);
    assert.deepEqual(errors, []);
    await page.close();
    console.log("PASS rotation waits for a passed check and then for the Rotate token button; Cancel sends nothing");
  }

  // The card recovers without a reload: from a failed configuration lookup,
  // and from the Worker asking for verification the configuration said was off.
  {
    configStatus = 503;
    const { page, errors } = await open("/mcp");
    await page.getByRole("button", { name: "+ Create token", exact: true }).click();
    await page.getByPlaceholder("e.g. local-cli").fill("laptop");
    await page.getByRole("alert").filter({ hasText: "Couldn't check whether human verification is needed." }).waitFor();
    assert.ok(await page.getByRole("button", { name: "Create token", exact: true }).isDisabled());
    configStatus = 200;
    await page.getByRole("button", { name: "Try again" }).click();
    await page.locator("[data-fake-widget]").waitFor();
    await enabled(page, "Create token");
    assert.deepEqual(errors, []);
    await page.close();

    turnstileOn = false;
    const { page: stale, errors: staleErrors } = await open("/mcp");
    await stale.getByRole("button", { name: "+ Create token", exact: true }).click();
    await stale.getByPlaceholder("e.g. local-cli").fill("laptop");
    await enabled(stale, "Create token");
    turnstileOn = true; // switched on after the card loaded
    const writes = mcpWrites.length;
    await stale.getByRole("button", { name: "Create token", exact: true }).click();
    await stale.getByText("Human verification failed or expired.").waitFor();
    assert.equal(mcpWrites.at(-1).humanToken, null);
    await stale.locator("[data-fake-widget]").waitFor();
    await enabled(stale, "Create token");
    await stale.getByRole("button", { name: "Create token", exact: true }).click();
    await stale.getByRole("textbox", { name: "New MCP token" }).waitFor();
    assert.equal(mcpWrites.length, writes + 2);
    assert.match(mcpWrites.at(-1).humanToken, /^token-w1-/);
    assert.deepEqual(staleErrors, []);
    await stale.close();
    console.log("PASS the MCP card recovers from a failed lookup and from verification switched on after it loaded");
  }
} finally {
  await browser?.close();
  server.close();
}
