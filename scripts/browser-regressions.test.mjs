// The runner's failure paths, against a real Chromium: a failing or hung
// script has to leave its page behind, not only be reported (issue #83).
// Run with `npm run test:browser:runner`; it needs `npx playwright install chromium`.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./browser-regressions.mjs";

const fixture = "scripts/browser-regressions.fixtures/page.mjs";
const quiet = () => {};

async function runFixture(t, mode, options = {}) {
  const diagnostics = mkdtempSync(join(tmpdir(), `browser-runner-${mode}-`));
  t.after(() => rmSync(diagnostics, { recursive: true, force: true }));
  process.env.FIXTURE_MODE = mode;
  try {
    return { diagnostics, result: await run(fixture, { diagnostics, timeout: 60_000, log: quiet, ...options }) };
  } finally {
    delete process.env.FIXTURE_MODE;
  }
}

function assertPageSaved(diagnostics) {
  for (const file of ["page-01.png", "page-01.html", "page-01.log"]) assert.ok(existsSync(join(diagnostics, file)), `${file} was saved`);
  assert.match(readFileSync(join(diagnostics, "page-01.html"), "utf8"), /Fixture page/);
  const log = readFileSync(join(diagnostics, "page-01.log"), "utf8");
  assert.match(log, /console\.log: fixture console marker/);
  assert.doesNotMatch(log, /screenshot failed|DOM capture failed/);
}

test("a passing script exits on its own and is not held open by the IPC channel", async t => {
  const { result } = await runFixture(t, "pass");
  assert.equal(result.passed, true);
  assert.equal(result.timedOut, false);
});

test("a failing script keeps a screenshot, DOM and log of its open page", async t => {
  const { diagnostics, result } = await runFixture(t, "fail");
  assert.equal(result.passed, false);
  assert.equal(result.timedOut, false);
  assert.ok(result.tail.some(line => line.includes("fixture failure")));
  assertPageSaved(diagnostics);
});

test("a script that runs out of time saves its page before it is stopped", async t => {
  // Long enough for Chromium to start and the page to render on a slow runner.
  const { diagnostics, result } = await runFixture(t, "hang", { timeout: 15_000, grace: 30_000 });
  assert.equal(result.passed, false);
  assert.equal(result.timedOut, true);
  assert.ok(result.tail.includes("READY"), "the page was open when time ran out");
  assert.equal(result.signal, null, "it exited after the capture instead of being killed");
  assertPageSaved(diagnostics);
});
