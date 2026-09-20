import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("AI relay logs failures only through the single redacted helper, never response bodies or secrets", () => {
  const source = readFileSync(new URL("../src/routes/ai.ts", import.meta.url), "utf8");

  // Every console.*(...) call (dot or bracket access) must come from the one
  // designated helper (logAiFailure) — any other call site would bypass its
  // fixed, bounded payload shape.
  const consoleCalls = source.match(/console\s*(?:\.\s*\w+|\[[^\]]*\])\s*\(/g) ?? [];
  assert.equal(consoleCalls.length, 1, `expected exactly one console.*() call site, found ${consoleCalls.length}`);

  const helperMatch = source.match(/function logAiFailure\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(helperMatch, "logAiFailure helper not found");
  const helperBody = helperMatch[1];

  // The helper's payload must never reference request/response bodies, the
  // caller's API key, the rendered prompt, or the generated explanation text.
  for (const forbidden of ["apiKey", "res.text", "prompt", "content", "questionId", "userId", "user.id"]) {
    assert.ok(!helperBody.includes(forbidden), `logAiFailure must not reference ${forbidden}`);
  }

  assert.doesNotMatch(source, /debugLog/);
  assert.doesNotMatch(source, /res\.text\s*\(/);
});

test("high-frequency log scenarios stay within their byte budgets", () => {
  const output = execFileSync(
    process.execPath,
    [fileURLToPath(new URL("./estimate-log-volume.mjs", import.meta.url))],
    { encoding: "utf8" }
  );
  assert.match(output, /AI upstream failures/);
});


test("MCP Analytics Engine volume stays within its independent budget without a Workers Logs sampling discount", () => {
  const output = JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(new URL("./estimate-mcp-metric-volume.mjs", import.meta.url))], { encoding: "utf8" }));
  assert.equal(output.workersLogsHeadSampleApplied, false);
  assert.equal(output.scenarios.length, 3);
  for (const scenario of output.scenarios) {
    assert.equal(scenario.requests, 100_000);
    assert.ok(scenario.maxPointBytes < 512);
    assert.ok(scenario.bytesPerRequest < 1024);
    assert.equal(scenario.pointsPerRequest, scenario.scenario === "tool_call" ? 2 : 1);
  }
});
