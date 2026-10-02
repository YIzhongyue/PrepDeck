// Issue #102 — the MCP OAuth consent screen (/connect) and the connected-apps
// card, driven through the real components against a local fixture API. The
// Worker side of the flow (validation, binding cookie, codes, tokens) is
// covered by apps/worker/scripts/mcp-oauth.test.mjs; this checks what the
// person deciding sees and that each decision sends the browser where the
// Worker said.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { waitUntil } from "./browser-fixture.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const { outputFiles } = await build({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
  import McpConnect, { McpConnectError } from './src/screens/McpConnect';
  import McpConnectionsCard from './src/components/McpConnectionsCard';
  import './src/styles/tokens.css'; import './src/styles/app.css';
  const params = new URLSearchParams(location.search);
  const screens = {
    '/connect': () => params.get('request') ? <McpConnect requestId={params.get('request')} /> : <McpConnectError reason={params.get('error') ?? ''} />,
    '/apps': () => <div style={{ padding: 20, maxWidth: 800, margin: 'auto' }}><McpConnectionsCard title="Connected apps" description="Apps you approved." apiBase="/api/mcp-connections" /></div>,
  };
  createRoot(document.getElementById('root')).render((screens[location.pathname] ?? (() => null))());`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });

const requests = [];
let grants = [];
let oauthEnabled = true;
const view = (id, overrides = {}) => ({
  id, client: { id: "pdc_0123456789abcdef0123456789abcdef", name: "Claude Desktop", kind: "dynamic", redirectTarget: "127.0.0.1:33418" },
  audience: "user", resource: "https://prepdeck.example/mcp", scopes: ["mcp:user:read", "mcp:user:write"],
  expiresAt: Date.now() + 600_000, account: { email: "alice@example.test", role: "user" }, eligible: true, ...overrides,
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  if (url.pathname.startsWith("/api/")) {
    requests.push(`${req.method} ${url.pathname}`);
    const match = /^\/api\/oauth\/requests\/([a-z0-9]+)(?:\/(approve|deny))?$/.exec(url.pathname);
    if (match) {
      const [, id, action] = match;
      if (id === "gone") return json(404, { error: "This connection request has expired or was already answered. Return to your app and connect again." });
      if (!action) return json(200, id === "admin" ? view(id, { audience: "admin", resource: "https://prepdeck.example/admin-mcp", scopes: ["mcp:admin:read", "mcp:admin:write"], eligible: false })
        : id === "readonly" ? view(id, { scopes: ["mcp:user:read"], client: { id: "https://client.example/oauth.json", name: null, kind: "metadata_document", redirectTarget: "client.example" } })
        : view(id));
      const target = new URL("/client-callback", `http://${req.headers.host}`);
      if (action === "approve") target.searchParams.set("code", `code-for-${id}`);
      else target.searchParams.set("error", "access_denied");
      target.searchParams.set("state", "s");
      return json(200, { redirectTo: target.toString() });
    }
    if (url.pathname === "/api/mcp-connections" && req.method === "GET") return json(200, { enabled: oauthEnabled, grants });
    const revoke = /^\/api\/mcp-connections\/([^/]+)\/revoke$/.exec(url.pathname);
    if (revoke && req.method === "POST") {
      grants = grants.filter((g) => g.id !== revoke[1]);
      return json(200, { ok: true });
    }
    return json(404, { error: "not found" });
  }
  if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
    res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find((f) => f.path.endsWith(url.pathname.slice(1)))?.contents);
  }
  if (url.pathname === "/client-callback") { res.setHeader("Content-Type", "text/html"); return res.end("<!doctype html><title>client</title><p>client callback</p>"); }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());

  // A user request: client (marked unverified), destination, server, account and permissions.
  await page.goto(`${origin}/connect?request=abc123`);
  await page.getByRole("heading", { name: "Connect Claude Desktop to PrepDeck?" }).waitFor();
  for (const text of ["unverified", "127.0.0.1:33418", "User MCP", "https://prepdeck.example/mcp", "alice@example.test",
    "Read your study data", "Record study activity and edit your notes", "signing out of PrepDeck does not disconnect it"]) {
    assert.ok(await page.getByText(text, { exact: false }).first().isVisible(), text);
  }
  assert.equal(await page.getByText("administrative access").count(), 0);
  assert.deepEqual(requests, ["GET /api/oauth/requests/abc123"], "showing the screen decides nothing");
  await page.getByRole("button", { name: "Allow access" }).click();
  await page.waitForURL(/\/client-callback\?code=code-for-abc123&state=s$/);
  assert.ok(requests.includes("POST /api/oauth/requests/abc123/approve"));

  // Cancel sends the browser back with the client's denial.
  await page.goto(`${origin}/connect?request=deny1`);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForURL(/\/client-callback\?error=access_denied/);
  assert.ok(requests.includes("POST /api/oauth/requests/deny1/deny"));
  assert.ok(!requests.includes("POST /api/oauth/requests/deny1/approve"));

  // A read-only metadata-document client: no name of its own, its URL shown as its identity.
  await page.goto(`${origin}/connect?request=readonly`);
  await page.getByRole("heading", { name: "Connect An unnamed app to PrepDeck?" }).waitFor();
  assert.ok(await page.getByText("https://client.example/oauth.json").isVisible());
  assert.ok(await page.getByText("Read your study data").isVisible());
  assert.equal(await page.getByText("Record study activity and edit your notes").count(), 0);

  // An Admin MCP request seen by a non-admin offers no approval at all.
  await page.goto(`${origin}/connect?request=admin`);
  await page.getByRole("heading", { name: "Administrator access required" }).waitFor();
  assert.ok(await page.getByText("administrative access").isVisible());
  assert.equal(await page.getByRole("button", { name: "Allow access" }).count(), 0);
  assert.ok(await page.getByRole("button", { name: "Return to the app" }).isVisible());

  // An expired or answered request explains how to recover.
  await page.goto(`${origin}/connect?request=gone`);
  await page.getByRole("heading", { name: "This request has ended" }).waitFor();
  assert.ok(await page.getByText("Return to your app and connect again").isVisible());

  // Requests the Worker refused outright are explained without any API call.
  const before = requests.length;
  for (const [reason, heading] of [["invalid_client", "Unknown app"], ["invalid_redirect_uri", "Can't return to the app"], ["unavailable", "Connecting apps isn't available"], ["bogus", "Invalid connection request"]]) {
    await page.goto(`${origin}/connect?error=${reason}`);
    await page.getByRole("heading", { name: heading }).waitFor();
  }
  assert.equal(requests.length, before);

  // Phone width: the consent card fits without sideways scrolling.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${origin}/connect?request=abc123`);
  await page.getByRole("button", { name: "Allow access" }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `consent screen overflows by ${overflow}px at 360px`);
  await page.setViewportSize({ width: 1100, height: 900 });

  // Connected apps: listed with access and timestamps, never a secret, and disconnectable.
  grants = [
    { id: "g1", clientId: "pdc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", clientName: "Claude Desktop", clientKind: "dynamic", audience: "user", scopes: ["mcp:user:read", "mcp:user:write"], createdAt: Date.now() - 86_400_000, lastUsedAt: Date.now(), status: "active" },
    { id: "g2", clientId: "https://client.example/oauth.json", clientName: null, clientKind: "metadata_document", audience: "user", scopes: ["mcp:user:read"], createdAt: Date.now() - 40 * 86_400_000, lastUsedAt: null, status: "expired" },
  ];
  await page.goto(`${origin}/apps`);
  await page.getByText("Claude Desktop").waitFor();
  assert.ok(await page.getByText(/Read and write · Connected/).isVisible());
  assert.ok(await page.getByText(/Read only · Connected .* Never used · Idle too long/).isVisible());
  assert.ok(await page.getByText("expired", { exact: true }).isVisible());
  await page.getByRole("button", { name: "Disconnect" }).first().click();
  await waitUntil("the disconnected app to leave the list", () => page.getByText("Claude Desktop").count(), { until: (n) => n === 0 });
  assert.ok(requests.includes("POST /api/mcp-connections/g1/revoke"));

  // With OAuth off and nothing connected, the card stays out of the way.
  grants = [];
  oauthEnabled = false;
  await page.goto(`${origin}/apps`);
  await waitUntil("the connections lookup", () => requests.filter((r) => r === "GET /api/mcp-connections").length, { until: (n) => n >= 2 });
  await page.waitForTimeout(100);
  assert.equal(await page.getByText("Connected apps").count(), 0);

  assert.deepEqual(errors, []);
  console.log("mcp-connect browser regression passed");
} finally {
  await browser?.close();
  server.close();
}
