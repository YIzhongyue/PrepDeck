import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { componentQuestion } from "../../../tests/fixtures/mcp-presentation/question.mjs";

// Exercise the real Worker entry and SDK (Workers export conditions), not
// a hand-written JSON-RPC imitation or a mock token verifier.
const [{ text }] = (await build({
  stdin: {
    contents: `export { default as worker } from './src/index.ts';
      export * from './src/mcp/credentials.ts';
      export * from './src/mcp/conventions.ts';
      export * from './src/mcp/catalog.ts';
      export * from './src/mcp/errors.ts';
      export * from './src/mcp/adapter.ts';
      export * from './src/mcp/runtime.ts';
      export * from './src/mcp/observability.ts';`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, format: "esm", platform: "node", conditions: ["workerd"], write: false,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
})).outputFiles;
const buildDir = await mkdtemp(join(tmpdir(), "prepdeck-mcp-test-"));
after(() => rm(buildDir, { recursive: true, force: true }));
const bundlePath = join(buildDir, "worker.mjs");
await writeFile(bundlePath, text);
const {
  worker, issueMcpCredential, hashMcpToken, paginationSchema, pageResult,
  defineMcpTool, McpApplicationError, createUserMcpAdapter, createAdminMcpAdapter,
  McpObservation, MAX_MCP_TOOL_METRICS, toolResult,
} = await import(pathToFileURL(bundlePath).href);
const { z } = await import("zod");

// Only the migrations implementation's Admin MCP read tools actually query
// against (exam/provider/badge columns, pass_mark_pct, question authoring's
// revision columns, plus credentials) — not the full migration history.
const schemaFiles = [
  "0001_init.sql", "0003_exam_management_columns.sql", "0004_attempts_and_grading.sql",
  "0009_learning_mode.sql", "0010_exam_badge_icon.sql", "0011_exam_providers.sql", "0015_question_authoring.sql",
  "0017_mcp_credentials.sql", "0018_mcp_credential_names.sql", "0019_admin_mcp_audit_log.sql",
  "0020_admin_mcp_create_idempotency.sql", "0021_admin_mcp_audit_log_targets.sql", "0022_question_bank_tags.sql",
  "0023_admin_mcp_import_jobs.sql", "0024_admin_mcp_import_committed_items.sql",
  "0026_question_tag_links.sql", "0027_drop_questions_tags_json.sql",
  "0033_question_needs_review.sql", "0034_question_components.sql",
];
// implementation's import tools write import_logs (0002 predates schemaFiles'
// question-authoring cut, but import_logs itself is defined in 0001).
const schema = (await Promise.all(schemaFiles.map((name) =>
  readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8")))).join("\n");

async function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(schema);
  for (const [id, role] of [["alice", "user"], ["bob", "user"], ["admin", "admin"]]) {
    sqlite.prepare("INSERT INTO users (id, email, role, status, created_at) VALUES (?, ?, ?, 'active', ?)")
      .run(id, `${id}@example.test`, role, new Date().toISOString());
  }
  const queries = [];
  const DB = { prepare(sql) {
    // Real D1's PreparedStatement exposes first()/run()/all() directly (a
    // parameterless query never needs bind()), in addition to after bind().
    // `queries` is only appended when a method actually runs, not when the
    // statement is merely prepared/bound, matching the assertions below
    // that count executed queries.
    const methodsFor = (args) => ({
      first: async () => { queries.push({ sql, args }); return sqlite.prepare(sql).get(...args) ?? null; },
      run: async () => { queries.push({ sql, args }); return { meta: { changes: sqlite.prepare(sql).run(...args).changes } }; },
      all: async () => { queries.push({ sql, args }); return { results: sqlite.prepare(sql).all(...args) }; },
    });
    return { bind: (...args) => methodsFor(args), ...methodsFor([]) };
  } };
  // implementation — D1's real batch() is one implicit transaction: all-or-nothing
  // on a throw, not "run whatever succeeded." Mirrors question-authoring.test.mjs's shim.
  DB.batch = async (statements) => {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  };
  const limits = [];
  const kvInvalidations = [];
  const importRateLimitCalls = [];
  // implementation — in-memory R2 fake for import archiving, same shape as
  // scripts/import-validation.test.mjs's fake bucket.
  const bucketObjects = new Map();
  const BUCKET = {
    put: async (key, value) => { bucketObjects.set(key, { body: value, uploaded: new Date() }); },
    get: async (key) => bucketObjects.has(key) ? { body: bucketObjects.get(key).body } : null,
    list: async ({ prefix }) => ({
      objects: [...bucketObjects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, v]) => ({ key, uploaded: v.uploaded })),
      truncated: false,
    }),
    delete: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) bucketObjects.delete(key); },
  };
  const metrics = [];
  const env = {
    MCP_METRICS_ENABLED: "true", MCP_METRICS: { writeDataPoint: (point) => metrics.push(structuredClone(point)) },
    DB, ENVIRONMENT: "production", APP_BASE_URL: "https://prepdeck.test", AUTH_MODE: "cookie",
    KV: { get: async () => null, put: async () => {}, delete: async (key) => { kvInvalidations.push(key); } },
    RATE_LIMITER: { idFromName: (key) => key, get: (key) => ({ fetch: async (_url, request) => {
      limits.push({ key, ...JSON.parse(request.body) });
      return Response.json({ allowed: true, retryAfter: 60 });
    } }) },
    BUCKET,
    IMPORT_VALIDATE_RATE_LIMITER: { limit: async ({ key }) => { importRateLimitCalls.push({ kind: "validate", key }); return { success: true }; } },
    IMPORT_EXECUTE_RATE_LIMITER: { limit: async ({ key }) => { importRateLimitCalls.push({ kind: "execute", key }); return { success: true }; } },
  };
  const expiresAt = Date.now() + 60_000;
  const alice = await issueMcpCredential(DB, { userId: "alice", audience: "user", name: "alice's token", expiresAt });
  const bob = await issueMcpCredential(DB, { userId: "bob", audience: "user", name: "bob's token", expiresAt });
  const admin = await issueMcpCredential(DB, { userId: "admin", audience: "admin", name: "admin's token", expiresAt });
  const adminUser = await issueMcpCredential(DB, { userId: "admin", audience: "user", name: "admin's user token", expiresAt });
  return { sqlite, DB, env, metrics, queries, limits, kvInvalidations, importRateLimitCalls, bucketObjects, alice, bob, admin, adminUser };
}

// implementation — a stateful rate-limiter stub that actually counts per key
// (unlike the fixture's default always-allow stub), so a quota test can
// prove real exhaustion behaviour instead of only a mocked denial.
function statefulRateLimiter() {
  const counts = new Map();
  return { idFromName: (key) => key, get: (key) => ({
    fetch: async (_url, init) => {
      const { max } = JSON.parse(init.body);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return Response.json({ allowed: count <= max, retryAfter: 60 });
    },
  }) };
}

function rpc(env, audience, token, method = "tools/list", params, options = {}) {
  const headers = new Headers({
    "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25", "CF-Connecting-IP": "192.0.2.1",
    "Mcp-Method": method,
    ...(params?.name ? { "Mcp-Name": params.name } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers,
  });
  if (headers.get("MCP-Protocol-Version") === "2026-07-28") params = {
    ...params, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
  const path = audience === "admin" ? "/admin-mcp" : "/mcp";
  return worker.fetch(new Request(`${env.APP_BASE_URL}${path}${options.query ?? ""}`, {
    method: options.method ?? "POST", headers,
    ...((options.method ?? "POST") === "POST" ? { body: options.body ?? JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) } : {}),
  }), env);
}

// implementation — expected User MCP catalog, in registration order.
// implementation adds the Knowledge Points tools at the end.
const USER_TOOL_NAMES = [
  "user_get_identity",
  "user_get_import_schemas",
  "user_get_learning_overview", "user_get_exam_progress", "user_get_learning_stats",
  "user_list_attempts", "user_get_attempt", "user_get_recent_attempts",
  "user_get_wrong_questions", "user_get_bookmarked_questions", "user_get_unattempted_questions",
  "user_search_questions", "user_get_question", "user_present_question", "user_list_exams", "user_get_exam", "user_list_question_tags",
  "user_get_recommended_questions", "user_get_questions_for_review", "user_get_practice_candidates",
  "user_list_annotations", "user_get_annotations_for_question",
  "user_list_knowledge_points", "user_search_knowledge_points", "user_get_knowledge_point",
  "user_get_knowledge_points_for_question", "user_list_knowledge_point_groups", "user_list_knowledge_point_tags",
  "user_create_knowledge_point", "user_update_knowledge_point", "user_delete_knowledge_point",
  "user_link_knowledge_point_question", "user_unlink_knowledge_point_question",
  "user_create_knowledge_point_group", "user_rename_knowledge_point_group", "user_delete_knowledge_point_group",
  "user_create_knowledge_point_tag", "user_rename_knowledge_point_tag", "user_delete_knowledge_point_tag",
  "user_unlink_knowledge_point_tag", "user_reorder_knowledge_points",
];

// implementation — expected Admin MCP catalog, in registration order.
const ADMIN_TOOL_NAMES = [
  "admin_get_identity", "admin_get_import_schemas", "admin_export_questions", "admin_search_questions", "admin_get_question", "admin_list_exams", "admin_get_exam",
  "admin_get_exam_statistics", "admin_find_duplicate_questions", "admin_find_questions_missing_explanations",
  "admin_find_questions_with_invalid_answer_references", "admin_find_questions_missing_metadata",
  "admin_get_question_bank_statistics", "admin_get_recent_content_changes", "admin_list_tags",
  "admin_preview_component_question", "admin_validate_question_payload", "admin_create_question", "admin_update_question", "admin_delete_question",
  "admin_batch_create_questions", "admin_batch_update_questions",
  // implementation
  "admin_create_exam", "admin_update_exam", "admin_archive_exam",
  "admin_validate_import", "admin_preview_import", "admin_execute_import", "admin_get_import_status",
  "admin_create_tag", "admin_update_tag", "admin_merge_tags",
];

// Independent wire-contract expectations. Review these alongside handler
// changes: a name prefix alone does not describe side effects or safe retries.
const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const MUTATION_ANNOTATIONS = {
  // [destructive, idempotent]; all operate inside the PrepDeck instance.
  user_create_knowledge_point: [false, false],
  user_update_knowledge_point: [true, true],
  user_delete_knowledge_point: [true, true],
  user_link_knowledge_point_question: [false, true],
  user_unlink_knowledge_point_question: [true, true],
  user_create_knowledge_point_group: [false, true],
  user_rename_knowledge_point_group: [true, false],
  user_delete_knowledge_point_group: [true, false],
  user_create_knowledge_point_tag: [false, true],
  user_rename_knowledge_point_tag: [true, false],
  user_delete_knowledge_point_tag: [true, true],
  user_unlink_knowledge_point_tag: [true, true],
  user_reorder_knowledge_points: [true, true],
  admin_create_question: [false, true],
  admin_update_question: [true, true],
  admin_delete_question: [true, true],
  admin_batch_create_questions: [false, true],
  admin_batch_update_questions: [true, true],
  admin_create_exam: [false, true],
  admin_update_exam: [true, true],
  admin_archive_exam: [true, true],
  admin_execute_import: [true, true],
  admin_create_tag: [false, true],
  admin_update_tag: [true, false],
  admin_merge_tags: [true, false],
};

async function payload(response) {
  const body = await response.text();
  if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    return JSON.parse(body.split("\n").find((line) => line.startsWith("data: ")).slice(6));
  }
  return JSON.parse(body);
}

test("dedicated endpoints initialize and publish independent catalogs", async (t) => {
  const f = await fixture(t);
  for (const [audience, credential] of [["user", f.alice], ["admin", f.admin]]) {
    const initialize = await rpc(f.env, audience, credential.token, "initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "boundary-test", version: "1.0" },
    });
    assert.equal(initialize.status, 200);
    const initialized = (await payload(initialize)).result;
    assert.equal(initialized.serverInfo.name, `prepdeck-${audience}-mcp`);
    if (audience === "user") assert.match(initialized.instructions, /user_present_question/);
    const response = await rpc(f.env, audience, credential.token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Mcp-Session-Id"), null);
    const tools = (await payload(response)).result.tools;
    assert.deepEqual(tools.map((tool) => tool.name), audience === "admin" ? ADMIN_TOOL_NAMES : USER_TOOL_NAMES);
    for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false);
    const call = await payload(await rpc(f.env, audience, credential.token, "tools/call", { name: `${audience}_get_identity` }));
    assert.deepEqual(call.result.structuredContent, { ok: true, data: { userId: audience === "user" ? "alice" : "admin", server: audience } });
  }
});

test("both MCP catalogs publish complete behavioral hints over JSON and legacy SSE", async (t) => {
  const f = await fixture(t);
  for (const protocolVersion of ["2025-11-25", "2026-07-28"]) {
    for (const [audience, token] of [["user", f.alice.token], ["admin", f.admin.token]]) {
      const response = await rpc(f.env, audience, token, "tools/list", {}, {
        headers: { "MCP-Protocol-Version": protocolVersion },
      });
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("Content-Type").includes(
        protocolVersion === "2025-11-25" ? "text/event-stream" : "application/json",
      ));
      const tools = (await payload(response)).result.tools;
      assert.deepEqual(tools.map(tool => tool.name), audience === "admin" ? ADMIN_TOOL_NAMES : USER_TOOL_NAMES);
      for (const tool of tools) {
        const mutation = MUTATION_ANNOTATIONS[tool.name];
        assert.deepEqual(tool.annotations, mutation ? {
          readOnlyHint: false, destructiveHint: mutation[0], idempotentHint: mutation[1], openWorldHint: false,
        } : READ_ANNOTATIONS, tool.name);
        for (const value of Object.values(tool.annotations)) assert.equal(typeof value, "boolean", tool.name);
      }
    }
  }
  for (const name of Object.keys(MUTATION_ANNOTATIONS)) {
    assert.ok([...USER_TOOL_NAMES, ...ADMIN_TOOL_NAMES].includes(name), `stale annotation expectation: ${name}`);
  }
});

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

test("PDF schemas are discoverable in both MCP audiences without question-bank writes", async (t) => {
  const f = await fixture(t);
  const results = [];
  for (const [audience, credential] of [["user", f.alice], ["admin", f.admin]]) {
    const response = await payload(await rpc(f.env, audience, credential.token, "tools/call", {
      name: `${audience}_get_import_schemas`, arguments: {},
    }));
    assert.equal(response.result.structuredContent.ok, true);
    results.push(response.result.structuredContent.data);
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0].capabilities.interactions, ["choice", "text", "order", "match"]);
  assert.equal(results[0].componentImportSchema.properties.schemaVersion.const, "2.0");
  assert.equal(results[0].importSchema.properties.schemaVersion.const, "1.0");
  assert.equal(results[0].importPermission, "admin");
  assert.equal(results[0].acceptsPdfUpload, false);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM questions").get().n, 0);
  assert.equal(f.bucketObjects.size, 0);
  const unauthenticated = await worker.fetch(new Request(`${f.env.APP_BASE_URL}/api/import-schemas`), f.env);
  assert.equal(unauthenticated.status, 401);
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

  f.env.RATE_LIMITER.get = () => ({ fetch: async () => Response.json({ allowed: false, retryAfter: 7 }) });
  for (const [audience, token] of [["user", f.alice.token], ["admin", f.admin.token]]) {
    const response = await rpc(f.env, audience, token);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "7");
    assert.deepEqual(await payload(response), { ok: false, error: { code: "rate_limited", message: "Too many requests for this endpoint." } });
  }
  assert.equal(f.queries.length, before, "IP gate must reject before credential lookup");

  // Same IP gate, unavailable rather than exceeded — fails closed (never
  // silently allows) with the same normalized envelope shape.
  f.env.RATE_LIMITER.get = () => ({ fetch: async () => { throw new Error("simulated IP-limiter outage"); } });
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

test("2026 protocol discovery and tool calls use the same authenticated catalog", async (t) => {
  const f = await fixture(t);
  const _meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "modern-test", version: "1.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const options = { headers: { "MCP-Protocol-Version": "2026-07-28" } };
  const discovery = await rpc(f.env, "user", f.alice.token, "server/discover", { _meta }, options);
  assert.equal(discovery.status, 200);
  const discovered = await payload(discovery);
  assert.ok(!discovered.error, JSON.stringify(discovered));
  const response = await rpc(f.env, "user", f.alice.token, "tools/call", { _meta, name: "user_get_identity", arguments: {} }, options);
  const result = await payload(response);
  assert.ok(!result.error, JSON.stringify(result));
  assert.equal(result.result.structuredContent.data.userId, "alice");
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
  f.env.RATE_LIMITER.get = (key) => ({ fetch: async () => {
    if (key.startsWith("mcp:")) throw new Error(f.alice.token);
    return Response.json({ allowed: true, retryAfter: 1 });
  } });
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 503);
  f.env.RATE_LIMITER.get = () => ({ fetch: async () => Response.json({ allowed: false, retryAfter: 7 }) });
  assert.equal((await rpc(f.env, "user", f.alice.token)).status, 429);
});

test("implementation: the per-account MCP quota really counts requests, is independent per user/audience, and survives token rotation", async (t) => {
  const f = await fixture(t);
  f.env.RATE_LIMITER = statefulRateLimiter();
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

test("pagination bounds and tool error conventions are reusable", async () => {
  assert.deepEqual(paginationSchema.parse({}), { limit: 25, offset: 0 });
  for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 100001 }, { limit: "25" }, { ownerId: "other" }]) {
    assert.equal(paginationSchema.safeParse(input).success, false);
  }
  assert.deepEqual(pageResult([1, 2, 3], { limit: 2, offset: 0 }), { items: [1, 2], nextOffset: 2 });
  assert.deepEqual(pageResult([3], { limit: 2, offset: 2 }), { items: [3], nextOffset: null });
  for (const code of ["unauthenticated", "unauthorized", "invalid_input", "not_found", "internal"]) {
    const tool = defineMcpTool("test", READ_ANNOTATIONS, "Test", z.strictObject({}), () => { throw new McpApplicationError(code); });
    const result = await tool.invoke({});
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, code);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  }
  const tool = defineMcpTool("test", READ_ANNOTATIONS, "Test", z.strictObject({}), () => { throw new Error("private failure"); });
  assert.ok(!JSON.stringify(await tool.invoke({})).includes("private failure"));
});

// implementation — seeds two exams' worth of questions (one archived exam) with
// deliberate quality issues, then exercises every read/quality-control tool
// through the real worker over the real MCP wire format.
// implementation — tags no longer live in a tags_json column; every fixture
// that used to inline a JSON tag array into its INSERT now seeds the
// catalog + join table directly instead. Register-if-missing, same
// case-insensitive identity rule the app itself uses (normalized_name).
function seedQuestionTags(sqlite, questionId, tagNames) {
  const now = new Date().toISOString();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    const normalized = name.toLowerCase();
    let tag = sqlite.prepare("SELECT id FROM question_bank_tags WHERE normalized_name = ?").get(normalized);
    if (!tag) {
      const id = crypto.randomUUID();
      sqlite.prepare(
        "INSERT INTO question_bank_tags (id, name, normalized_name, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      ).run(id, name, normalized, now, now);
      tag = { id };
    }
    sqlite.prepare("INSERT OR IGNORE INTO question_tag_links (question_id, tag_id) VALUES (?, ?)").run(questionId, tag.id);
  }
}

function getQuestionTags(sqlite, questionId) {
  return sqlite.prepare(
    `SELECT t.name FROM question_tag_links l JOIN question_bank_tags t ON t.id = l.tag_id
     WHERE l.question_id = ? ORDER BY t.name`,
  ).all(questionId).map((r) => r.name);
}

async function questionBankFixture(t) {
  const f = await fixture(t);
  const now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)")
    .run("examA", "exam-a", "Exam A", now);
  f.sqlite.prepare("INSERT INTO exams (id, slug, name, created_at, archived_at) VALUES (?, ?, ?, ?, ?)")
    .run("examB", "exam-b", "Exam B", now, now);

  const insertQuestion = f.sqlite.prepare(`INSERT INTO questions
    (id, exam_id, external_id, sequence_number, type, stem, options_json, correct_answers_json,
     explanation, difficulty, points, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  const q = (overrides) => ({
    externalId: null, options: null, explanation: null, difficulty: null, tags: [],
    createdAt: now, ...overrides,
  });
  const questions = [
    q({ id: "q1", examId: "examA", seq: 1, type: "single_choice", stem: "What is 2+2?",
      options: [{ id: "a", text: "3" }, { id: "b", text: "4" }], correctAnswers: ["b"],
      explanation: "Because 2+2=4.", difficulty: "easy", tags: ["math"], updatedAt: "2026-01-02T00:00:00.000Z" }),
    q({ id: "q2", examId: "examA", seq: 2, type: "single_choice", stem: "what   is 2+2?",
      options: [{ id: "a", text: "3" }, { id: "b", text: "4" }], correctAnswers: ["b"],
      updatedAt: "2026-01-03T00:00:00.000Z" }), // duplicate stem, missing explanation + metadata
    q({ id: "q3", examId: "examA", seq: 3, type: "true_false", stem: "The sky is blue.",
      options: [{ id: "maybe", text: "Maybe" }, { id: "no", text: "No" }], correctAnswers: ["maybe"],
      explanation: "It scatters blue light.", difficulty: "medium", tags: ["science"],
      updatedAt: "2026-01-04T00:00:00.000Z" }), // invalid answer reference (no true/false ids)
    q({ id: "q4", examId: "examA", seq: 4, type: "fill_blank", stem: "Fill in ___.", correctAnswers: ["answer"],
      explanation: "exp", difficulty: "hard", tags: ["fill"], updatedAt: "2026-01-01T00:00:00.000Z" }),
    q({ id: "q5", examId: "examB", seq: 1, type: "single_choice", stem: "Exam B question",
      options: [{ id: "x", text: "X" }, { id: "y", text: "Y" }], correctAnswers: ["y"],
      explanation: "exp5", difficulty: "easy", tags: ["math", "examB"], updatedAt: "2026-01-02T12:00:00.000Z" }),
  ];
  for (const row of questions) {
    insertQuestion.run(row.id, row.examId, row.externalId, row.seq, row.type, row.stem,
      row.options ? JSON.stringify(row.options) : null, JSON.stringify(row.correctAnswers),
      row.explanation, row.difficulty, row.createdAt, row.updatedAt);
    seedQuestionTags(f.sqlite, row.id, row.tags);
  }

  f.sqlite.prepare(`INSERT INTO attempts (id, user_id, exam_id, mode, started_at, completed_at)
    VALUES (?, 'alice', 'examA', 'practice', ?, ?)`).run("attempt1", now, now);
  f.sqlite.prepare(`INSERT INTO attempts (id, user_id, exam_id, mode, started_at, completed_at)
    VALUES (?, 'alice', 'examA', 'practice', ?, NULL)`).run("attempt2", now);

  f.questionRowCount = f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c;
  return f;
}

async function callAdminTool(f, name, args = {}) {
  const result = (await payload(await rpc(f.env, "admin", f.admin.token, "tools/call", { name, arguments: args }))).result;
  assert.equal(result.isError, undefined, `${name} unexpectedly failed: ${JSON.stringify(result)}`);
  return result.structuredContent.data;
}

test("quiz presentation crosses both SDK transports with full images, safe columns and no bank writes", async (t) => {
  const f = await questionBankFixture(t), snapshot = componentQuestion();
  f.sqlite.prepare("UPDATE questions SET content_json = ?, explanation = 'EXPLANATION_SENTINEL', correct_answers_json = '[\"KEY_SENTINEL\"]' WHERE id = 'q1'")
    .run(JSON.stringify(snapshot));
  const before = f.sqlite.prepare("SELECT * FROM questions ORDER BY id").all();
  f.queries.length = 0;
  for (const protocol of ["2025-11-25", "2026-07-28"]) {
    const invoke = async args => (await payload(await rpc(f.env, "user", f.alice.token, "tools/call",
      { name: "user_present_question", arguments: args }, { headers: { "MCP-Protocol-Version": protocol } }))).result;
    const result = await invoke({ examId: "examA", id: "q1" });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.data.status, "available");
    assert.equal(result.structuredContent.data.imageMode, "inline");
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.equal(result.content.filter(c => c.type === "image").length, 2);
    assert.equal(result.content.find(c => c.type === "image").data, snapshot.assets[0].data);
    assert.doesNotMatch(JSON.stringify(result), /SENTINEL|correctAnswers|explanation|annotations/);
    const fallback = await invoke({ examId: "examA", id: "q1", imageMode: "text-only" });
    assert.equal(fallback.structuredContent.data.status, "incomplete");
    assert.equal(fallback.content.some(c => c.type === "image"), false);
    assert.equal((await invoke({ examId: "examB", id: "q1" })).structuredContent.error.code, "not_found");
    assert.equal((await invoke({ examId: "examA", id: "q1", imageMode: "unsupported" })).structuredContent.error.code, "invalid_input");
    const legacy = await invoke({ examId: "examB", id: "q5" });
    assert.equal(legacy.structuredContent.data.format, "legacy-markdown");
  }
  const bankQueries = f.queries.filter(q => /\bquestions\b/i.test(q.sql));
  assert.ok(bankQueries.length > 0);
  for (const { sql } of bankQueries) {
    assert.match(sql, /^SELECT id, exam_id, revision, type, stem, options_json, content_json/);
    assert.doesNotMatch(sql, /correct_answers|explanation|annotations|baseline/i);
  }
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM questions ORDER BY id").all(), before);
  assert.equal(f.metrics.some(metric => metric.blobs?.includes("user_present_question")), true);
});

async function callAdminToolExpectingError(f, name, args = {}) {
  const result = (await payload(await rpc(f.env, "admin", f.admin.token, "tools/call", { name, arguments: args }))).result;
  assert.equal(result.isError, true, `${name} unexpectedly succeeded`);
  return result.structuredContent.error;
}

test("implementation: admin_search_questions and admin_get_question reuse the exam-scoped question service", async (t) => {
  const f = await questionBankFixture(t);
  const search = await callAdminTool(f, "admin_search_questions", { examId: "examA", q: "2+2" });
  assert.deepEqual(search.questions.map((question) => question.id), ["q1", "q2"]);
  assert.equal(search.total, 2);

  const byType = await callAdminTool(f, "admin_search_questions", { examId: "examA", type: "true_false" });
  assert.deepEqual(byType.questions.map((question) => question.id), ["q3"]);

  const got = await callAdminTool(f, "admin_get_question", { examId: "examA", id: "q1" });
  assert.equal(got.question.stem, "What is 2+2?");
  assert.equal((await callAdminToolExpectingError(f, "admin_get_question", { examId: "examA", id: "missing" })).code, "not_found");
});

test("implementation: admin_list_exams and admin_get_exam reuse the exam service and respect includeArchived", async (t) => {
  const f = await questionBankFixture(t);
  const active = await callAdminTool(f, "admin_list_exams", {});
  assert.deepEqual(active.exams.map((exam) => exam.id), ["examA"]);
  const all = await callAdminTool(f, "admin_list_exams", { includeArchived: true });
  assert.deepEqual(new Set(all.exams.map((exam) => exam.id)), new Set(["examA", "examB"]));

  const exam = await callAdminTool(f, "admin_get_exam", { id: "examA" });
  assert.equal(exam.exam.questionCount, 4);
  assert.equal((await callAdminToolExpectingError(f, "admin_get_exam", { id: "missing" })).code, "not_found");
});

test("implementation: admin_list_exams bounds and paginates its result instead of returning every exam", async (t) => {
  const f = await fixture(t);
  const now = new Date().toISOString();
  const insertExam = f.sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)");
  for (const id of ["e1", "e2", "e3"]) insertExam.run(id, `exam-${id}`, `Exam ${id}`, now);

  const page1 = await callAdminTool(f, "admin_list_exams", { limit: 2, offset: 0 });
  assert.deepEqual(page1.exams.map((exam) => exam.id), ["e1", "e2"]);
  assert.equal(page1.nextOffset, 2);
  const page2 = await callAdminTool(f, "admin_list_exams", { limit: 2, offset: 2 });
  assert.deepEqual(page2.exams.map((exam) => exam.id), ["e3"]);
  assert.equal(page2.nextOffset, null);
});

test("implementation: admin_get_exam_statistics summarizes type/difficulty/quality counts and attempts for one exam", async (t) => {
  const f = await questionBankFixture(t);
  const { exam, statistics, attempts } = await callAdminTool(f, "admin_get_exam_statistics", { examId: "examA" });
  assert.equal(exam.id, "examA");
  assert.equal(statistics.scannedCount, 4);
  assert.equal(statistics.truncated, false);
  assert.deepEqual(statistics.byType, { single_choice: 2, multiple_choice: 0, true_false: 1, fill_blank: 1, ordering: 0, matching: 0 });
  assert.equal(statistics.byDifficulty.unset, 1);
  assert.equal(statistics.missingExplanationCount, 1);
  assert.equal(statistics.missingMetadataCount, 1);
  assert.equal(statistics.invalidAnswerReferenceCount, 1);
  assert.equal(statistics.duplicateGroupCount, 1);
  assert.equal(statistics.duplicateQuestionCount, 2);
  assert.deepEqual(attempts, { total: 2, completed: 1 });
  assert.equal((await callAdminToolExpectingError(f, "admin_get_exam_statistics", { examId: "missing" })).code, "not_found");
});

test("implementation: quality-control find_* tools locate the seeded duplicate, missing-explanation, invalid-reference and missing-metadata questions", async (t) => {
  const f = await questionBankFixture(t);

  const duplicates = await callAdminTool(f, "admin_find_duplicate_questions", { examId: "examA" });
  assert.equal(duplicates.items.length, 1);
  assert.deepEqual(duplicates.items[0].questions.map((question) => question.id).sort(), ["q1", "q2"]);
  assert.equal(duplicates.scannedCount, 4);

  const missingExplanations = await callAdminTool(f, "admin_find_questions_missing_explanations", { examId: "examA" });
  assert.deepEqual(missingExplanations.items.map((item) => item.id), ["q2"]);

  const invalidRefs = await callAdminTool(f, "admin_find_questions_with_invalid_answer_references", { examId: "examA" });
  assert.deepEqual(invalidRefs.items.map((item) => item.id), ["q3"]);
  assert.ok(invalidRefs.items[0].issues[0].includes("true_false"));

  const missingMetadata = await callAdminTool(f, "admin_find_questions_missing_metadata", { examId: "examA" });
  assert.deepEqual(missingMetadata.items.map((item) => item.id), ["q2"]);
  assert.deepEqual(missingMetadata.items[0], {
    id: "q2", examId: "examA", externalId: null, sequenceNumber: 2, type: "single_choice",
    stemPreview: "what is 2+2?", updatedAt: "2026-01-03T00:00:00.000Z",
    missingDifficulty: true, missingTags: true,
  });

  assert.equal((await callAdminToolExpectingError(f, "admin_find_duplicate_questions", { examId: "missing" })).code, "not_found");
});

test("implementation: find_* tools apply offset to their in-memory-filtered matches, not just page one", async (t) => {
  // The find_* tools scan a whole exam and filter matches in memory (unlike
  // the SQL-paginated list tools), so their result array starts at index 0
  // regardless of `offset`. Three distinct one-item pages confirm offset is
  // honored rather than always slicing from the start of the match array.
  const f = await fixture(t);
  const now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)").run("examP", "exam-p", "Exam P", now);
  const insertQuestion = f.sqlite.prepare(`INSERT INTO questions
    (id, exam_id, external_id, sequence_number, type, stem, options_json, correct_answers_json,
     explanation, difficulty, points, created_at, updated_at)
    VALUES (?, 'examP', NULL, ?, 'fill_blank', ?, NULL, '["x"]', NULL, 'easy', 1, ?, ?)`);
  for (const [id, seq] of [["p1", 1], ["p2", 2], ["p3", 3]]) insertQuestion.run(id, seq, `Question ${seq}`, now, now);

  const page1 = await callAdminTool(f, "admin_find_questions_missing_explanations", { examId: "examP", limit: 1, offset: 0 });
  assert.deepEqual(page1.items.map((item) => item.id), ["p1"]);
  assert.equal(page1.nextOffset, 1);
  const page2 = await callAdminTool(f, "admin_find_questions_missing_explanations", { examId: "examP", limit: 1, offset: 1 });
  assert.deepEqual(page2.items.map((item) => item.id), ["p2"]);
  assert.equal(page2.nextOffset, 2);
  const page3 = await callAdminTool(f, "admin_find_questions_missing_explanations", { examId: "examP", limit: 1, offset: 2 });
  assert.deepEqual(page3.items.map((item) => item.id), ["p3"]);
  assert.equal(page3.nextOffset, null);
});

test("implementation: admin_get_question_bank_statistics and admin_list_tags aggregate across the whole bank", async (t) => {
  const f = await questionBankFixture(t);

  const bank = await callAdminTool(f, "admin_get_question_bank_statistics", {});
  assert.equal(bank.statistics.scannedCount, 5);
  assert.equal(bank.examsScanned, 2);
  assert.deepEqual(new Map(bank.byExam.map((e) => [e.examId, e.questionCount])), new Map([["examA", 4], ["examB", 1]]));

  const allTags = await callAdminTool(f, "admin_list_tags", {});
  // implementation: every tag association now references a real catalog row —
  // there is no more "used in tags_json but never registered" state, so
  // `registered` is always true for a tag actually applied to a question.
  assert.deepEqual(allTags.items, [
    { tag: "examB", questionCount: 1, registered: true }, { tag: "fill", questionCount: 1, registered: true },
    { tag: "math", questionCount: 2, registered: true }, { tag: "science", questionCount: 1, registered: true },
  ]);
  const examTags = await callAdminTool(f, "admin_list_tags", { examId: "examA" });
  assert.deepEqual(examTags.items.map((tag) => tag.tag), ["fill", "math", "science"]);
});

test("implementation: admin_list_tags counts distinct questions, not tag/question pairs", async (t) => {
  // A question can carry a duplicate tag value ("aws" twice) because
  // validateQuestionRow doesn't dedupe `tags`; the tag-count SQL joins
  // through json_each, so COUNT(*) would count that question twice.
  const f = await fixture(t);
  const now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)").run("examR", "exam-r", "Exam R", now);
  const insertQuestion = f.sqlite.prepare(`INSERT INTO questions
    (id, exam_id, external_id, sequence_number, type, stem, options_json, correct_answers_json,
     explanation, difficulty, points, created_at, updated_at)
    VALUES (?, 'examR', NULL, ?, 'fill_blank', ?, NULL, '["x"]', NULL, 'easy', 1, ?, ?)`);
  insertQuestion.run("r1", 1, "Question 1", now, now);
  seedQuestionTags(f.sqlite, "r1", ["aws", "aws"]);
  insertQuestion.run("r2", 2, "Question 2", now, now);
  seedQuestionTags(f.sqlite, "r2", ["aws"]);

  const tags = await callAdminTool(f, "admin_list_tags", { examId: "examR" });
  assert.deepEqual(tags.items, [{ tag: "aws", questionCount: 2, registered: true }]);
});

test("implementation: admin_get_recent_content_changes orders by updated_at, scopes by exam, and paginates", async (t) => {
  const f = await questionBankFixture(t);

  const page1 = await callAdminTool(f, "admin_get_recent_content_changes", { limit: 2, offset: 0 });
  assert.deepEqual(page1.items.map((item) => item.id), ["q3", "q2"]);
  assert.equal(page1.nextOffset, 2);

  const page2 = await callAdminTool(f, "admin_get_recent_content_changes", { limit: 2, offset: 2 });
  assert.deepEqual(page2.items.map((item) => item.id), ["q5", "q1"]);

  const scoped = await callAdminTool(f, "admin_get_recent_content_changes", { examId: "examA", limit: 10, offset: 0 });
  assert.deepEqual(scoped.items.map((item) => item.id), ["q3", "q2", "q1", "q4"]);
  assert.equal((await callAdminToolExpectingError(f, "admin_get_recent_content_changes", { examId: "missing" })).code, "not_found");
});

test("implementation: Admin MCP reads never mutate the question bank, and User MCP cannot reach admin tools", async (t) => {
  const f = await questionBankFixture(t);
  for (const [name, args] of [
    ["admin_search_questions", { examId: "examA" }], ["admin_get_question", { examId: "examA", id: "q1" }],
    ["admin_list_exams", {}], ["admin_get_exam", { id: "examA" }], ["admin_get_exam_statistics", { examId: "examA" }],
    ["admin_find_duplicate_questions", { examId: "examA" }], ["admin_get_question_bank_statistics", {}],
    ["admin_get_recent_content_changes", {}], ["admin_list_tags", {}],
  ]) {
    await callAdminTool(f, name, args);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount);

  const viaUser = await payload(await rpc(f.env, "user", f.alice.token, "tools/call",
    { name: "admin_search_questions", arguments: { examId: "examA" } }));
  assert.equal(viaUser.result.structuredContent.error.code, "not_found");
});

test("implementation: admin_validate_question_payload previews create and edit without mutating, and only issues a proposalToken when valid", async (t) => {
  const f = await questionBankFixture(t);

  const newQuestion = { type: "single_choice", stem: "New question?",
    options: [{ id: "a", text: "Yes" }, { id: "b", text: "No" }], correctAnswers: ["a"], difficulty: "easy", tags: ["new"] };
  const createPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: newQuestion });
  assert.equal(createPreview.valid, true);
  assert.deepEqual(createPreview.issues, []);
  assert.equal(createPreview.currentRevision, undefined);
  assert.ok(createPreview.proposalToken);

  const invalidPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", payload: { type: "single_choice", correctAnswers: ["a"] } });
  assert.equal(invalidPreview.valid, false);
  assert.ok(invalidPreview.issues.length > 0);
  assert.equal(invalidPreview.proposalToken, undefined);

  const editPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { tags: ["math", "algebra"] } });
  assert.equal(editPreview.valid, true);
  assert.equal(editPreview.currentRevision, 1);
  assert.equal(editPreview.answerRevised, false);
  // implementation: payloadOf() sorts tags so comparisons are order-independent
  // — "incoming" reflects that canonical (sorted) order, not input order.
  assert.deepEqual(editPreview.diff, [{ field: "tags", current: ["math"], incoming: ["algebra", "math"] }]);
  assert.ok(editPreview.proposalToken);

  assert.equal((await callAdminToolExpectingError(f, "admin_validate_question_payload",
    { examId: "examA", id: "missing", payload: {} })).code, "not_found");
  assert.equal((await callAdminToolExpectingError(f, "admin_validate_question_payload",
    { examId: "missing", payload: newQuestion })).code, "not_found");

  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_audit_log").get().c, 0);
});

test("implementation: admin_create_question commits only the exact payload reviewed via admin_validate_question_payload, and a retry with the same proposalId replays instead of duplicating", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "single_choice", stem: "New Q?",
    options: [{ id: "a", text: "Yes" }, { id: "b", text: "No" }], correctAnswers: ["a"], difficulty: "easy", tags: ["new"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  assert.ok(preview.proposalId);

  // Editing the payload after preview invalidates the token; the commit is rejected, not silently applied.
  const tampered = { ...fields, stem: "Tampered?" };
  const mismatch = await callAdminToolExpectingError(f, "admin_create_question",
    { examId: "examA", payload: tampered, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  assert.equal(mismatch.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount);

  const created = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  assert.equal(created.question.stem, "New Q?");
  assert.equal(created.question.revision, 1);
  assert.equal(created.idempotentReplay, undefined);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount + 1);
  assert.ok(f.kvInvalidations.includes("practice-questions:examA"));

  // A retry carrying the same proposalId (lost response, at-least-once
  // delivery) replays the original result instead of inserting a duplicate —
  // proposalToken alone can't serve this role since it's a deterministic
  // content hash, and two intentionally identical payloads must both be
  // allowed to create separate questions.
  const replay = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(lastMetric(f, "tool").outcome, "replayed");
  assert.equal(lastMetric(f, "tool").created, 0);
  assert.equal(replay.question.id, created.question.id);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount + 1);

  const audit = f.sqlite.prepare(
    "SELECT * FROM admin_mcp_audit_log WHERE tool = 'admin_create_question' ORDER BY rowid",
  ).all();
  assert.equal(audit.length, 2, "the rejected mismatch and the successful create are audited; the idempotent replay is not a new mutation");
  assert.deepEqual(audit.map((row) => row.outcome), ["failure", "success"]);
  assert.equal(audit[1].admin_user_id, "admin");
  assert.equal(audit[1].exam_id, "examA");
  assert.deepEqual(JSON.parse(audit[1].target_ids_json), [created.question.id]);
  // implementation — the audit row is a persisted logging surface: it must never
  // carry the question's actual content (stem/options/correctAnswers), only
  // which fields were set.
  const successDetail = JSON.parse(audit[1].detail_json);
  assert.deepEqual(Object.keys(successDetail), ["fields"]);
  assert.ok(successDetail.fields.includes("stem"));
  assert.equal(JSON.stringify(successDetail).includes("New Q?"), false);
});

test("implementation: admin_create_question rejects a duplicate externalId within the same exam", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { externalId: "EXT1", type: "single_choice", stem: "Q?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview1 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview1.proposalToken, proposalId: preview1.proposalId });

  const fields2 = { ...fields, stem: "Q2?" };
  const preview2 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields2 });
  const conflict = await callAdminToolExpectingError(f, "admin_create_question",
    { examId: "examA", payload: fields2, proposalToken: preview2.proposalToken, proposalId: preview2.proposalId });
  assert.equal(conflict.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'EXT1'").get().c, 1);
});

test("implementation (review): a KV cache-invalidation failure never suppresses a mutation's audit record", async (t) => {
  const f = await questionBankFixture(t);
  f.env.KV.delete = async () => { throw new Error("simulated KV outage"); };

  const fields = { type: "single_choice", stem: "Resilient Q?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  const created = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  assert.ok(created.question.id);
  const createAudit = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_create_question' AND target_ids_json = ?",
  ).get(JSON.stringify([created.question.id]));
  assert.equal(createAudit.outcome, "success");

  const tagPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { tags: ["kv-outage"] } });
  const updated = await callAdminTool(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 1, payload: { tags: ["kv-outage"] }, proposalToken: tagPreview.proposalToken,
  });
  assert.deepEqual(updated.question.tags, ["kv-outage"]);
  const updateAudit = f.sqlite.prepare(
    "SELECT outcome, detail_json FROM admin_mcp_audit_log WHERE tool = 'admin_update_question' AND target_ids_json = ?",
  ).get(JSON.stringify(["q1"]));
  assert.equal(updateAudit.outcome, "success");
  // implementation — changed field names only, never the before/after tag values.
  assert.deepEqual(JSON.parse(updateAudit.detail_json), { fields: ["tags"] });
});

test("implementation: admin_update_question enforces optimistic concurrency and implementation's answer-revision preservation", async (t) => {
  const f = await questionBankFixture(t);

  // A tag-only edit does not revise the answer key.
  const tagPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { tags: ["math", "algebra"] } });
  assert.equal(tagPreview.answerRevised, false);
  const tagged = await callAdminTool(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 1, payload: { tags: ["math", "algebra"] }, proposalToken: tagPreview.proposalToken,
  });
  // implementation: tags read back sorted, independent of write-time order.
  assert.deepEqual(tagged.question.tags, ["algebra", "math"]);
  assert.equal(tagged.question.revision, 2);
  assert.equal(tagged.question.answerRevision, 1);
  assert.equal(tagged.question.answerRevisedAt, null);
  assert.ok(f.kvInvalidations.includes("practice-questions:examA"));

  // Retrying with the same (now-stale) expectedRevision/proposalToken is rejected, never silently reapplied.
  const staleRetry = await callAdminToolExpectingError(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 1, payload: { tags: ["math", "algebra"] }, proposalToken: tagPreview.proposalToken,
  });
  assert.equal(staleRetry.code, "conflict");

  // An answer-key change bumps answer_revision/answer_revised_at independently of the generic revision.
  const answerPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { correctAnswers: ["a"] } });
  assert.equal(answerPreview.answerRevised, true);
  const revised = await callAdminTool(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 2, payload: { correctAnswers: ["a"] }, proposalToken: answerPreview.proposalToken,
  });
  assert.equal(revised.question.revision, 3);
  assert.equal(revised.question.answerRevision, 2);
  assert.ok(revised.question.answerRevisedAt);

  // A payload changed after preview (without a refreshed preview) is rejected.
  const freshPreview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { explanation: "Updated." } });
  const tamperedMismatch = await callAdminToolExpectingError(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 3, payload: { explanation: "Something else." }, proposalToken: freshPreview.proposalToken,
  });
  assert.equal(tamperedMismatch.code, "conflict");

  assert.equal((await callAdminToolExpectingError(f, "admin_update_question", {
    examId: "examA", id: "missing", expectedRevision: 1, payload: {}, proposalToken: "0".repeat(64),
  })).code, "not_found");
});

test("implementation: admin_delete_question requires expectedRevision and is blocked by a dependent attempt, without cascading", async (t) => {
  const f = await questionBankFixture(t);

  const wrongRevision = await callAdminToolExpectingError(f, "admin_delete_question", { examId: "examB", id: "q5", expectedRevision: 2 });
  assert.equal(wrongRevision.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE id = 'q5'").get().c, 1);

  const deleted = await callAdminTool(f, "admin_delete_question", { examId: "examB", id: "q5", expectedRevision: 1 });
  assert.equal(deleted.deleted, true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE id = 'q5'").get().c, 0);
  assert.ok(f.kvInvalidations.includes("practice-questions:examB"));

  f.sqlite.prepare("UPDATE attempts SET question_ids_json = ? WHERE id = 'attempt2'").run(JSON.stringify(["q4"]));
  const blocked = await callAdminToolExpectingError(f, "admin_delete_question", { examId: "examA", id: "q4", expectedRevision: 1 });
  assert.equal(blocked.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE id = 'q4'").get().c, 1);

  const outcomes = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_delete_question' ORDER BY rowid",
  ).all().map((row) => row.outcome);
  assert.deepEqual(outcomes, ["failure", "success", "failure"]);
});

test("implementation: admin_batch_create_questions returns per-item outcomes correlated to input order via inputIndex, and never applies an invalid or stale item", async (t) => {
  const f = await questionBankFixture(t);
  const good1 = { type: "single_choice", stem: "Batch Q1?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const good2 = { type: "single_choice", stem: "Batch Q2?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["b"] };
  const bad = { type: "single_choice", correctAnswers: ["a"] }; // missing stem/options

  const preview1 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: good1 });
  const preview2 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: good2 });
  const tamperedGood2 = { ...good2, stem: "Changed after preview" };

  // Neither good1 nor tamperedGood2 sets externalId, matching a case a
  // review of this PR flagged: a "created" and a "skipped" outcome both with
  // externalId: null were otherwise indistinguishable — inputIndex fixes that.
  const result = await callAdminTool(f, "admin_batch_create_questions", {
    examId: "examA",
    items: [
      { payload: good1, proposalToken: preview1.proposalToken, proposalId: preview1.proposalId },
      { payload: tamperedGood2, proposalToken: preview2.proposalToken, proposalId: preview2.proposalId },
      { payload: bad, proposalToken: "0".repeat(64), proposalId: crypto.randomUUID() },
    ],
  });
  assert.equal(result.created, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.failed, 0);
  // Outcomes are restored to input order and tagged with inputIndex, so
  // every one maps unambiguously back to the item that produced it.
  assert.deepEqual(result.outcomes.map((o) => o.inputIndex), [0, 1, 2]);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["created", "skipped", "skipped"]);
  assert.equal(result.outcomes[1].reason, "stale_proposal");
  assert.equal(result.outcomes[2].reason, "invalid");
  assert.equal(result.outcomes[0].payload.stem, "Batch Q1?");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem LIKE 'Batch%' OR stem LIKE 'Changed%'").get().c, 1);

  // Each item gets its own audit row (not one summary row for the call), so
  // an unrelated rollback elsewhere can't erase another item's audit trail.
  // Resolved-before-touching-the-database items (both skips here) are
  // audited first, in their own batch; the created item's audit — committed
  // atomically with its insert — comes after.
  const auditRows = f.sqlite.prepare(
    "SELECT outcome, detail_json FROM admin_mcp_audit_log WHERE tool = 'admin_batch_create_questions' ORDER BY rowid",
  ).all();
  assert.equal(auditRows.length, 3);
  assert.deepEqual(auditRows.map((row) => row.outcome), ["failure", "failure", "success"]);
  // implementation — the audit row persists which fields were set, never the
  // question content itself (stem/options/explanation/answer key).
  const createdDetail = JSON.parse(auditRows[2].detail_json);
  assert.equal(createdDetail.payload, undefined);
  assert.ok(createdDetail.fields.includes("stem"));
});

test("implementation: admin_batch_create_questions replays an item retried with the same proposalId instead of duplicating it", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "single_choice", stem: "Idempotent batch Q?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  const item = { payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId };

  const first = await callAdminTool(f, "admin_batch_create_questions", { examId: "examA", items: [item] });
  assert.equal(first.created, 1);
  const questionId = first.outcomes[0].questionId;

  const retry = await callAdminTool(f, "admin_batch_create_questions", { examId: "examA", items: [item] });
  assert.equal(retry.created, 1);
  assert.equal(retry.outcomes[0].questionId, questionId);
  assert.equal(retry.outcomes[0].reason, "idempotent_replay");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Idempotent batch Q?'").get().c, 1);
});

test("implementation: admin_batch_update_questions commits exactly the submitted, pre-tokened targets, correlated to input order via inputIndex, with per-item diffs audited", async (t) => {
  const f = await questionBankFixture(t);
  const q1Preview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { tags: ["math", "reviewed"] } });

  const result = await callAdminTool(f, "admin_batch_update_questions", {
    examId: "examA",
    items: [
      { id: "q1", expectedRevision: 1, proposalToken: q1Preview.proposalToken, payload: { tags: ["math", "reviewed"] } },
      { id: "q2", expectedRevision: 99, proposalToken: "0".repeat(64), payload: { tags: ["reviewed"] } },
    ],
  });
  assert.equal(result.updated, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.outcomes.map((o) => o.inputIndex), [0, 1]);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["updated", "skipped"]);
  assert.equal(result.outcomes[1].reason, "stale_proposal");
  assert.deepEqual(result.outcomes[0].diff, [{ field: "tags", current: ["math"], incoming: ["math", "reviewed"] }]);

  const q1Row = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q1'").get();
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["math", "reviewed"]);
  assert.equal(q1Row.revision, 2);
  assert.deepEqual(getQuestionTags(f.sqlite, "q2"), []);

  // Same per-item audit shape as batch create: the skipped item (resolved
  // before touching the database) is audited first; the updated item's
  // audit — committed atomically with the update via changes() — comes after.
  const auditRows = f.sqlite.prepare(
    "SELECT outcome, detail_json FROM admin_mcp_audit_log WHERE tool = 'admin_batch_update_questions' ORDER BY rowid",
  ).all();
  assert.equal(auditRows.length, 2);
  assert.deepEqual(auditRows.map((row) => row.outcome), ["failure", "success"]);
  // implementation — the audit row persists changed field names only, never the
  // before/after question content diffPayload() returns to the caller.
  const updatedDetail = JSON.parse(auditRows[1].detail_json);
  assert.equal(updatedDetail.diff, undefined);
  assert.deepEqual(updatedDetail.fields, ["tags"]);
});

test("implementation: a genuine DB-level stale-revision race in admin_batch_update_questions never applies its tag-link change either", async (t) => {
  const f = await questionBankFixture(t);
  // Pre-register the tag so buildTagNameResolver's bulk resolve has nothing
  // new to INSERT — otherwise ITS db.batch() call would be the one
  // intercepted below, racing the revision before validation even runs.
  await callAdminTool(f, "admin_create_tag", { name: "raced-tag" });
  const preview = await callAdminTool(f, "admin_validate_question_payload",
    { examId: "examA", id: "q1", payload: { tags: ["raced-tag"] } });

  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let intercepted = false;
  f.env.DB.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      // Simulate another admin editing q1 between this call's own SELECT
      // (already read, expectedRevision baked into `preview`) and its
      // update statement committing — the update's WHERE clause on the
      // OLD revision will match zero rows.
      f.sqlite.prepare("UPDATE questions SET revision = revision + 1 WHERE id = 'q1'").run();
    }
    return originalBatch(statements);
  };

  const result = await callAdminTool(f, "admin_batch_update_questions", {
    examId: "examA",
    items: [{ id: "q1", expectedRevision: 1, proposalToken: preview.proposalToken, payload: { tags: ["raced-tag"] } }],
  });
  assert.equal(result.updated, 0);
  assert.equal(result.outcomes[0].status, "skipped");
  assert.equal(result.outcomes[0].reason, "stale_question; refresh preview");
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["math"],
    "the rejected update's tag-link sync must never have run — see buildTagLinkStatements' revision guard");
});

test("implementation: a duplicate externalId inside one batch rolls back the whole call, matching D1's atomic batch semantics", async (t) => {
  const f = await questionBankFixture(t);
  const item = (stem) => ({ type: "single_choice", externalId: "DUP1", stem,
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] });
  const p1 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: item("First") });
  const p2 = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: item("Second") });

  const result = await callAdminTool(f, "admin_batch_create_questions", {
    examId: "examA",
    items: [
      { payload: item("First"), proposalToken: p1.proposalToken, proposalId: p1.proposalId },
      { payload: item("Second"), proposalToken: p2.proposalToken, proposalId: p2.proposalId },
    ],
  });
  assert.equal(result.created, 0);
  assert.equal(result.failed, 2);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["failed", "failed"]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'DUP1'").get().c, 0);
});

test("implementation (review): admin_create_question rejects a proposalId reused with a different request instead of replaying or recreating it", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "single_choice", stem: "Original Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });

  // A different, otherwise-valid request reusing the same proposalId must be
  // rejected as a conflict — never silently return the unrelated original
  // question, and never silently create the new one either.
  const otherFields = { type: "single_choice", stem: "Different Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["b"] };
  const otherPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: otherFields });
  const reused = await callAdminToolExpectingError(f, "admin_create_question",
    { examId: "examA", payload: otherFields, proposalToken: otherPreview.proposalToken, proposalId: preview.proposalId });
  assert.equal(reused.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Different Q?'").get().c, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount + 1);
});

test("implementation (review): admin_batch_create_questions reports a proposalId reused with a different request as a skipped item, not a successful replay", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "single_choice", stem: "Original Batch Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  const first = await callAdminTool(f, "admin_batch_create_questions",
    { examId: "examA", items: [{ payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId }] });
  assert.equal(first.created, 1);

  const otherFields = { type: "single_choice", stem: "Different Batch Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["b"] };
  const otherPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: otherFields });
  const second = await callAdminTool(f, "admin_batch_create_questions",
    { examId: "examA", items: [{ payload: otherFields, proposalToken: otherPreview.proposalToken, proposalId: preview.proposalId }] });
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 1);
  assert.equal(second.outcomes[0].reason, "proposal_id_reused_with_different_request");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Different Batch Q?'").get().c, 0);
});

test("implementation (review): a replay after the created question is deleted does not recreate it, but a fresh preview still allows intentional recreation", async (t) => {
  const f = await questionBankFixture(t);
  const fields = { type: "single_choice", stem: "Deletable Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  const created = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  await callAdminTool(f, "admin_delete_question", { examId: "examA", id: created.question.id, expectedRevision: 1 });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Deletable Q?'").get().c, 0);

  const replay = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(lastMetric(f, "tool").outcome, "replayed");
  assert.equal(lastMetric(f, "tool").created, 0);
  assert.equal(replay.deletedSinceCreation, true);
  assert.equal(replay.question, null);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Deletable Q?'").get().c, 0);

  const batchReplay = await callAdminTool(f, "admin_batch_create_questions", {
    examId: "examA", items: [{ payload: fields, proposalToken: preview.proposalToken, proposalId: preview.proposalId }],
  });
  assert.equal(batchReplay.created, 0);
  assert.equal(batchReplay.skipped, 1);
  assert.equal(batchReplay.outcomes[0].reason, "idempotent_replay_deleted_since");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Deletable Q?'").get().c, 0);

  // A fresh preview (a new proposalId) still allows intentionally recreating
  // the same content — deletion isn't permanently "poisoned."
  const freshPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  const recreated = await callAdminTool(f, "admin_create_question",
    { examId: "examA", payload: fields, proposalToken: freshPreview.proposalToken, proposalId: freshPreview.proposalId });
  assert.equal(recreated.idempotentReplay, undefined);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Deletable Q?'").get().c, 1);
});

test("implementation (review): an audit-insert failure rolls back its paired mutation atomically, for update, delete, and both batch tools", async (t) => {
  const f = await questionBankFixture(t);
  const boom = () => f.sqlite.exec(
    "CREATE TRIGGER audit_boom BEFORE INSERT ON admin_mcp_audit_log BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END;",
  );
  const disarm = () => f.sqlite.exec("DROP TRIGGER audit_boom");

  // Single update: if its paired audit row can't commit, the update itself
  // must not commit either — not just "KV didn't get invalidated."
  const tagPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", id: "q1", payload: { tags: ["boom"] } });
  boom();
  await assert.rejects(() => callAdminTool(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: 1, payload: { tags: ["boom"] }, proposalToken: tagPreview.proposalToken,
  }));
  const q1AfterUpdateAttempt = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q1'").get();
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["math"]);
  assert.equal(q1AfterUpdateAttempt.revision, 1);
  disarm();

  // Single delete: same requirement.
  boom();
  await assert.rejects(() => callAdminTool(f, "admin_delete_question", { examId: "examB", id: "q5", expectedRevision: 1 }));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE id = 'q5'").get().c, 1);
  disarm();

  // Batch create: the queued item's insert must not survive if its paired
  // audit row can't.
  const fields = { type: "single_choice", stem: "Boom batch create?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] };
  const createPreview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", payload: fields });
  boom();
  await assert.rejects(() => callAdminTool(f, "admin_batch_create_questions", {
    examId: "examA", items: [{ payload: fields, proposalToken: createPreview.proposalToken, proposalId: createPreview.proposalId }],
  }));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE stem = 'Boom batch create?'").get().c, 0);
  disarm();

  // Batch update: same requirement.
  const q4Preview = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", id: "q4", payload: { tags: ["boom-batch"] } });
  boom();
  await assert.rejects(() => callAdminTool(f, "admin_batch_update_questions", {
    examId: "examA", items: [{ id: "q4", expectedRevision: 1, proposalToken: q4Preview.proposalToken, payload: { tags: ["boom-batch"] } }],
  }));
  const q4Row = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q4'").get();
  assert.deepEqual(getQuestionTags(f.sqlite, "q4"), ["fill"]);
  assert.equal(q4Row.revision, 1);
  disarm();
});

test("implementation: Admin MCP content mutations consume a separate, stricter quota than reads and the blanket account quota", async (t) => {
  const f = await questionBankFixture(t);

  // A normal read consumes only the blanket account quota, never the
  // mutation-specific one.
  await callAdminTool(f, "admin_list_exams", {});
  assert.ok(f.limits.some(({ key, max }) => key === "mcp:admin:user:admin" && max === 30));
  assert.ok(!f.limits.some(({ key }) => key === "mcp:admin:admin:mutation"));

  const preview = await callAdminTool(f, "admin_validate_question_payload", {
    examId: "examA",
    payload: { type: "single_choice", stem: "Quota'd?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] },
  });

  // A create consumes the mutation-specific quota, using its own configured
  // max — distinct from (and stricter than) the blanket account quota.
  await callAdminTool(f, "admin_create_question", {
    examId: "examA", payload: preview.payload, proposalToken: preview.proposalToken, proposalId: preview.proposalId,
  });
  assert.ok(f.limits.some(({ key, max }) => key === "mcp:admin:admin:mutation" && max === 10));

  // Now exhaust only the mutation-specific quota — reads and the blanket
  // quota remain unaffected, proving the two gates are independent.
  const baseGet = f.env.RATE_LIMITER.get;
  f.env.RATE_LIMITER.get = (key) => key === "mcp:admin:admin:mutation"
    ? { fetch: async () => Response.json({ allowed: false, retryAfter: 5 }) }
    : baseGet(key);

  await callAdminTool(f, "admin_list_exams", {}); // reads still succeed

  const beforeQuestions = f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c;
  const beforeAudit = f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_audit_log").get().c;
  const blocked = await callAdminToolExpectingError(f, "admin_update_exam", { id: "examA", name: "Renamed while quota'd" });
  assert.equal(blocked.code, "rate_limited");
  // implementation — the operation-level limiter's own retryAfter must reach the
  // caller, not be discarded in favor of a bare "rate_limited" with no guidance.
  assert.equal(blocked.retryAfter, 5);
  // A rejected mutation leaves no trace: no data change, no audit row —
  // the quota gate runs before any write is attempted.
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, beforeQuestions);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_audit_log").get().c, beforeAudit);
  assert.equal(f.sqlite.prepare("SELECT name FROM exams WHERE id = 'examA'").get().name, "Exam A");

  // implementation — the mutation-key limiter itself being unreachable (as
  // opposed to denying the request) must surface as "unavailable", not the
  // generic "internal" an unrelated application bug would produce, and must
  // still block the write — even though the account/IP gates ahead of it
  // are healthy.
  f.env.RATE_LIMITER.get = (key) => key === "mcp:admin:admin:mutation"
    ? { fetch: async () => { throw new Error("simulated mutation-limiter outage"); } }
    : baseGet(key);
  const unavailable = await callAdminToolExpectingError(f, "admin_update_exam", { id: "examA", name: "Renamed during outage" });
  assert.equal(unavailable.code, "unavailable");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, beforeQuestions);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_audit_log").get().c, beforeAudit);
  assert.equal(f.sqlite.prepare("SELECT name FROM exams WHERE id = 'examA'").get().name, "Exam A");
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

// --- implementation — exam lifecycle, import workflow, and taxonomy tools -------

function importFile(questions, overrides = {}) {
  return { schemaVersion: "1.0", exam: { id: "examA", name: "Exam A" }, questions, ...overrides };
}

test("implementation: admin_create_exam/admin_update_exam/admin_archive_exam use safe lifecycle semantics", async (t) => {
  const f = await fixture(t);
  const created = await callAdminTool(f, "admin_create_exam", { slug: "new-exam", name: "New Exam" });
  assert.equal(created.exam.slug, "new-exam");
  assert.equal(created.exam.archivedAt, null);

  const dup = await callAdminToolExpectingError(f, "admin_create_exam", { slug: "new-exam", name: "Dup" });
  assert.equal(dup.code, "conflict");

  const updated = await callAdminTool(f, "admin_update_exam", { id: created.exam.id, name: "Renamed Exam" });
  assert.equal(updated.exam.name, "Renamed Exam");

  const noFields = await callAdminToolExpectingError(f, "admin_update_exam", { id: created.exam.id });
  assert.equal(noFields.code, "invalid_input");

  const archived = await callAdminTool(f, "admin_archive_exam", { id: created.exam.id });
  assert.ok(archived.archivedAt);

  const alreadyArchived = await callAdminToolExpectingError(f, "admin_archive_exam", { id: created.exam.id });
  assert.equal(alreadyArchived.code, "conflict");

  const notFound = await callAdminToolExpectingError(f, "admin_archive_exam", { id: "missing-exam" });
  assert.equal(notFound.code, "not_found");

  const audit = f.sqlite.prepare("SELECT action, outcome FROM admin_mcp_audit_log ORDER BY rowid").all();
  assert.deepEqual(audit.map((r) => `${r.action}:${r.outcome}`), [
    "exam_create:success", "exam_create:failure", "exam_update:success",
    "exam_archive:success", "exam_archive:failure", "exam_archive:failure",
  ]);
});

test("implementation: a pure catalog rename of a previously-imported question's tag does not manufacture a false 'locally_edited' conflict on re-import", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{
    externalId: "TAGGED1", type: "single_choice", stem: "Tagged import Q?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"], tags: ["old-tag"],
  }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  await callAdminTool(f, "admin_execute_import", { examId: "examA", file, importId: preview.importId, importToken: preview.importToken });
  const created = await callAdminTool(f, "admin_search_questions", { examId: "examA", q: "TAGGED1" });
  assert.deepEqual(getQuestionTags(f.sqlite, created.questions[0].id), ["old-tag"]);

  // Rename the tag — a pure catalog identity change, no question touched.
  await callAdminTool(f, "admin_update_tag", { name: "old-tag", newName: "new-tag" });
  assert.deepEqual(getQuestionTags(f.sqlite, created.questions[0].id), ["new-tag"]);

  // Re-preview the SAME original file (which still says "old-tag") — this
  // question's own content was never locally edited, only the shared tag's
  // display name changed, so the reason must be "incoming_changes" (the
  // file's stale tag name vs. the live rename), never "locally_edited".
  const reImport = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  assert.equal(reImport.conflicts.length, 0, "resolved as a plain update candidate, not a conflict needing manual review");
  assert.equal(reImport.updates.length, 1);
});

test("merging imported tag identities preserves re-import baselines without hiding later content edits", async (t) => {
  const f = await questionBankFixture(t);
  const question = { externalId: "MERGED1", type: "fill_blank", stem: "Original imported question", correctAnswers: ["yes"], tags: ["legacy-a", "legacy-b", "standard"] };
  const file = importFile([question]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  await callAdminTool(f, "admin_execute_import", { examId: "examA", file, importId: preview.importId, importToken: preview.importToken });
  const stored = f.sqlite.prepare("SELECT id, revision FROM questions WHERE external_id='MERGED1'").get();
  await callAdminTool(f, "admin_merge_tags", { names: ["legacy-a", "legacy-b"], targetName: "standard" });
  const target = f.sqlite.prepare("SELECT id FROM question_bank_tags WHERE name='standard'").get().id;
  const merged = f.sqlite.prepare("SELECT revision, import_baseline_tag_ids_json FROM questions WHERE id=?").get(stored.id);
  assert.equal(merged.revision, stored.revision);
  assert.deepEqual(JSON.parse(merged.import_baseline_tag_ids_json), [target]);
  const incoming = importFile([{ ...question, stem: "Supplier revision", tags: ["standard"] }]);
  const next = await callAdminTool(f, "admin_preview_import", { examId: "examA", file: incoming });
  assert.equal(next.conflicts.length, 0);
  assert.equal(next.updates.length, 1);
  f.sqlite.prepare("UPDATE questions SET stem='Manual correction', revision=revision+1 WHERE id=?").run(stored.id);
  const edited = await callAdminTool(f, "admin_preview_import", { examId: "examA", file: incoming });
  assert.equal(edited.updates.length, 0);
  assert.equal(edited.conflicts[0].reason, "locally_edited");
});

test("a question save preserves the import baseline remapped by a concurrent tag merge", async (t) => {
  const f = await questionBankFixture(t);
  const question = { externalId: "MERGE-RACE", type: "fill_blank", stem: "Original imported question", correctAnswers: ["yes"], tags: ["legacy", "standard"] };
  const file = importFile([question]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  await callAdminTool(f, "admin_execute_import", { examId: "examA", file, importId: preview.importId, importToken: preview.importToken });
  const stored = f.sqlite.prepare("SELECT id, revision, import_baseline_json FROM questions WHERE external_id='MERGE-RACE'").get();
  const payload = { stem: question.stem };
  const proposal = await callAdminTool(f, "admin_validate_question_payload", { examId: "examA", id: stored.id, payload });

  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let merged = false;
  f.env.DB.batch = async (statements) => {
    f.env.DB.batch = originalBatch;
    // The save already read the original baseline and tag links. A catalog
    // merge remaps both without changing the question revision before it writes.
    await callAdminTool(f, "admin_merge_tags", { names: ["legacy"], targetName: "standard" });
    merged = true;
    return originalBatch(statements);
  };
  await callAdminTool(f, "admin_update_question", {
    examId: "examA", id: stored.id, expectedRevision: stored.revision, payload, proposalToken: proposal.proposalToken,
  });
  assert.equal(merged, true);
  const saved = f.sqlite.prepare("SELECT revision, import_baseline_json, import_baseline_tag_ids_json FROM questions WHERE id=?").get(stored.id);
  const target = f.sqlite.prepare("SELECT id FROM question_bank_tags WHERE name='standard'").get().id;
  assert.equal(saved.revision, stored.revision + 1);
  assert.equal(saved.import_baseline_json, stored.import_baseline_json);
  assert.deepEqual(JSON.parse(saved.import_baseline_tag_ids_json), [target]);
  assert.deepEqual(getQuestionTags(f.sqlite, stored.id), ["standard"]);

  const incoming = importFile([{ ...question, stem: "Supplier revision", tags: ["standard"] }]);
  const next = await callAdminTool(f, "admin_preview_import", { examId: "examA", file: incoming });
  assert.equal(next.conflicts.length, 0, "a no-op save must not manufacture a locally_edited conflict");
  assert.equal(next.updates.length, 1);
});

test("implementation (review): a taxonomy change between preview and execute invalidates the approved import token instead of silently resolving a name differently than reviewed", async (t) => {
  const f = await questionBankFixture(t);
  await callAdminTool(f, "admin_create_tag", { name: "aws" });
  const file = importFile([{
    externalId: "NEWTAG1", type: "single_choice", stem: "New tagged import?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"], tags: ["aws"],
  }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  assert.equal(preview.creates.length, 1);

  // Between preview and execute, "aws" is renamed away — an execute using
  // the file+importToken exactly as reviewed would otherwise resolve "aws"
  // to a BRAND NEW catalog identity (the reviewed one no longer matches),
  // silently changing what the approved import actually commits.
  await callAdminTool(f, "admin_update_tag", { name: "aws", newName: "amazon-web-services" });

  const error = await callAdminToolExpectingError(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(error.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'NEWTAG1'").get().c, 0,
    "nothing committed under a stale tag-resolution token");

  // A fresh preview picks up the renamed taxonomy and its own token then
  // executes cleanly. No alias table (deliberately out of scope — see the
  // PR description): the file still literally says "aws", which no longer
  // matches any catalog row post-rename, so this creates a distinct new
  // "aws" identity rather than reusing "amazon-web-services" — an
  // explicit, visible outcome instead of a silently wrong one.
  const freshPreview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const executed = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: freshPreview.importId, importToken: freshPreview.importToken,
  });
  assert.equal(executed.created, 1);
  assert.equal(lastMetric(f, "tool").created, 1);
  assert.equal(lastMetric(f, "tool").kind, "admin_mutation");
  const created = await callAdminTool(f, "admin_search_questions", { examId: "examA", q: "NEWTAG1" });
  assert.deepEqual(getQuestionTags(f.sqlite, created.questions[0].id), ["aws"]);
  const awsRow = f.sqlite.prepare("SELECT id FROM question_bank_tags WHERE normalized_name = 'aws'").get();
  const renamedRow = f.sqlite.prepare("SELECT id FROM question_bank_tags WHERE normalized_name = 'amazon-web-services'").get();
  assert.notEqual(awsRow.id, renamedRow.id, "a distinct new identity, not the renamed original");
});

test("implementation: admin_preview_import classifies without writing, and admin_execute_import binds to the exact reviewed file", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{
    externalId: "NEW1", type: "single_choice", stem: "Import Q1?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"],
  }]);

  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  assert.equal(preview.valid, true);
  assert.equal(preview.creates.length, 1);
  assert.equal(preview.updates.length, 0);
  assert.equal(preview.conflicts.length, 0);
  assert.ok(preview.importId);
  assert.ok(preview.importToken);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount, "preview must not write");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM admin_mcp_import_jobs").get().c, 0, "preview must not create a job row");

  const tamperedFile = importFile([{ ...file.questions[0], stem: "Tampered" }]);
  const stale = await callAdminToolExpectingError(f, "admin_execute_import", {
    examId: "examA", file: tamperedFile, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(stale.code, "conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount);

  const executed = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(executed.created, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'NEW1'").get().c, 1);
  assert.ok(f.importRateLimitCalls.some((c) => c.kind === "validate"));
  assert.ok(f.importRateLimitCalls.some((c) => c.kind === "execute"));
  assert.ok([...f.bucketObjects.keys()].some((key) => key.startsWith("imports/examA/")));

  const status = await callAdminTool(f, "admin_get_import_status", { importId: preview.importId });
  assert.equal(status.status, "completed");
  assert.equal(status.createdCount, 1);

  // A retry with the exact same importId/importToken/resolutions (lost
  // response, at-least-once delivery) must replay instead of duplicating —
  // this is the fix for the reviewed version's missing commit boundary.
  const replay = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(lastMetric(f, "tool").outcome, "replayed");
  assert.equal(lastMetric(f, "tool").created, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'NEW1'").get().c, 1);

  // The stale-token attempt above and the real execute each wrote their own
  // audit row; the later replay is not a new mutation and must add no more.
  const importAudit = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_execute_import' AND action = 'import_execute' ORDER BY rowid",
  ).all();
  assert.deepEqual(importAudit.map((r) => r.outcome), ["failure", "success"]);
});

test("implementation: admin_execute_import requires an explicit resolution for any changed row, and rejects a same-importId replay whose conflictResolutions differ", async (t) => {
  const f = await questionBankFixture(t);
  const original = {
    externalId: "EXT-Q1", type: "single_choice", stem: "Original stem?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"],
  };
  const firstFile = importFile([original]);
  const firstPreview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file: firstFile });
  await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file: firstFile, importId: firstPreview.importId, importToken: firstPreview.importToken,
  });
  const createdRow = f.sqlite.prepare("SELECT id FROM questions WHERE external_id = 'EXT-Q1'").get();

  const incoming = { ...original, stem: "Updated stem?" };
  const file = importFile([incoming]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  assert.equal(preview.updates.length, 1, "an unedited row with a new incoming value is a candidate update in preview");
  assert.equal(preview.conflicts.length, 0);
  const candidate = preview.updates[0];
  assert.equal(candidate.questionId, createdRow.id);

  // REST's own execute rule (routes/imports.ts): ANY non-identical row needs
  // an explicit, exactly-matching resolution to be applied — even one
  // preview classified as a safe "update", not just a "conflict".
  const noResolution = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(noResolution.updated, 0);
  const conflictOutcome = noResolution.outcomes.find((o) => o.questionId === createdRow.id);
  assert.equal(conflictOutcome.status, "conflict");
  assert.equal(f.sqlite.prepare("SELECT stem FROM questions WHERE id = ?").get(createdRow.id).stem, "Original stem?");

  const preview2 = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const applied = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview2.importId, importToken: preview2.importToken,
    conflictResolutions: [{
      questionId: createdRow.id, expectedRevision: candidate.expectedRevision,
      incomingToken: candidate.incomingToken, action: "apply",
    }],
  });
  assert.equal(applied.updated, 1);
  assert.equal(f.sqlite.prepare("SELECT stem FROM questions WHERE id = ?").get(createdRow.id).stem, "Updated stem?");

  // Same importId, different resolution (keep vs apply) — must be rejected,
  // never silently replay the first result or apply the new decision.
  const differentResolution = await callAdminToolExpectingError(f, "admin_execute_import", {
    examId: "examA", file, importId: preview2.importId, importToken: preview2.importToken,
    conflictResolutions: [{
      questionId: createdRow.id, expectedRevision: candidate.expectedRevision,
      incomingToken: candidate.incomingToken, action: "keep",
    }],
  });
  assert.equal(differentResolution.code, "conflict");
});

test("implementation: a stale in_progress import claim is taken over on resume without duplicating already-created rows", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{
    externalId: "RESUME1", type: "single_choice", stem: "Resumable?",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"],
  }]);
  const preview = await callAdminTool(f, "admin_preview_import", { examId: "examA", file });
  const result = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(result.created, 1);

  // Simulate a crashed prior attempt: force the job back to in_progress with
  // a stale timestamp, as claimImportJob would find it after a real crash.
  f.sqlite.prepare("UPDATE admin_mcp_import_jobs SET status = 'in_progress', updated_at = ? WHERE id = ?")
    .run(Date.now() - 5 * 60 * 1000, preview.importId);
  f.kvInvalidations.length = 0; // isolate what THIS resumed call invalidates

  const resumed = await callAdminTool(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(resumed.failed, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions WHERE external_id = 'RESUME1'").get().c, 1,
    "resume must not recreate the already-created row");
  // implementation (review round 2): re-classifying against current DB state
  // would see the already-created row as "identical" and reclassify it as a
  // plain skip, undercounting `created` and skipping cache invalidation —
  // the admin_mcp_import_committed_items ledger must recover it instead.
  assert.equal(resumed.created, 1,
    "the resumed attempt must recover the prior attempt's committed create, not report it as a skip");
  assert.ok(f.kvInvalidations.includes("practice-questions:examA"),
    "a resume that recovers a committed create must still invalidate cache, in case the original attempt died before invalidating");

  // A fresh (non-stale) in_progress claim must NOT be taken over.
  f.sqlite.prepare("UPDATE admin_mcp_import_jobs SET status = 'in_progress', updated_at = ? WHERE id = ?")
    .run(Date.now(), preview.importId);
  const busy = await callAdminToolExpectingError(f, "admin_execute_import", {
    examId: "examA", file, importId: preview.importId, importToken: preview.importToken,
  });
  assert.equal(busy.code, "conflict");
});

test("implementation: admin import tools reject excessive JSON nesting", async (t) => {
  const f = await questionBankFixture(t);
  let deep = "leaf";
  for (let i = 0; i < 40; i++) deep = [deep];
  const badFile = importFile([{
    type: "single_choice", stem: "Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    correctAnswers: ["a"], tags: deep,
  }]);
  const rejected = await callAdminToolExpectingError(f, "admin_validate_import", { examId: "examA", file: badFile });
  assert.equal(rejected.code, "invalid_input");
});

test("implementation: the import rate limiter distinguishes an unreachable limiter from an exceeded quota, and both block the request", async (t) => {
  const f = await questionBankFixture(t);
  const file = importFile([{ type: "single_choice", stem: "Q?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctAnswers: ["a"] }]);

  f.env.IMPORT_VALIDATE_RATE_LIMITER = { limit: async () => { throw new Error("simulated Cloudflare rate-limiter outage"); } };
  const unavailable = await callAdminToolExpectingError(f, "admin_validate_import", { examId: "examA", file });
  assert.equal(unavailable.code, "unavailable");

  f.env.IMPORT_VALIDATE_RATE_LIMITER = { limit: async () => ({ success: false }) };
  const limited = await callAdminToolExpectingError(f, "admin_validate_import", { examId: "examA", file });
  assert.equal(limited.code, "rate_limited");

  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c, f.questionRowCount, "neither rejection wrote anything");
});

test("implementation: admin_create_tag registers a zero-reference catalog entry that admin_list_tags surfaces", async (t) => {
  const f = await questionBankFixture(t);
  const created = await callAdminTool(f, "admin_create_tag", { name: "unused-tag" });
  assert.ok(created.id);
  const dup = await callAdminToolExpectingError(f, "admin_create_tag", { name: "Unused-Tag" });
  assert.equal(dup.code, "conflict");

  const listed = await callAdminTool(f, "admin_list_tags", {});
  const entry = listed.items.find((tag) => tag.tag === "unused-tag");
  assert.ok(entry, "a catalog tag with zero questions must still be listed");
  assert.equal(entry.questionCount, 0);
  assert.equal(entry.registered, true);
});

test("implementation: admin_update_tag renames a tag's catalog identity, case-insensitively, without rewriting any question", async (t) => {
  const f = await questionBankFixture(t);
  const before = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q3'").get().revision;
  const renamed = await callAdminTool(f, "admin_update_tag", { name: "SCIENCE", newName: "natural-science" });
  assert.equal(renamed.affectedQuestionCount, 1);
  assert.deepEqual(getQuestionTags(f.sqlite, "q3"), ["natural-science"]);
  const after = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q3'").get().revision;
  assert.equal(after, before, "a pure catalog rename must not bump the question's content revision");
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags WHERE normalized_name = 'science'").get().c, 0,
    "the old identity is renamed in place, not left behind as a second row",
  );
  // No question row changed, but the renamed display name is embedded in
  // examA's cached practice catalog — that still needs invalidating.
  assert.ok(f.kvInvalidations.includes("practice-questions:examA"));
});

test("implementation: admin_merge_tags reassigns every source tag's association on a question carrying more than one of them, without dropping any, and never rewrites a question", async (t) => {
  const f = await questionBankFixture(t);
  // q1 seeds with tags ["math"]; give it a second tag also being merged, so
  // one question is affected by two source names at once — this is exactly
  // the scenario implementation's original per-row rewrite bug dropped a tag on.
  seedQuestionTags(f.sqlite, "q1", ["algebra"]);
  const before = f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q1'").get().revision;

  const merged = await callAdminTool(f, "admin_merge_tags", { names: ["math", "algebra"], targetName: "mathematics" });
  assert.equal(merged.affectedQuestionCount, 2, "q1 (math+algebra) and q5 (math) both carry a merged-away name");

  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["mathematics"],
    "both merged-away tags on the same question collapse into exactly one association with the target, not a dropped tag");
  assert.equal(f.sqlite.prepare("SELECT revision FROM questions WHERE id = 'q1'").get().revision, before,
    "a merge is a pure catalog + association change — it must not bump any question's content revision");

  assert.deepEqual(getQuestionTags(f.sqlite, "q5"), ["examB", "mathematics"]);

  // implementation: unlike implementation's original lazy-registration model, every other
  // tag actually used by a question (science/fill/examB, from the base
  // fixture) is already its own real catalog row too — merging math+algebra
  // only removes THOSE two source identities, not the unrelated ones.
  const catalogNames = f.sqlite.prepare("SELECT name FROM question_bank_tags ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(catalogNames, ["examB", "fill", "mathematics", "science"], "both source catalog identities are gone, only the target remains besides the unrelated tags");
  assert.ok(f.kvInvalidations.includes("practice-questions:examA"));
  assert.ok(f.kvInvalidations.includes("practice-questions:examB"));
});

test("implementation: renaming a tag used by more than 500 questions succeeds without rewriting any of them", async (t) => {
  const f = await questionBankFixture(t);
  const now = new Date().toISOString();
  const insertQuestion = f.sqlite.prepare(`INSERT INTO questions
    (id, exam_id, external_id, sequence_number, type, stem, options_json, correct_answers_json,
     explanation, difficulty, points, created_at, updated_at)
    VALUES (?, 'examA', NULL, ?, 'fill_blank', ?, NULL, '["x"]', NULL, 'easy', 1, ?, ?)`);
  const ids = [];
  for (let i = 0; i < 501; i++) {
    const id = `bulk-${i}`;
    ids.push(id);
    insertQuestion.run(id, 100 + i, `Bulk question ${i}`, now, now);
    seedQuestionTags(f.sqlite, id, ["bulk-tag"]);
  }
  const renamed = await callAdminTool(f, "admin_update_tag", { name: "bulk-tag", newName: "renamed-bulk-tag" });
  assert.equal(renamed.affectedQuestionCount, 501);
  assert.deepEqual(getQuestionTags(f.sqlite, ids[500]), ["renamed-bulk-tag"]);
  for (const id of ids) {
    assert.equal(f.sqlite.prepare("SELECT revision FROM questions WHERE id = ?").get(id).revision, 1);
  }
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

// --- implementation review round 2 — catalog rename identity and admin_list_tags
// pagination; implementation replaces the per-row rewrite-conflict tests above
// with catalog-level concurrency tests (there is no more per-row rewrite to
// race with — see lib/questionBankTags.ts). --------------------------------

test("implementation: a concurrent rename of the same tag between read and write is reported as a conflict, never silently lost", async (t) => {
  const f = await questionBankFixture(t);
  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let intercepted = false;
  f.env.DB.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      // Simulate another admin renaming "math" concurrently, between this
      // call's findTagCatalogRowByName read (which captured the pre-race
      // revision) and its own compare-and-swap write committing.
      f.sqlite.prepare(
        "UPDATE question_bank_tags SET name = 'algebra-ish', normalized_name = 'algebra-ish', revision = revision + 1 WHERE normalized_name = 'math'",
      ).run();
    }
    return originalBatch(statements);
  };

  const error = await callAdminToolExpectingError(f, "admin_update_tag", { name: "math", newName: "mathematics" });
  assert.equal(error.code, "conflict");

  // The concurrent rename stands; our own rename (bound to the stale
  // revision it read) never applied.
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags WHERE normalized_name = 'mathematics'").get().c, 0);
  assert.ok(f.sqlite.prepare("SELECT 1 FROM question_bank_tags WHERE normalized_name = 'algebra-ish'").get());
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["algebra-ish"]);

  const auditRow = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_update_tag' ORDER BY rowid DESC LIMIT 1",
  ).get();
  assert.equal(auditRow.outcome, "failure");

  // A retry against the tag's now-current name succeeds normally.
  const retry = await callAdminTool(f, "admin_update_tag", { name: "algebra-ish", newName: "mathematics" });
  assert.equal(retry.conflicts.length, 0);
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["mathematics"]);
});

test("implementation (review): a concurrent rename of one SOURCE tag between admin_merge_tags' read and its write aborts the whole merge, not just that source", async (t) => {
  const f = await questionBankFixture(t);
  // Sources: "math" (q1, q5) and "science" (q3). Simulate another admin
  // renaming "science" away right before the merge batch commits — after
  // mergeTags already read its (now-stale) revision.
  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let intercepted = false;
  f.env.DB.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      f.sqlite.prepare(
        "UPDATE question_bank_tags SET name = 'natural-science', normalized_name = 'natural-science', revision = revision + 1 WHERE normalized_name = 'science'",
      ).run();
    }
    return originalBatch(statements);
  };

  const error = await callAdminToolExpectingError(f, "admin_merge_tags", { names: ["math", "science"], targetName: "mathematics" });
  assert.equal(error.code, "conflict");

  // The WHOLE merge must abort — not just skip the drifted source: "math"
  // (which did NOT drift) must still be untouched too, proving this isn't a
  // per-source partial-success but a single atomic all-or-nothing decision.
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags WHERE normalized_name = 'mathematics'").get().c, 0,
    "the target must never be created/touched when any source drifted");
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["math"], "an undrifted source's links must also be untouched");
  assert.deepEqual(getQuestionTags(f.sqlite, "q3"), ["natural-science"], "the concurrently-renamed source's own edit stands, undisturbed");
  assert.ok(f.sqlite.prepare("SELECT 1 FROM question_bank_tags WHERE normalized_name = 'math'").get(), "the undrifted source catalog row must survive too");

  const auditRow = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_merge_tags' ORDER BY rowid DESC LIMIT 1",
  ).get();
  assert.equal(auditRow.outcome, "failure");

  // A retry against the now-current names succeeds normally.
  const retry = await callAdminTool(f, "admin_merge_tags", { names: ["math", "natural-science"], targetName: "mathematics" });
  assert.equal(retry.conflicts.length, 0);
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["mathematics"]);
  assert.deepEqual(getQuestionTags(f.sqlite, "q3"), ["mathematics"]);
});

test("implementation (review): a source tag deleted by a concurrent merge between admin_merge_tags' read and its write also aborts the whole merge", async (t) => {
  const f = await questionBankFixture(t);
  // Sources: "math" (q1, q5) and "science" (q3). Simulate another admin's
  // concurrent merge fully absorbing "science" into some other tag (not
  // just renaming it, but deleting its catalog row outright) right before
  // this merge's batch commits — after mergeTags already read its
  // (now-stale) revision. A deleted source has no row left to match the
  // old `(id = ? AND revision <> ?)` OR-chain (there's nothing to compare
  // a "changed" revision against), so it must still be caught by the
  // "every expected source id still exists at exactly its expected
  // revision" guard (implementation follow-up review) rather than let the merge
  // proceed as if "science" had never drifted.
  const originalBatch = f.env.DB.batch.bind(f.env.DB);
  let intercepted = false;
  f.env.DB.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      f.sqlite.prepare("DELETE FROM question_bank_tags WHERE normalized_name = 'science'").run();
    }
    return originalBatch(statements);
  };

  const error = await callAdminToolExpectingError(f, "admin_merge_tags", { names: ["math", "science"], targetName: "mathematics" });
  assert.equal(error.code, "conflict");

  // The WHOLE merge must abort — "math" (which did NOT drift) must still be
  // untouched too, proving the vanished source aborts the entire atomic
  // batch rather than just being skipped.
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags WHERE normalized_name = 'mathematics'").get().c, 0,
    "the target must never be created/touched when a source vanished concurrently");
  assert.deepEqual(getQuestionTags(f.sqlite, "q1"), ["math"], "an undrifted source's links must also be untouched");
  assert.ok(f.sqlite.prepare("SELECT 1 FROM question_bank_tags WHERE normalized_name = 'math'").get(), "the undrifted source catalog row must survive too");

  const auditRow = f.sqlite.prepare(
    "SELECT outcome FROM admin_mcp_audit_log WHERE tool = 'admin_merge_tags' ORDER BY rowid DESC LIMIT 1",
  ).get();
  assert.equal(auditRow.outcome, "failure");
});

test("implementation (review round 2): admin_update_tag preserves the catalog entry's id across a rename, including renaming back", async (t) => {
  const f = await questionBankFixture(t);
  const beforeCount = f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags").get().c;
  const created = await callAdminTool(f, "admin_create_tag", { name: "old-name" });
  const renamed = await callAdminTool(f, "admin_update_tag", { name: "old-name", newName: "new-name" });
  assert.equal(renamed.conflicts.length, 0);
  // Scoped to +1 over whatever the fixture's own questions already
  // registered (implementation: every used tag is a real catalog row now) —
  // the assertion that matters is "rename must not create a SECOND
  // identity for the same tag", not "the catalog is empty otherwise".
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags").get().c, beforeCount + 1);
  const row = f.sqlite.prepare("SELECT id, name FROM question_bank_tags WHERE id = ?").get(created.id);
  assert.equal(row.name, "new-name");

  // Renaming back must not be rejected as a collision with a leftover old row.
  const renamedBack = await callAdminTool(f, "admin_update_tag", { name: "new-name", newName: "old-name" });
  assert.equal(renamedBack.conflicts.length, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags").get().c, beforeCount + 1);
  const rowAfter = f.sqlite.prepare("SELECT id, name FROM question_bank_tags WHERE id = ?").get(created.id);
  assert.equal(rowAfter.name, "old-name");
});

test("implementation (review round 2): admin_list_tags paginates the combined used/registered set correctly, without repeats or exceeding the limit", async (t) => {
  const f = await questionBankFixture(t);
  // "math" is already used (q1, q5) and — implementation — therefore already a
  // real catalog row; add an unused catalog-only tag that sorts after
  // everything used.
  await callAdminTool(f, "admin_create_tag", { name: "zzz-unused" });

  const allTags = [];
  let offset = 0;
  for (let i = 0; i < 20; i++) {
    const page = await callAdminTool(f, "admin_list_tags", { limit: 1, offset });
    assert.ok(page.items.length <= 1, "a page must never exceed the requested limit");
    allTags.push(...page.items);
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  const names = allTags.map((tag) => tag.tag);
  assert.equal(new Set(names).size, names.length, "no tag may be repeated across pages");
  assert.ok(names.includes("math"));
  assert.ok(names.includes("zzz-unused"));

  const mathEntry = allTags.find((tag) => tag.tag === "math");
  assert.equal(mathEntry.questionCount, 2, "a tag used on an early page must keep its real count, not be re-appended with 0");
  assert.equal(mathEntry.registered, true);
  const unusedEntry = allTags.find((tag) => tag.tag === "zzz-unused");
  assert.equal(unusedEntry.questionCount, 0);
  assert.equal(unusedEntry.registered, true);
});

// Decode the published Analytics Engine v1 schema, not transport/private data.
function metric(point) {
  const [schema, event, audience, method, tool, outcome, error, auth, stage, kind, mode, transport] = point.blobs;
  const [count, durationMs, httpStatus, slow, created, updated, skipped, failed, conflict, replayed, omittedTools] = point.doubles;
  return { schema, event, audience, method, tool, outcome, error, auth, stage, kind, mode, transport,
    count, durationMs, httpStatus, slow, created, updated, skipped, failed, conflict, replayed, omittedTools };
}
function lastMetric(f, event = "request") {
  return f.metrics.map(metric).filter((point) => point.event === event).at(-1);
}

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
      f.env.RATE_LIMITER.get = (key) => ({ fetch: async () => {
        if (gate === "ip_limit" || key.startsWith("mcp:")) {
          if (unavailable) throw new Error("PRIVATE_LIMITER_KEY");
          return Response.json({ allowed: false, retryAfter: 7 });
        }
        return Response.json({ allowed: true });
      } });
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
    f.env.RATE_LIMITER.get = (key) => ({ fetch: async () => {
      if (key.endsWith(":mutation")) {
        if (unavailable) throw new Error("PRIVATE_QUOTA_OUTAGE");
        return Response.json({ allowed: false, retryAfter: 12 });
      }
      return Response.json({ allowed: true });
    } });
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

for (const name of ["reading", "case-with-figure", ...(process.env.COMPONENT_SOURCE_FILES?.split(",") ?? [])]) test(`component ${name}: MCP preview, idempotent import and export preserve the package`, async t => {
  const f = await fixture(t);
  await callAdminTool(f, "admin_create_exam", { slug: "component-exam", name: "Components" }).then(result => { f.componentExamId = result.exam.id; });
  const file = JSON.parse(await readFile(name.startsWith('/') ? name : new URL(`../../../tests/fixtures/components/${name}.json`, import.meta.url), 'utf8'));
  const preview = await callAdminTool(f, 'admin_preview_import', { examId: f.componentExamId, file });
  assert.equal(preview.valid, true);
  const args = { examId: f.componentExamId, file, importId: preview.importId, importToken: preview.importToken };
  const imported = await callAdminTool(f, 'admin_execute_import', args);
  assert.equal(imported.created, file.questions.length);
  const replay = await callAdminTool(f, 'admin_execute_import', args);
  assert.equal(replay.idempotentReplay, true);
  const exported = await callAdminTool(f, 'admin_export_questions', { examId: f.componentExamId, limit: 1 });
  assert.equal(exported.file.schemaVersion, '2.0'); assert.equal(exported.nextOffset, file.questions.length > 1 ? 1 : null);
  assert.deepEqual(exported.file.stimuli, file.stimuli ?? []);
  assert.deepEqual(exported.file.assets, file.assets ?? []);
  assert.ok(exported.file.questions[0].scoring);
});

test("MCP export rejects missing external IDs without writing and preserves assigned identities on re-import", async t => {
  const f = await fixture(t);
  const { exam } = await callAdminTool(f, "admin_create_exam", { slug: "round-trip", name: "Round trip" });
  const fields = { type: "fill_blank", stem: "Complete this.", correctAnswers: ["answer"], needsReview: true };
  const preview = await callAdminTool(f, "admin_validate_question_payload", { examId: exam.id, payload: fields });
  const { question } = await callAdminTool(f, "admin_create_question", {
    examId: exam.id, payload: preview.payload, proposalToken: preview.proposalToken, proposalId: preview.proposalId,
  });
  const before = f.sqlite.prepare("SELECT * FROM questions").all();
  const error = await callAdminToolExpectingError(f, "admin_export_questions", { examId: exam.id });
  assert.equal(error.code, "export_requires_external_id");
  assert.match(error.message, /Assign a unique external ID/);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM questions").all(), before);
  const identity = await callAdminTool(f, "admin_validate_question_payload", { examId: exam.id, id: question.id, payload: { externalId: "manual-1" } });
  await callAdminTool(f, "admin_update_question", {
    examId: exam.id, id: question.id, expectedRevision: identity.currentRevision, payload: identity.payload, proposalToken: identity.proposalToken,
  });
  const { file } = await callAdminTool(f, "admin_export_questions", { examId: exam.id });
  assert.equal(file.questions[0].externalId, "manual-1");
  assert.equal(file.questions[0].needsReview, true);
  const imported = await callAdminTool(f, "admin_preview_import", { examId: exam.id, file });
  assert.equal(imported.creates.length, 0);
  assert.equal(imported.conflicts[0].questionId, question.id);
  const result = await callAdminTool(f, "admin_execute_import", {
    examId: exam.id, file, importId: imported.importId, importToken: imported.importToken,
    conflictResolutions: imported.conflicts.map(({ questionId, expectedRevision, incomingToken }) => ({ questionId, expectedRevision, incomingToken, action: "apply" })),
  });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM questions").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT needs_review FROM questions WHERE id = ?").get(question.id).needs_review, 1);
});

for (const name of ["reading", "code", "case-with-figure"]) test(`single component ${name}: preview derives a committable payload and reuses create idempotency`, async t => {
  const f = await questionBankFixture(t);
  const file = JSON.parse(await readFile(new URL(`../../../tests/fixtures/components/${name}.json`, import.meta.url), "utf8"));
  const question = { ...file.questions[0], needsReview: true };
  const preview = await callAdminTool(f, "admin_preview_component_question", {
    examId: "examA", question, stimuli: file.stimuli, assets: file.assets,
  });
  assert.equal(preview.valid, true, JSON.stringify(preview));
  assert.equal(preview.payload.type, { reading: "single_choice", code: "ordering", "case-with-figure": "matching" }[name]);
  assert.ok(preview.payload.stem);
  assert.deepEqual(preview.payload.content.stimuli, file.stimuli ?? []);
  assert.deepEqual(preview.payload.content.assets, file.assets ?? []);
  assert.equal(preview.payload.needsReview, true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM questions").get().n, f.questionRowCount);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_mcp_audit_log").get().n, 0);
  const args = { examId: "examA", payload: preview.payload, proposalToken: preview.proposalToken, proposalId: preview.proposalId };
  assert.equal((await callAdminToolExpectingError(f, "admin_create_question", { ...args, payload: { ...preview.payload, needsReview: false } })).code, "conflict");
  const created = await callAdminTool(f, "admin_create_question", args);
  assert.equal(created.question.needsReview, true);
  assert.deepEqual(created.question.content.interaction, question.interaction);
  const replay = await callAdminTool(f, "admin_create_question", args);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.question.id, created.question.id);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM questions").get().n, f.questionRowCount + 1);
  assert.ok(f.limits.some(({ key }) => key === "mcp:admin:admin:mutation"));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_mcp_audit_log WHERE tool='admin_create_question' AND outcome='success'").get().n, 1);
});

test("single component edits preserve omitted metadata across JSON and reject stale revisions", async t => {
  const f = await questionBankFixture(t);
  const file = JSON.parse(await readFile(new URL("../../../tests/fixtures/components/code.json", import.meta.url), "utf8"));
  f.sqlite.prepare("UPDATE questions SET needs_review=1 WHERE id='q1'").run();
  const preview = await callAdminTool(f, "admin_preview_component_question", { examId: "examA", id: "q1", question: file.questions[0] });
  assert.equal(preview.valid, true, JSON.stringify(preview));
  assert.equal(preview.currentRevision, 1);
  assert.equal(preview.answerRevised, true);
  assert.equal(preview.payload.needsReview, true);
  assert.equal(preview.payload.explanation, "Because 2+2=4.");
  assert.equal(preview.payload.difficulty, "easy");
  assert.deepEqual(preview.payload.tags, ["math"]);
  const args = { examId: "examA", id: "q1", expectedRevision: preview.currentRevision, payload: preview.payload, proposalToken: preview.proposalToken };
  const updated = await callAdminTool(f, "admin_update_question", args);
  assert.equal(updated.question.type, "ordering");
  assert.equal(updated.question.answerRevision, 2);
  assert.equal(updated.question.needsReview, true);
  assert.equal((await callAdminToolExpectingError(f, "admin_update_question", args)).code, "conflict");
  const reviewed = await callAdminTool(f, "admin_preview_component_question", {
    examId: "examA", id: "q1", question: { ...file.questions[0], needsReview: false },
  });
  assert.equal(reviewed.answerRevised, false);
  const signedOff = await callAdminTool(f, "admin_update_question", {
    examId: "examA", id: "q1", expectedRevision: reviewed.currentRevision, payload: reviewed.payload, proposalToken: reviewed.proposalToken,
  });
  assert.equal(signedOff.question.needsReview, false);
  assert.equal(signedOff.question.answerRevision, 2);
  assert.deepEqual(signedOff.question.tags, ["math"]);
});

test("single component preview rejects invalid references, metadata and wrong exam targets without proposals or writes", async t => {
  const f = await questionBankFixture(t);
  const file = JSON.parse(await readFile(new URL("../../../tests/fixtures/components/reading.json", import.meta.url), "utf8"));
  for (const input of [
    { question: file.questions[0] },
    { question: { ...file.questions[0], needsReview: "true" }, stimuli: file.stimuli },
    { question: { ...file.questions[0], scoring: { method: "exact", correctAnswers: ["missing"] } }, stimuli: file.stimuli },
  ]) {
    const result = await callAdminTool(f, "admin_preview_component_question", { examId: "examA", ...input });
    assert.equal(result.valid, false);
    assert.ok(result.issues.length);
    assert.equal(result.proposalToken, undefined);
    assert.equal(result.proposalId, undefined);
  }
  const input = { question: file.questions[0], stimuli: file.stimuli };
  for (const target of [{ examId: "missing" }, { examId: "examB", id: "q1" }]) {
    assert.equal((await callAdminToolExpectingError(f, "admin_preview_component_question", { ...target, ...input })).code, "not_found");
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM questions").get().n, f.questionRowCount);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_mcp_audit_log").get().n, 0);
});


test("taxonomy hints account for same-name updates and repeated merges advancing revisions", async (t) => {
  const f = await questionBankFixture(t);
  const tools = (await payload(await rpc(f.env, "admin", f.admin.token))).result.tools;
  const hints = Object.fromEntries(tools.map(tool => [tool.name, tool.annotations]));
  await callAdminTool(f, "admin_create_tag", { name: "source" });
  const rows = () => f.sqlite.prepare("SELECT * FROM question_bank_tags ORDER BY id").all();
  const beforeDuplicate = rows();
  assert.equal((await callAdminToolExpectingError(f, "admin_create_tag", { name: "source" })).code, "conflict");
  assert.deepEqual(rows(), beforeDuplicate);
  assert.equal(hints.admin_create_tag.idempotentHint, true);

  const revision = name => f.sqlite.prepare("SELECT revision FROM question_bank_tags WHERE name = ?").get(name).revision;
  for (const [tool, args, target] of [
    ["admin_update_tag", { name: "source", newName: "source" }, "source"],
    ["admin_merge_tags", { names: ["source"], targetName: "target" }, "target"],
  ]) {
    await callAdminTool(f, tool, args);
    const before = revision(target);
    await callAdminTool(f, tool, args);
    assert.equal(revision(target), before + 1, `${tool} still updates the catalog on retry`);
    assert.equal(hints[tool].idempotentHint, false);
    assert.equal(hints[tool].destructiveHint, true);
  }
});
