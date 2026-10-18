// MCP request and tool metrics: what is counted, how each failure is
// labelled, and that nothing private reaches the Analytics Engine.
// The harness is mcp-foundation-fixture.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  worker, McpObservation, MAX_MCP_TOOL_METRICS, toolResult, fixture, rpc, payload, questionBankFixture, callAdminTool,
  metric, lastMetric,
} from "./mcp-foundation-fixture.mjs";

test("implementation metrics: independent audiences count initialization, catalogs and calls once, including legacy SSE", async (t) => {
  const f = await fixture(t);
  for (const [audience, token] of [["user", f.alice.token], ["admin", f.admin.token]]) {
    for (const version of ["2026-07-28", "2025-11-25"]) {
      for (const [method, params] of [
        [version === "2026-07-28" ? "server/discover" : "initialize", version === "2026-07-28" ? {} : { protocolVersion: version, capabilities: {}, clientInfo: { name: "PRIVATE_CLIENT", version: "1" } }],
        ["tools/list", {}], ["tools/call", { name: `${audience}_get_identity` }],
      ]) {
        f.metrics.length = 0;
        const response = await rpc(f.env, audience, token, method, params, { headers: { "MCP-Protocol-Version": version } });
        assert.equal(response.status, 200);
        const result = await payload(response);
        assert.ok(result.result);
        const request = lastMetric(f);
        assert.equal(f.metrics.length, method === "tools/call" ? 2 : 1);
        assert.equal(request.audience, audience);
        assert.equal(request.method, method);
        assert.equal(request.auth, "success");
        assert.equal(request.outcome, "success");
        assert.equal(request.error, "none");
        assert.equal(request.httpStatus, 200);
        assert.equal(request.count, 1);
        assert.equal(request.transport, response.headers.get("Content-Type").includes("event-stream") ? "sse" : "json");
        assert.ok(request.durationMs >= 0 && request.durationMs <= 3_600_000);
        if (method === "tools/call") assert.equal(lastMetric(f, "tool").tool, `${audience}_get_identity`);
      }
    }
  }
});

test("implementation metrics: auth categories keep the outward contract and never add a credential lookup", async (t) => {
  const f = await fixture(t);
  for (const [token, outcome] of [[undefined, "missing"], ["private-malformed", "malformed"],
    [f.admin.token, "wrong_audience"], [`pd_mcp_user_${"f".repeat(64)}`, "invalid_or_expired_or_revoked"]]) {
    const before = f.queries.length;
    assert.equal((await rpc(f.env, "user", token)).status, 401);
    assert.equal(lastMetric(f).auth, outcome);
    assert.equal(lastMetric(f).error, "unauthenticated");
    assert.equal(lastMetric(f).stage, "auth");
    assert.equal(f.queries.length - before, outcome === "invalid_or_expired_or_revoked" ? 1 : 0);
  }
  f.sqlite.prepare("UPDATE mcp_credentials SET created_at = 0, expires_at = 1 WHERE id = ?").run(f.alice.id);
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 401);
  assert.equal(lastMetric(f).auth, "invalid_or_expired_or_revoked");
  f.sqlite.prepare("UPDATE mcp_credentials SET revoked_at = 1 WHERE id = ?").run(f.bob.id);
  assert.equal((await rpc(f.env, "user", f.bob.token)).status, 401);
  assert.equal(lastMetric(f).auth, "invalid_or_expired_or_revoked");
  f.sqlite.prepare("UPDATE users SET role = 'user' WHERE id = 'admin'").run();
  assert.equal((await rpc(f.env, "admin", f.admin.token)).status, 403);
  assert.equal(lastMetric(f).auth, "account_not_authorized");
  f.sqlite.prepare("UPDATE users SET status = 'revoked' WHERE id = 'admin'").run();
  assert.equal((await rpc(f.env, "user", f.adminUser.token)).status, 403);
  assert.equal(lastMetric(f).auth, "account_not_authorized");
  f.env.DB = { prepare() { throw new Error("PRIVATE_SQL_ERROR"); } };
  assert.equal((await rpc(f.env, "admin", f.admin.token)).status, 500);
  assert.equal(lastMetric(f).auth, "internal");
  assert.equal(lastMetric(f).error, "internal");
  assert.ok(!JSON.stringify(f.metrics).includes("PRIVATE_SQL_ERROR"));
});

test("implementation metrics: circuit, IP and account rejects remain distinguishable without extra storage", async (t) => {
  const f = await fixture(t);
  const baselineQueries = f.queries.length;
  for (const [audience, token] of [["user", f.alice.token], ["admin", f.admin.token]]) {
    for (const mode of ["degraded", "emergency", "invalid-config"]) {
      f.env.CIRCUIT_MODE = mode;
      assert.equal((await rpc(f.env, audience, token)).status, 503);
      assert.equal(lastMetric(f).stage, "circuit");
      assert.equal(lastMetric(f).mode, mode === "degraded" ? "degraded" : "emergency");
      assert.equal(lastMetric(f).auth, "not_attempted");
    }
  }
  assert.equal(f.queries.length, baselineQueries);
  assert.equal(f.limits.length, 0);
  f.env.CIRCUIT_MODE = "";
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 200);
  assert.equal(lastMetric(f).mode, "normal");
  const afterSuccessQueries = f.queries.length;
  f.env.CIRCUIT_MODE = "normal";
  for (const gate of ["ip_limit", "account_limit"]) {
    for (const unavailable of [false, true]) {
      f.env.RATE_LIMITER.respond = ({ key }) => {
        if (gate === "ip_limit" || key.startsWith("mcp:")) {
          if (unavailable) throw new Error("PRIVATE_LIMITER_KEY");
          return { allowed: false, retryAfter: 7 };
        }
        return { allowed: true };
      };
      for (const [audience, token] of [["user", f.alice.token], ["admin", f.admin.token]]) {
        f.metrics.length = 0;
        const response = await rpc(f.env, audience, token);
        assert.equal(response.status, unavailable ? 503 : 429);
        assert.equal(lastMetric(f).stage, gate);
        assert.equal(lastMetric(f).error, unavailable ? "unavailable" : "rate_limited");
        assert.equal(lastMetric(f).auth, gate === "ip_limit" ? "not_attempted" : "success");
        assert.equal(f.metrics.length, 1);
      }
      if (gate === "ip_limit") assert.equal(f.queries.length, afterSuccessQueries);
    }
  }
});

test("implementation metrics: routing, origin, methods, body bounds and protocol errors do not look successful", async (t) => {
  const f = await fixture(t);
  for (const [options, stage, code] of [
    [{ query: "/PRIVATE_PATH" }, "routing", "not_found"],
    [{ headers: { Origin: "https://private-origin.invalid" } }, "origin", "unauthorized"],
    [{ query: "?token=PRIVATE_QUERY" }, "origin", "invalid_input"],
    [{ method: "GET" }, "method", "method_not_allowed"],
    [{ body: "x".repeat(1_048_577) }, "protocol", "invalid_input"],
    [{ body: "{" }, "protocol", "invalid_input"],
    [{ body: JSON.stringify({ jsonrpc: "2.0", id: "PRIVATE_ID", method: "PRIVATE_METHOD" }) }, "protocol", "not_found"],
  ]) {
    f.metrics.length = 0;
    await rpc(f.env, "user", f.alice.token, "tools/list", undefined, options);
    assert.equal(lastMetric(f).stage, stage);
    assert.equal(lastMetric(f).error, code);
    assert.equal(lastMetric(f).outcome, "error");
    assert.equal(f.metrics.length, 1);
    assert.ok(!JSON.stringify(f.metrics).includes("PRIVATE_"));
  }
  for (const version of ["2026-07-28", "2025-11-25"]) {
    await rpc(f.env, "user", f.alice.token, "tools/list", { cursor: "PRIVATE_CURSOR" }, { headers: { "MCP-Protocol-Version": version } });
    assert.equal(lastMetric(f).error, "invalid_input", "SDK protocol errors must be recorded even inside HTTP 200");
  }
});

test("implementation metrics: HTTP 200 tool errors and operation quota failures have fixed error codes", async (t) => {
  const f = await questionBankFixture(t);
  for (const [name, args, code] of [
    ["PRIVATE_UNKNOWN_TOOL", {}, "not_found"],
    ["admin_get_identity", { PRIVATE_INPUT: "PRIVATE_ARGUMENT" }, "invalid_input"],
    ["admin_get_exam", { id: "PRIVATE_MISSING_EXAM" }, "not_found"],
  ]) {
    const response = await rpc(f.env, "admin", f.admin.token, "tools/call", { name, arguments: args });
    assert.equal(response.status, 200);
    assert.equal((await payload(response)).result.isError, true);
    assert.equal(lastMetric(f).error, code);
    assert.equal(lastMetric(f, "tool").error, code);
    assert.equal(lastMetric(f, "tool").tool, name.startsWith("PRIVATE_") ? "unknown" : name);
  }
  for (const unavailable of [false, true]) {
    f.env.RATE_LIMITER.respond = ({ key }) => {
      if (key.endsWith(":mutation")) {
        if (unavailable) throw new Error("PRIVATE_QUOTA_OUTAGE");
        return { allowed: false, retryAfter: 12 };
      }
      return { allowed: true };
    };
    const response = await rpc(f.env, "admin", f.admin.token, "tools/call", { name: "admin_create_tag", arguments: { name: "PRIVATE_TAG" } });
    assert.equal(response.status, 200);
    assert.equal(lastMetric(f, "tool").kind, "admin_mutation");
    assert.equal(lastMetric(f, "tool").error, unavailable ? "unavailable" : "rate_limited");
    assert.equal(lastMetric(f).error, unavailable ? "unavailable" : "rate_limited");
  }
  assert.ok(!JSON.stringify(f.metrics).includes("PRIVATE_"));
});

test("implementation metrics: actual batch partial outcomes, skips and retries do not inflate new-item counts", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "fill_blank", stem: "PRIVATE_QUESTION", correctAnswers: ["PRIVATE_ANSWER"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  assert.equal(lastMetric(f, "tool").kind, "other");
  const good = { payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId };
  const bad = { payload: fields, proposalToken: "0".repeat(64), proposalId: crypto.randomUUID() };
  const first = await callAdminTool(f, "admin_batch_create_questions", { examId: "examA", items: [good, bad] });
  assert.equal(first.created, 1);
  assert.equal(lastMetric(f, "tool").outcome, "partial");
  assert.equal(lastMetric(f).outcome, "partial");
  assert.equal(lastMetric(f, "tool").created, 1);
  assert.equal(lastMetric(f, "tool").skipped, 1);
  await callAdminTool(f, "admin_batch_create_questions", { examId: "examA", items: [good] });
  assert.equal(lastMetric(f, "tool").outcome, "replayed");
  assert.equal(lastMetric(f, "tool").created, 0);
  assert.equal(lastMetric(f, "tool").replayed, 1);
  await callAdminTool(f, "admin_batch_create_questions", { examId: "examA", items: [bad] });
  assert.equal(lastMetric(f, "tool").outcome, "skipped");
  assert.ok(!JSON.stringify(f.metrics).includes("PRIVATE_"));
  assert.ok(!JSON.stringify(f.metrics).includes(first.outcomes[0].questionId));
});

test("implementation metrics: import mixed/failure/replay summaries and slow calls use only bounded numbers", () => {
  const points = [];
  const env = { MCP_METRICS: { writeDataPoint: (point) => points.push(point) } };
  for (const [data, expected] of [
    [{ outcomes: [{ status: "created" }, { status: "updated" }, { status: "failed" }, { status: "conflict" }] }, "partial"],
    [{ outcomes: [{ status: "failed" }] }, "failed"],
    [{ outcomes: [{ status: "conflict" }] }, "skipped"],
    [{ idempotentReplay: true, outcomes: [{ status: "created" }] }, "replayed"],
  ]) {
    const observation = new McpObservation(env, "admin");
    observation.tool("admin_execute_import", toolResult({ ok: true, data }), performance.now() - 1500);
    observation.finish(200);
    const result = metric(points.at(-2));
    assert.equal(result.outcome, expected);
    assert.equal(metric(points.at(-1)).outcome, expected);
    assert.equal(result.kind, "admin_mutation");
    assert.equal(result.slow, 1);
    assert.ok(result.durationMs >= 1500);
    if (expected === "replayed") assert.equal(result.created, 0);
    if (expected === "partial") assert.deepEqual([result.created, result.updated, result.failed, result.conflict], [1, 1, 1, 1]);
  }
});

test("implementation metrics: disabled, absent and throwing sinks leave auth, tool writes and audit unchanged", async (t) => {
  const f = await questionBankFixture(t);
  const logs = [];
  for (const level of ["error", "warn", "log", "info", "debug"]) t.mock.method(console, level, (...args) => logs.push(args));
  for (const mode of ["disabled", "absent", "throwing"]) {
    f.env.MCP_METRICS_ENABLED = mode === "disabled" ? "false" : "true";
    f.env.MCP_METRICS = mode === "absent" ? undefined : { writeDataPoint() { throw new Error("PRIVATE_SINK_ERROR"); } };
    assert.equal((await rpc(f.env, "user")).status, 401);
    await callAdminTool(f, "admin_create_tag", { name: `test-${mode}` });
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_audit_log WHERE tool = 'admin_create_tag' AND outcome = 'success'").get().c, 3);
  assert.equal(f.metrics.length, 0);
  assert.deepEqual(logs, []);
});

test("implementation metrics: high-volume rejects and malicious labels stay compact without console output", async (t) => {
  const f = await fixture(t);
  const logs = [];
  for (const level of ["error", "warn", "log", "info", "debug"]) t.mock.method(console, level, (...args) => logs.push(args));
  for (let i = 0; i < 100; i++) {
    await rpc(f.env, "user", `PRIVATE_TOKEN_${i}`, "PRIVATE_METHOD", undefined, {
      query: `/PRIVATE_PATH_${i}`, headers: { Cookie: "PRIVATE_COOKIE", "User-Agent": `PRIVATE_AGENT_${i}` },
    });
  }
  assert.equal(f.metrics.length, 100);
  assert.equal(new Set(f.metrics.map((point) => JSON.stringify(point.blobs))).size, 1);
  assert.ok(f.metrics.every((point) => Buffer.byteLength(JSON.stringify(point)) < 512));
  assert.ok(!JSON.stringify(f.metrics).includes("PRIVATE_"));
  assert.deepEqual(logs, []);
  f.metrics.length = 0;
  const observation = new McpObservation(f.env, "user");
  for (let i = 0; i < 300; i++) observation.tool(undefined, toolResult({ ok: false, error: { code: `PRIVATE_${i}` } }, true), performance.now());
  observation.finish(200);
  observation.finish(200);
  assert.equal(f.metrics.length, MAX_MCP_TOOL_METRICS + 1, "below Analytics Engine's per-invocation point cap, with one request summary");
  assert.equal(lastMetric(f).omittedTools, 300 - MAX_MCP_TOOL_METRICS);
  assert.ok(f.metrics.every((point) => point.blobs[6] === "internal"));
  assert.ok(f.metrics.every((point) => Buffer.byteLength(JSON.stringify(point)) < 512));
});

test("implementation metrics: prod/development bindings are separate and telemetry does not collect REST requests", async (t) => {
  const f = await fixture(t);
  await worker.fetch(new Request(`${f.env.APP_BASE_URL}/api/health`), f.env);
  assert.equal(f.metrics.length, 0);
  const config = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(config, /\[\[analytics_engine_datasets\]\]\s+binding = "MCP_METRICS"\s+dataset = "prepdeck_mcp_metrics"/);
  assert.match(config, /\[\[env\.development\.analytics_engine_datasets\]\]\s+binding = "MCP_METRICS"\s+dataset = "prepdeck_mcp_metrics_development"/);
});
