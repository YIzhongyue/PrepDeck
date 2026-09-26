import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, STATE, ACCOUNT, localEnvironment, setup, seed, sql, stopProcess } from "./local.mjs";

const base = "http://127.0.0.1:8787";
const explorer = `${base}/cdn-cgi/local/explorer/api`;
const delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
let child;
let output = "";
let cookie;
async function request(path, init = {}, expected = 200) {
  const headers = { ...(cookie ? { Cookie: cookie } : {}), ...init.headers };
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const text = await response.text();
  assert.equal(response.status, expected, `${init.method ?? "GET"} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

try {
  if (!process.argv.includes("--running")) {
    await assert.rejects(fetch(`${base}/api/health`), "Stop any local Worker before running this smoke test.");
    await setup();
    await seed(); // A second seed must preserve content and create no duplicates.
    child = spawn(process.execPath, [resolve(ROOT, "scripts/local.mjs"), "start"], {
      cwd: ROOT, env: localEnvironment(), stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
    });
    child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error(`Local startup failed: ${output}`);
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* Still starting. */ }
      await delay(500);
    }
  }
  const workers = await (await fetch(`${explorer}/local/workers`)).json();
  const bindings = workers.result.find(worker => worker.name === "prepdeck-development").bindings;
  for (const [kind, name] of [["kv", "KV"], ["d1", "DB"], ["r2", "BUCKET"], ["do", "RATE_LIMITER"], ["sendEmail", "EMAIL"]]) {
    assert.ok(bindings[kind].some(binding => binding.bindingName === name), `${name} local binding exists`);
  }
  const login = await fetch(`${base}/api/auth/login`, json("POST", ACCOUNT));
  assert.equal(login.status, 200, "real Worker + Durable Object permit local authentication");
  cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.equal((await request("/api/auth/me")).user.role, "admin");
  const exams = await request("/api/exams");
  assert.equal(exams.exams.filter(exam => exam.id === "local-exam").length, 1);
  const catalog = await request("/api/exams/local-exam/practice-catalog");
  assert.equal(catalog.questions.length, 3);
  const keys = await (await fetch(`${explorer}/storage/kv/namespaces/00000000000000000000000000000000/keys`)).json();
  assert.ok(keys.result.some(key => key.name === "practice-questions:v2:local-exam"), "lightweight practice catalog persisted through real local KV");
  assert.deepEqual((await request("/api/exams/local-exam/practice-catalog")).questions, catalog.questions);

  const note = (await request("/api/knowledge-points", json("POST", {}), 201)).knowledgePoint;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+U2ioAAAAASUVORK5CYII=", "base64");
  const image = (await request(`/api/kp-images/${note.id}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: bytes }, 201)).image;
  const readImage = await fetch(`${base}${image.url}`, { headers: { Cookie: cookie } });
  assert.equal(readImage.status, 200); assert.deepEqual(Buffer.from(await readImage.arrayBuffer()), bytes);
  await request(`/api/knowledge-points/${note.id}`, json("PUT", { baseRevision: note.revision, title: "Local smoke", bodyMarkdown: `![Image](${image.url})` }));
  await request(`/api/knowledge-points/${note.id}`, { method: "DELETE" }, 204);

  const fixture = JSON.parse(await readFile(resolve(ROOT, "tests/fixtures/import-contract.json"), "utf8")).base;
  const validation = await request("/api/exams/local-exam/import/validate", json("POST", fixture));
  assert.equal(validation.valid, true, "native validate rate limiter is present");
  // Invalid execute input proves its separate limiter is available without importing data.
  await request("/api/exams/local-exam/import", json("POST", {}), 422);
  const settings = await request("/api/daily-email-settings");
  await request("/api/daily-email-settings", json("PATCH", { enabled: true, source: "new", questionsPerEmail: 1, timezone: "UTC", sendHourLocal: new Date().getUTCHours() }));
  await sql("DELETE FROM daily_review_email_deliveries WHERE user_id='local-admin';");
  const emailRun = await fetch(`${base}/cdn-cgi/local/scheduled?cron=${encodeURIComponent("*/15 * * * *")}`);
  assert.equal(emailRun.status, 200);
  let emails;
  for (let attempt = 0; attempt < 40; attempt++) {
    emails = await (await fetch(`${explorer}/local/email/sending`)).json();
    if (JSON.stringify(emails).includes(ACCOUNT.email)) break;
    await delay(250);
  }
  assert.ok(JSON.stringify(emails).includes(ACCOUNT.email), "daily review captured by local Email simulator");
  await request("/api/daily-email-settings", json("PATCH", settings));
  const cleanup = await fetch(`${base}/cdn-cgi/local/scheduled?cron=${encodeURIComponent("17 3 * * *")}`);
  assert.equal(cleanup.status, 200);

  if (process.argv.includes("--browser")) {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
    const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    try {
      const page = await browser.newPage();
      // Core flows must work with every external browser request unavailable.
      await page.route("**/*", route => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await page.goto("http://localhost:8788");
      await page.getByRole("button", { name: "Sign in as local admin" }).click();
      await page.waitForURL("http://localhost:5173/");
      await page.getByRole("button", { name: /^Select exam/ }).first().click();
      await page.getByRole("option", { name: "Local practice examples" }).click();
      await page.waitForTimeout(700);
      assert.equal((await page.request.get("http://localhost:5173/api/auth/me")).status(), 200);
      await page.reload();
      assert.equal((await page.request.get("http://localhost:5173/api/exams/local-exam/practice-catalog")).status(), 200);
      await page.getByRole("button", { name: "Learning", exact: true }).first().click();
      await page.getByRole("button", { name: "Start learning", exact: true }).click();
      await page.getByText("What is two plus two?", { exact: true }).first().waitFor();
      await page.getByText("Adding two and two gives four.", { exact: true }).first().waitFor();
      await page.screenshot({ path: resolve(STATE, "local-smoke-desktop.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(250);
      await page.screenshot({ path: resolve(STATE, "local-smoke-mobile.png"), fullPage: true });

      // The Worker-served build enforces public/_headers' CSP, which Vite dev
      // does not: the brand faces must load there from 'self', with no CSP
      // violation (issue #44). The session cookie is shared across ports.
      const cspErrors = [];
      page.on("console", message => { if (/Content Security Policy/i.test(message.text())) cspErrors.push(message.text()); });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("http://localhost:8787/");
      await page.getByRole("button", { name: "Settings", exact: true }).first().click();
      await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
      const loadedFaces = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...new Set([...document.fonts].filter(face => face.status === "loaded").map(face => face.family.replace(/["']/g, "")))];
      });
      for (const family of ["Figtree", "Caprasimo"]) assert.ok(loadedFaces.includes(family), `${family} did not load on the Worker-served build: ${loadedFaces}`);
      assert.deepEqual(cspErrors, [], "the Worker-served build reports no CSP violations");
    } finally { await browser.close(); }
  }
  console.log("Local smoke passed: idempotent seed, admin login, D1, R2 roundtrip, KV, Durable Object, both native rate limits, scheduled cleanup and simulated email.");
} finally {
  if (child) {
    if (child.connected) child.send("shutdown");
    await Promise.race([once(child, "exit"), delay(4000)]);
    stopProcess(child);
    await writeFile(resolve(STATE, "local-smoke.log"), output);
  }
}
