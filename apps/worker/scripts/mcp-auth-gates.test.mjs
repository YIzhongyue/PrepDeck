// Credentials and the gates in front of both MCP servers: the circuit
// breaker, the IP and per-account quotas, credential audience, revocation and
// expiry, and what an unauthenticated or malformed request is told.
// The harness is mcp-foundation-fixture.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRateLimiter } from "../../../tests/support/rate-limit.mjs";
import {
  worker, issueMcpCredential, hashMcpToken, createUserMcpAdapter, createAdminMcpAdapter, fixture, rpc, USER_TOOL_NAMES,
  ADMIN_TOOL_NAMES, payload, questionBankFixture, importFile,
} from "./mcp-foundation-fixture.mjs";

test("production root MCP endpoints bypass SPA fallback and each consume one IP quota", async (t) => {
  const f = await fixture(t);
  f.env.APP_BASE_URL = "https://prepdeck.example.com";
  const config = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  const workerFirst = JSON.parse(config.match(/^run_worker_first = (\[.+\])$/m)[1]);
  assert.ok(workerFirst.includes("/api/*"));
  for (const [audience, token, path] of [["user", f.alice.token, "/mcp"], ["admin", f.admin.token, "/admin-mcp"]]) {
    assert.ok(workerFirst.includes(path), `${path} must reach the Worker before SPA assets`);
    assert.ok(workerFirst.includes(`${path}/*`), "unknown MCP subpaths must not return the SPA");
    f.limits.length = 0;
    const response = await rpc(f.env, audience, token);
    assert.equal(response.status, 200);
    assert.deepEqual((await payload(response)).result.tools.map((tool) => tool.name),
      audience === "admin" ? ADMIN_TOOL_NAMES : USER_TOOL_NAMES);
    assert.equal(f.limits.filter(({ key }) => key.startsWith("write:ip:")).length, 1);
    const unknown = await worker.fetch(new Request(`${f.env.APP_BASE_URL}${path}/missing`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    }), f.env);
    assert.equal(unknown.status, 404);
    assert.equal((await payload(unknown)).error.code, "not_found");
  }
});

test("both root MCP endpoints reject traffic before authentication when circuit or IP gates deny it, using the same throttling envelope tool-level rejections use", async (t) => {
  const f = await fixture(t);
  const before = f.queries.length;
  // implementation — the circuit breaker and the global IP limiter both run
  // ahead of MCP auth/dispatch (mcp/routes.ts), so an MCP client sees their
  // rejections too, not just the per-account quota's. All three must share
  // one { ok, error: { code, message } } envelope instead of two of them
  // using the REST/browser-facing { error: "..." } shape.
  for (const mode of ["emergency", "degraded"]) {
    f.env.CIRCUIT_MODE = mode;
    for (const [audience, token] of [["user", f.alice.token], ["admin", f.admin.token]]) {
      const response = await rpc(f.env, audience, token);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("Retry-After"), "300");
      assert.equal(response.headers.get("X-PrepDeck-Circuit"), mode);
      assert.deepEqual(await payload(response), { ok: false, error: { code: "unavailable", message: "MCP is temporarily restricted." } });
    }
  }
  assert.equal(f.queries.length, before);
  assert.equal(f.limits.length, 0, "circuit must reject before shared rate-limit storage");
  f.env.CIRCUIT_MODE = "normal";

  f.env.RATE_LIMITER.respond = () => ({ allowed: false, retryAfter: 7 });
  for (const [audience, token] of [["user", f.alice.token], ["admin", f.admin.token]]) {
    const response = await rpc(f.env, audience, token);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "7");
    assert.deepEqual(await payload(response), { ok: false, error: { code: "rate_limited", message: "Too many requests for this endpoint." } });
  }
  assert.equal(f.queries.length, before, "IP gate must reject before credential lookup");

  // Same IP gate, unavailable rather than exceeded — fails closed (never
  // silently allows) with the same normalized envelope shape.
  f.env.RATE_LIMITER.respond = () => { throw new Error("simulated IP-limiter outage"); };
  for (const [audience, token] of [["user", f.alice.token], ["admin", f.admin.token]]) {
    const response = await rpc(f.env, audience, token);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "30");
    assert.deepEqual(await payload(response), { ok: false, error: { code: "unavailable", message: "Rate-limit service unavailable." } });
  }
  assert.equal(f.queries.length, before, "IP gate must reject before credential lookup even when unavailable");
});

test("server-specific credentials fail in both directions, including admins with User tokens", async (t) => {
  const f = await fixture(t);
  for (const [audience, token] of [["admin", f.alice.token], ["user", f.admin.token], ["admin", f.adminUser.token]]) {
    const before = f.queries.length;
    const response = await rpc(f.env, audience, token);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("WWW-Authenticate"), /^Bearer /);
    assert.equal((await payload(response)).error.code, "unauthenticated");
    assert.equal(f.queries.length, before, "wrong namespace must fail before credential lookup");
  }
  const forgedPrefix = f.alice.token.replace("_user_", "_admin_");
  assert.equal((await rpc(f.env, "admin", forgedPrefix)).status, 401);
});

test("hash lookup also enforces stored audience, never just the visible prefix", async (t) => {
  const f = await fixture(t);
  f.sqlite.prepare("UPDATE mcp_credentials SET server = 'admin' WHERE id = ?").run(f.alice.id);
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 401);
});

test("missing, malformed, unknown, cookie/Access-only and URL credentials cannot authenticate", async (t) => {
  const f = await fixture(t);
  for (const token of [undefined, "invalid", `pd_mcp_user_${"f".repeat(64)}`]) {
    assert.equal((await rpc(f.env, "user", token)).status, 401);
  }
  const browserOnly = await rpc(f.env, "user", undefined, "tools/list", undefined, { headers: {
    Cookie: `session=${f.alice.token}`, "Cf-Access-Jwt-Assertion": f.alice.token, "X-User-Id": "admin",
  } });
  assert.equal(browserOnly.status, 401);
  const url = await rpc(f.env, "user", undefined, "tools/list", undefined, { query: `?access_token=${f.alice.token}` });
  assert.equal(url.status, 400);
  assert.ok(!(await url.text()).includes(f.alice.token));
});

test("revocation, expiry, deletion, inactive users and admin demotion take effect on the next request", async (t) => {
  const f = await fixture(t);
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 200);
  f.sqlite.prepare("UPDATE mcp_credentials SET revoked_at = ? WHERE id = ?").run(Date.now(), f.alice.id);
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 401);
  f.sqlite.prepare("UPDATE mcp_credentials SET created_at = 0, expires_at = 1 WHERE id = ?").run(f.bob.id);
  assert.equal((await rpc(f.env, "user", f.bob.token)).status, 401);
  f.sqlite.prepare("UPDATE users SET role = 'user' WHERE id = 'admin'").run();
  assert.equal((await rpc(f.env, "admin", f.admin.token)).status, 403);
  f.sqlite.prepare("UPDATE users SET status = 'revoked' WHERE id = 'admin'").run();
  assert.equal((await rpc(f.env, "user", f.adminUser.token)).status, 403);
  f.sqlite.prepare("UPDATE users SET status = 'invited' WHERE id = 'admin'").run();
  assert.equal((await rpc(f.env, "user", f.adminUser.token)).status, 403);
  f.sqlite.prepare("DELETE FROM users WHERE id = 'admin'").run();
  assert.equal((await rpc(f.env, "admin", f.admin.token)).status, 401);
});

test("concurrent callers remain isolated and identity overrides are rejected", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([f.alice, f.bob, f.adminUser].map(async ({ token }) =>
    payload(await rpc(f.env, "user", token, "tools/call", { name: "user_get_identity", arguments: {} }))));
  assert.deepEqual(results.map((result) => result.result.structuredContent.data.userId), ["alice", "bob", "admin"]);
  for (const key of ["userId", "ownerId", "effectiveUserId", "role", "server", f.alice.token]) {
    const response = await rpc(f.env, "user", f.alice.token, "tools/call", {
      name: "user_get_identity", arguments: { [key]: f.admin.token },
    });
    const result = (await payload(response)).result;
    assert.equal(result.isError, true, `unexpectedly accepted ${key}`);
    assert.equal(result.structuredContent.error.code, "invalid_input");
    assert.ok(!JSON.stringify(result).includes(f.admin.token));
    assert.ok(!JSON.stringify(result).includes(f.alice.token));
  }
  // The SDK removes __proto__ before tool validation; it must never become
  // an inherited identity override or mutate the shared Object prototype.
  const prototype = (await payload(await rpc(f.env, "user", f.alice.token, "tools/call", {
    name: "user_get_identity", arguments: JSON.parse('{"__proto__":{"userId":"admin"}}'),
  }))).result;
  assert.equal(prototype.structuredContent.data.userId, "alice");
  assert.equal({}.userId, undefined);
  const result = (await payload(await rpc(f.env, "user", f.alice.token, "tools/call", { name: "admin_get_identity" }))).result;
  assert.equal(result.structuredContent.error.code, "not_found");
  assert.throws(() => createAdminMcpAdapter({ audience: "user", userId: "admin" }), /not authorized/);
  assert.throws(() => createUserMcpAdapter({ audience: "admin", userId: "admin" }), /not authorized/);
});

test("tokens are hashed at rest and provisioning cannot elevate ordinary/inactive accounts", async (t) => {
  const f = await fixture(t);
  const rows = f.sqlite.prepare("SELECT * FROM mcp_credentials").all();
  assert.equal(rows.length, 4);
  assert.equal(rows.find((row) => row.id === f.alice.id).token_hash, await hashMcpToken(f.alice.token));
  assert.ok(!JSON.stringify(rows).includes(f.alice.token));
  assert.ok(!JSON.stringify(f.queries).includes(f.alice.token));
  for (const userId of ["alice", "missing"]) {
    await assert.rejects(issueMcpCredential(f.DB, { userId, audience: "admin", name: "x", expiresAt: Date.now() + 60_000 }), /not authorized/);
  }
  await assert.rejects(issueMcpCredential(f.DB, { userId: "alice", audience: "user", name: "x", expiresAt: 0 }), /Invalid/);
  await assert.rejects(issueMcpCredential(f.DB, { userId: "alice", audience: "user", name: "  " }), /Invalid/);
});

test("origin, method, byte limits, malformed protocol and unknown tool errors are bounded and redacted", async (t) => {
  const f = await fixture(t);
  for (const origin of ["https://evil.test", "null", "https://prepdeck.test.evil.test"]) {
    assert.equal((await rpc(f.env, "user", f.alice.token, "tools/list", undefined, { headers: { Origin: origin } })).status, 403);
  }
  for (const method of ["GET", "DELETE", "OPTIONS"]) {
    const response = await rpc(f.env, "user", f.alice.token, "tools/list", undefined, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "POST");
  }
  const large = await rpc(f.env, "user", f.alice.token, "tools/list", undefined, { body: "a".repeat(65537) });
  assert.equal(large.status, 400);
  for (const body of ["{", JSON.stringify({ jsonrpc: "2.0", id: 1, method: f.alice.token }),
    JSON.stringify({ jsonrpc: "2.0", id: f.alice.token, method: "missing" }),
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: f.alice.token, arguments: f.admin.token } })]) {
    const response = await rpc(f.env, "user", f.alice.token, "tools/list", undefined, { body });
    const result = await payload(response);
    assert.ok(result.error || result.result?.isError);
    assert.ok(!JSON.stringify(result).includes(f.alice.token));
    assert.ok(!JSON.stringify(result).includes(f.admin.token));
  }
});

test("D1/SDK errors never reach logs or clients with raw token text", async (t) => {
  const f = await fixture(t);
  const logs = [];
  for (const level of ["error", "warn", "log", "info", "debug"]) t.mock.method(console, level, (...args) => logs.push(args));
  f.env.DB = { prepare() { throw new Error(`database error ${f.alice.token}`); } };
  const response = await rpc(f.env, "user", f.alice.token);
  assert.equal(response.status, 500);
  assert.equal((await payload(response)).error.code, "internal");
  assert.deepEqual(logs, []);
});

test("MCP inherits circuit/IP protection and has independent fail-closed account quotas", async (t) => {
  const f = await fixture(t);
  f.env.CIRCUIT_MODE = "emergency";
  const before = f.queries.length;
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 503);
  assert.equal(f.queries.length, before);
  f.env.CIRCUIT_MODE = "normal";
  await rpc(f.env, "user", f.alice.token);
  await rpc(f.env, "admin", f.admin.token);
  assert.ok(f.limits.some(({ key }) => key === "write:ip:v4:192.0.2.1"));
  assert.ok(f.limits.some(({ key, max }) => key === "mcp:user:user:alice" && max === 60));
  assert.ok(f.limits.some(({ key, max }) => key === "mcp:admin:user:admin" && max === 30));
  f.env.RATE_LIMITER.respond = ({ key }) => {
    if (key.startsWith("mcp:")) throw new Error(f.alice.token);
    return { allowed: true, retryAfter: 1 };
  };
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 503);
  f.env.RATE_LIMITER.respond = () => ({ allowed: false, retryAfter: 7 });
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 429);
});

test("implementation: the per-account MCP quota really counts requests, is independent per user/audience, and survives token rotation", async (t) => {
  const f = await fixture(t);
  // A limiter that really counts per key (unlike the fixture's always-allow
  // one), so the test proves real exhaustion, not only a mocked denial.
  f.env.RATE_LIMITER = createRateLimiter({ counting: true });
  f.env.MCP_USER_RATE_LIMIT_PER_MINUTE = "2";

  // Exhaust alice's quota with real counting, not a mocked denial.
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 200);
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 200);
  const exhausted = await rpc(f.env, "user", f.alice.token);
  assert.equal(exhausted.status, 429);
  assert.equal((await payload(exhausted)).error.code, "rate_limited");

  // Bob — a different account under the same audience — is unaffected: the
  // quota key is scoped per userId, not shared across the whole audience.
  assert.equal((await rpc(f.env, "user", f.bob.token)).status, 200);

  // Admin — a different audience entirely — is unaffected: exhausting the
  // User MCP quota can never throttle or bypass the Admin MCP one.
  assert.equal((await rpc(f.env, "admin", f.admin.token)).status, 200);

  // implementation review — the case above changes both account (alice -> admin)
  // and audience (user -> admin) at once, which doesn't isolate audience as
  // its own variable. The admin account also holds a separate User MCP
  // credential (f.adminUser); exhausting *that* quota (same account,
  // different audience from f.admin) must still leave the account's Admin
  // MCP credential usable — proving the quota key is scoped per
  // (audience, userId), not just per userId.
  assert.equal((await rpc(f.env, "user", f.adminUser.token)).status, 200);
  assert.equal((await rpc(f.env, "user", f.adminUser.token)).status, 200);
  const adminUserExhausted = await rpc(f.env, "user", f.adminUser.token);
  assert.equal(adminUserExhausted.status, 429, "the admin account's own User MCP quota must exhaust independently");
  assert.equal(
    (await rpc(f.env, "admin", f.admin.token)).status, 200,
    "the same account's Admin MCP credential must remain usable after its User MCP quota is exhausted",
  );

  // Rotating alice's credential must not reset her exhausted quota: the key
  // is scoped to userId (mcp/routes.ts), never credentialId, specifically so
  // rotation/revoke-and-reissue can't be used to evade throttling.
  const rotated = await issueMcpCredential(f.DB, { userId: "alice", audience: "user", name: "rotated", expiresAt: Date.now() + 60_000 });
  f.sqlite.prepare("UPDATE mcp_credentials SET revoked_at = ? WHERE id = ?").run(Date.now(), f.alice.id);
  const afterRotation = await rpc(f.env, "user", rotated.token);
  assert.equal(afterRotation.status, 429, "a fresh credential for the same account must still be quota-exhausted");
  assert.equal((await payload(afterRotation)).error.code, "rate_limited");
});

test("implementation: non-expiring credentials authenticate indefinitely and successful use updates last_used_at", async (t) => {
  const f = await fixture(t);
  const forever = await issueMcpCredential(f.DB, { userId: "alice", audience: "user", name: "never expires" });
  assert.equal(forever.expiresAt, null);
  const before = f.sqlite.prepare("SELECT last_used_at FROM mcp_credentials WHERE id = ?").get(forever.id).last_used_at;
  assert.equal(before, null);
  assert.equal((await rpc(f.env, "user", forever.token)).status, 200);
  const after = f.sqlite.prepare("SELECT last_used_at FROM mcp_credentials WHERE id = ?").get(forever.id).last_used_at;
  assert.ok(typeof after === "number" && after > 0);
});

test("implementation: User MCP credentials cannot invoke any Admin MCP mutation tool", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "single_choice", stem: "Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const calls = [
    ["admin_preview_component_question", { examId: "examA", question: {} }],
    ["admin_validate_question_payload", { examId: "examA", payload: fields }],
    ["admin_create_question", { examId: "examA", payload: fields, proposalToken: "0".repeat(64), proposalId: crypto.randomUUID() }],
    ["admin_update_question", { examId: "examA", id: "q1", expectedRevision: 1, payload: fields, proposalToken: "0".repeat(64) }],
    ["admin_delete_question", { examId: "examA", id: "q1", expectedRevision: 1 }],
    ["admin_batch_create_questions", { examId: "examA", items: [{ payload: fields, proposalToken: "0".repeat(64), proposalId: crypto.randomUUID() }] }],
    ["admin_batch_update_questions", { examId: "examA", items: [{ id: "q1", expectedRevision: 1, proposalToken: "0".repeat(64), payload: fields }] }],
  ];
  for (const [name, args] of calls) {
    const response = await payload(await rpc(f.env, "user", f.alice.token, "tools/call", { name, arguments: args }));
    assert.equal(response.result.structuredContent.error.code, "not_found", `${name} must not exist on the User MCP catalog`);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_audit_log").get().c, 0);
});

test("implementation: User MCP credentials cannot invoke any new Admin MCP tool", async (t) => {
  const f = await questionBankFixture(t);
  const calls = [
    ["admin_create_exam", { slug: "x", name: "X" }],
    ["admin_update_exam", { id: "examA", name: "X" }],
    ["admin_archive_exam", { id: "examA" }],
    ["admin_validate_import", { examId: "examA", file: importFile([{}]) }],
    ["admin_preview_import", { examId: "examA", file: importFile([{}]) }],
    ["admin_execute_import", { examId: "examA", file: importFile([{}]), importId: crypto.randomUUID(), importToken: "0".repeat(64) }],
    ["admin_get_import_status", { importId: crypto.randomUUID() }],
    ["admin_create_tag", { name: "x" }],
    ["admin_update_tag", { name: "x", newName: "y" }],
    ["admin_merge_tags", { names: ["x"], targetName: "y" }],
  ];
  for (const [name, args] of calls) {
    const response = await payload(await rpc(f.env, "user", f.alice.token, "tools/call", { name, arguments: args }));
    assert.equal(response.result.structuredContent.error.code, "not_found", `${name} must not exist on the User MCP catalog`);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_audit_log").get().c, 0);
});
