import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody, waitUntil } from "./browser-fixture.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const { outputFiles } = await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import Admin from './src/screens/Admin'; import Login from './src/screens/Login';
  import WorkspaceLoading from './src/components/WorkspaceLoading';
  import MascotImage from './src/components/MascotImage';
  import {MascotProvider,useMascot} from './src/store/MascotContext';
  import './src/styles/tokens.css'; import './src/styles/app.css';
  function Probe(){window.mascot=useMascot();return <MascotImage data-testid="active-mascot" alt="Active mascot" style={{width:80}}/>;}
  function Fixture(){const path=location.pathname;
    return <MascotProvider>{path==='/login'?<Login/>:path==='/denied'?<Login deniedEmail="visitor@test"/>:
      path==='/loading'?<WorkspaceLoading/>:<main style={{padding:20}}><Admin bp={{}}/><Probe/></main>}</MascotProvider>;}
  createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`,
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "store-fixture", setup(stub) {
    stub.onResolve({ filter: /store\/PrepDeckContext$/ }, () => ({ path: "store", namespace: "stub" }));
    stub.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents:
      `const go=screen=>{window.redirected=screen}; export function usePrepDeck(){return {state:{me:{id:'fixture',role:new URLSearchParams(location.search).get('role')??'admin'}},go};}` }));
  } }],
});

let style = "3D-Chibi", failRead = false, failSave = false, failImages = "", writes = 0;
let delayRead = false, releaseRead;
const imageRequests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  const json = (value, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
  if (url.pathname === "/api/appearance") {
    const captured = style;
    if (delayRead) { delayRead = false; await new Promise(resolve => { releaseRead = resolve; }); }
    return json(failRead ? { error: "Unavailable" } : { mascotStyle: captured }, failRead ? 503 : 200);
  }
  if (url.pathname === "/api/admin/appearance") {
    writes++;
    const { payload } = await readBody(req);
    if (failSave) return json({ error: "Could not save site appearance. Please retry." }, 503);
    style = payload.mascotStyle; return json({ mascotStyle: style });
  }
  if (url.pathname === "/api/auth/turnstile") return json({ siteKey: null });
  if (url.pathname === "/api/admin/overview") return json({ users: { invited: 0, active: 2, revoked: 0, total: 2 }, exams: { total: 0, archived: 0 }, questions: { total: 0, byExam: [] }, attempts: { total: 0 } });
  if (url.pathname.startsWith("/api/")) return json({ error: "Unknown fixture route" }, 404);
  if (url.pathname.startsWith("/mascot/")) {
    imageRequests.push(url.pathname);
    if (failImages === "all" || (failImages === "2D" && url.pathname.includes("2D-Anime"))) { res.writeHead(404); return res.end(); }
    if (!/^\/mascot\/(3D-Chibi|2D-Anime\/transparent)\/[a-z-]+\.png$/.test(url.pathname)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    return res.end(readFileSync(new URL(`../public${url.pathname}`, import.meta.url)));
  }
  if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
    res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
    return res.end(outputFiles.find(file => file.path.endsWith(url.pathname.slice(1)))?.contents);
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const errors = [];
  const adminContext = await browser.newContext({ reducedMotion: "reduce" });
  const publicContext = await browser.newContext({ reducedMotion: "reduce" });
  const admin = await adminContext.newPage(), visitor = await publicContext.newPage();
  for (const page of [admin, visitor]) page.on("pageerror", error => errors.push(error.message));
  const current = name => admin.getByText(`Current mascot: ${name}`, { exact: true });
  const save = admin.getByRole("button", { name: "Save mascot", exact: true });
  async function expectImage(page, selector, suffix) {
    await page.waitForFunction(({ selector, suffix }) => {
      const image = document.querySelector(selector);
      return image?.getAttribute("src")?.endsWith(suffix) && image.complete && image.naturalWidth > 0;
    }, { selector, suffix });
  }

  await admin.goto(base);
  await admin.getByRole("button", { name: "Appearance", exact: true }).click();
  await current("3D Chibi").waitFor();
  assert.equal(await save.isDisabled(), true);
  await admin.getByRole("radio", { name: "2D Anime" }).check();
  assert.equal(writes, 0, "a preview must not write the site setting");
  await expectImage(admin, '[data-testid="active-mascot"]', "/3D-Chibi/normal.png");
  failSave = true;
  await save.click();
  await admin.getByRole("alert").filter({ hasText: "Could not save" }).waitFor();
  assert.equal(style, "3D-Chibi");
  assert.equal(await admin.getByRole("radio", { name: "2D Anime" }).isChecked(), true);
  failSave = false;
  await save.click();
  await current("2D Anime").waitFor();
  await expectImage(admin, '[data-testid="active-mascot"]', "/2D-Anime/transparent/normal.png");
  await visitor.goto(`${base}/login`);
  await expectImage(visitor, ".login-mascot", "/2D-Anime/transparent/normal.png");
  const cutouts = readdirSync(new URL("../public/mascot/2D-Anime/transparent/", import.meta.url)).filter(name => name.endsWith(".png"));
  assert.equal(cutouts.length, 8);
  const alphaStats = await visitor.evaluate(async names => Promise.all(names.map(async name => {
    const image = new Image(); image.src = `/mascot/2D-Anime/transparent/${name}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0, opaque = 0, pale = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) transparent++;
      // The cutout tool emits near-opaque subject pixels (mostly 253–254),
      // not exclusively 255. Require >=98% opacity while retaining the alpha
      // channel as delivered; exact 255 would reject intact white clothing.
      if (pixels[i + 3] >= 250) {
        opaque++;
        if (pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220) pale++;
      }
    }
    return { name, transparent, opaque, pale, total: canvas.width * canvas.height, corner: pixels[3] };
  })), cutouts);
  for (const asset of alphaStats) {
    assert.equal(asset.corner, 0, `${asset.name}: transparent canvas corner`);
    assert.ok(asset.transparent / asset.total > .2, `${asset.name}: real alpha, not a white or checkerboard background`);
    assert.ok(asset.opaque / asset.total > .2, `${asset.name}: preserve the opaque character`);
    assert.ok(asset.pale > 10000, `${asset.name}: preserve white clothing and pale props`);
  }
  assert.equal(await admin.locator(".mascot-preview").first().evaluate(image => getComputedStyle(image).backgroundColor), "rgba(0, 0, 0, 0)");
  if (process.env.SCREENSHOT_DIR) {
    const gallery = await publicContext.newPage();
    await gallery.setViewportSize({ width: 1080, height: 1100 });
    await gallery.goto(`${base}/loading`);
    await gallery.evaluate(async names => {
      const sheet = document.createElement("div"); sheet.id = "cutout-review";
      sheet.style.cssText = "position:relative;z-index:100;background:#eee;padding:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px";
      document.body.prepend(sheet);
      for (const background of ["#1e293b", "#f5e5ce"]) for (const name of names) {
        const cell = document.createElement("div"); cell.style.cssText = `background:${background};color:${background === '#1e293b' ? '#fff' : '#222'};padding:8px;text-align:center`;
        const image = new Image(); image.src = `/mascot/2D-Anime/transparent/${name}`; image.style.cssText = "width:100%;height:210px;object-fit:contain;display:block";
        cell.append(image, document.createTextNode(name)); sheet.append(cell); await image.decode();
      }
    }, cutouts);
    await gallery.locator("#cutout-review").screenshot({ path: `${process.env.SCREENSHOT_DIR}/mascot-cutouts-dark-and-light.png` });
    await gallery.close();
  }
  console.log("PASS all eight 2D assets have real alpha while preserving opaque subjects and white details");
  await visitor.setViewportSize({ width: 390, height: 844 });
  assert.ok(await visitor.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  if (process.env.SCREENSHOT_DIR) await visitor.screenshot({ path: `${process.env.SCREENSHOT_DIR}/mascot-signin-2d-phone.png`, fullPage: true });
  await visitor.goto(`${base}/denied`);
  await expectImage(visitor, ".login-mascot", "/2D-Anime/transparent/unauthorized.png");
  await visitor.goto(`${base}/loading`);
  await expectImage(visitor, 'img', "/2D-Anime/transparent/normal.png");
  console.log("PASS explicit save, failure/retry, current-page update, independent public session and scene preservation");

  await admin.setViewportSize({ width: 390, height: 844 });
  assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  if (process.env.SCREENSHOT_DIR) await admin.screenshot({ path: `${process.env.SCREENSHOT_DIR}/mascot-admin-phone.png`, fullPage: true });
  await admin.getByRole("radio", { name: "3D Chibi" }).check();
  await save.click();
  await current("3D Chibi").waitFor();
  await visitor.reload();
  await expectImage(visitor, 'img', "/3D-Chibi/normal.png");
  await visitor.goto(`${base}/?role=user`);
  await visitor.waitForFunction(() => window.redirected === "dash");
  assert.equal(await visitor.getByRole("button", { name: "Appearance", exact: true }).count(), 0);

  // A late GET cannot revert a confirmed save, including StrictMode's first read.
  delayRead = true;
  await admin.evaluate(() => { void window.mascot.refresh(); });
  await waitUntil("delayed appearance read", () => !!releaseRead);
  await admin.evaluate(() => window.mascot.save("2D-Anime"));
  releaseRead(); releaseRead = undefined;
  await current("2D Anime").waitFor();
  await expectImage(admin, '[data-testid="active-mascot"]', "/2D-Anime/transparent/normal.png");

  style = "3D-Chibi";
  await admin.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await current("3D Chibi").waitFor();
  style = "2D-Anime";
  await admin.evaluate(() => window.dispatchEvent(new FocusEvent("focus")));
  await current("2D Anime").waitFor();

  failRead = true;
  await admin.evaluate(() => window.mascot.refresh());
  await admin.getByRole("button", { name: "Retry loading" }).waitFor();
  assert.equal(await save.isDisabled(), true);
  await expectImage(admin, '[data-testid="active-mascot"]', "/2D-Anime/transparent/normal.png");
  await visitor.goto(`${base}/login`);
  await expectImage(visitor, ".login-mascot", "/3D-Chibi/normal.png");
  await visitor.getByRole("button", { name: "Sign in with Google", exact: true }).click({ trial: true });
  failRead = false;
  await admin.getByRole("button", { name: "Retry loading" }).click();
  await current("2D Anime").waitFor();
  console.log("PASS phone layout, nonadmin guard, refresh visibility, stale reads and configuration failure fallback");

  failImages = "2D";
  await visitor.setViewportSize({ width: 390, height: 844 });
  await visitor.goto(`${base}/denied`);
  await expectImage(visitor, ".login-mascot", "/3D-Chibi/unauthorized.png");
  assert.ok(await visitor.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  if (process.env.SCREENSHOT_DIR) await visitor.screenshot({ path: `${process.env.SCREENSHOT_DIR}/mascot-denied-phone.png`, fullPage: true });
  failImages = "all";
  const before = imageRequests.length;
  await visitor.reload();
  await visitor.locator('span.login-mascot[aria-hidden="true"]').waitFor({ state: "attached" });
  assert.ok(imageRequests.length - before <= 4, "failed images must not retry indefinitely");
  assert.equal(await visitor.locator("img.login-mascot").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS image fallback preserves unauthorized scene and exhausts safely without blocking the screen");
} finally {
  releaseRead?.();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
