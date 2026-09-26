import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import {
  runSmokeCheck, parseArgs, USER_TOKEN_PATTERN, ADMIN_TOKEN_PATTERN,
  REQUIRED_USER_TOOLS, REQUIRED_ADMIN_TOOLS,
} from "./mcp-smoke-check.mjs";

// implementation review — this suite exists specifically to prevent regressions
// on the two defects a PR review found by actually running the script:
// (1) a malformed/synthetic credential's value leaking into stdout/stderr
// via an echoed exception message, and (2) an old, identity-only
// deployment passing every check because the catalog check only verified
// non-empty + correct prefix, never that current business tools exist.

const MARKER = "SECRET_MARKER_DO_NOT_LEAK";
const VALID_USER_TOKEN = `pd_mcp_user_${"a".repeat(64)}`;
const VALID_ADMIN_TOKEN = `pd_mcp_admin_${"b".repeat(64)}`;

function identityOnlyFetch(userTools = ["user_get_identity"], adminTools = ["admin_get_identity"]) {
  return async (url, init) => {
    const isAdmin = url.includes("/admin-mcp");
    const auth = init.headers.Authorization ?? "";
    const audienceMatches = isAdmin ? auth.includes("_admin_") : auth.includes("_user_");
    if (!audienceMatches) return Response.json({ ok: false, error: { code: "unauthenticated" } }, { status: 401 });
    const { method, params } = JSON.parse(init.body);
    if (method === "tools/list") return Response.json({ result: { tools: (isAdmin ? adminTools : userTools).map((name) => ({ name })) } });
    if (method === "tools/call" && params.name?.endsWith("_get_identity")) {
      return Response.json({ result: { structuredContent: { ok: true, data: { server: isAdmin ? "admin" : "user" } } } });
    }
    return Response.json({ result: { isError: true, structuredContent: { ok: false, error: { code: "not_found" } } } });
  };
}

test("token format is validated before any network request, and the rejection never echoes the value", async () => {
  let fetchCalled = false;
  const fetchImpl = async () => { fetchCalled = true; throw new Error("must not be called"); };
  const malformedToken = `${MARKER}\ninvalid`;

  await assert.rejects(
    runSmokeCheck({ baseUrl: "https://example.test", userToken: malformedToken, adminToken: VALID_ADMIN_TOKEN, fetchImpl }),
    (error) => {
      assert.ok(!error.message.includes(MARKER), "rejection message must never include the credential value");
      assert.match(error.message, /User token does not match/);
      return true;
    },
  );
  assert.equal(fetchCalled, false, "a malformed token must be rejected before any request is attempted");
});

test("parseArgs rejects a missing token the same way, without requiring a network call", () => {
  assert.throws(() => parseArgs(["--base-url", "https://example.test", "--admin-token", VALID_ADMIN_TOKEN], {}), /Missing --user-token/);
});

test("a Fetch/Headers-style exception embedding the credential is categorized, never echoed", async () => {
  // Defense in depth beyond the format check above: even if some other
  // exception shape carried the token in its message (as Node's real
  // Headers.append validation error does for a value containing a control
  // character), the reported detail must be a fixed category, not the
  // exception's own message.
  const fetchImpl = async () => {
    const error = new TypeError(`Headers.append: "Bearer pd_mcp_user_${MARKER}" is an invalid header value.`);
    throw error;
  };
  const outcome = await runSmokeCheck({ baseUrl: "https://example.test", userToken: VALID_USER_TOKEN, adminToken: VALID_ADMIN_TOKEN, fetchImpl });
  assert.equal(outcome.ok, false);
  const serialized = JSON.stringify(outcome.results);
  assert.ok(!serialized.includes(MARKER), "no check detail may include the marker");
  assert.ok(!serialized.includes(VALID_USER_TOKEN), "no check detail may include the token value");
  assert.ok(outcome.results.some((r) => r.detail.includes("invalid header value")), "the fixed category must still be reported");
});

test("an old, identity-only deployment fails the required-tool-baseline check instead of passing", async () => {
  const fetchImpl = identityOnlyFetch();
  const outcome = await runSmokeCheck({ baseUrl: "https://example.test", userToken: VALID_USER_TOKEN, adminToken: VALID_ADMIN_TOKEN, fetchImpl });
  assert.equal(outcome.ok, false);
  const userCatalog = outcome.results.find((r) => r.name === "User MCP catalog reachable and scoped");
  const adminCatalog = outcome.results.find((r) => r.name === "Admin MCP catalog reachable and scoped");
  assert.equal(userCatalog.ok, false);
  assert.equal(adminCatalog.ok, false);
  for (const required of REQUIRED_USER_TOOLS.filter((n) => n !== "user_get_identity")) {
    assert.ok(userCatalog.detail.includes(required), `expected "${required}" to be reported missing`);
  }
  for (const required of REQUIRED_ADMIN_TOOLS.filter((n) => n !== "admin_get_identity")) {
    assert.ok(adminCatalog.detail.includes(required), `expected "${required}" to be reported missing`);
  }
});

test("a deployment with the full current catalog and a healthy KP order-scope read passes every check", async () => {
  const fetchImpl = async (url, init) => {
    const isAdmin = url.includes("/admin-mcp");
    const auth = init.headers.Authorization ?? "";
    const audienceMatches = isAdmin ? auth.includes("_admin_") : auth.includes("_user_");
    if (!audienceMatches) return Response.json({ ok: false, error: { code: "unauthenticated" } }, { status: 401 });
    const { method, params } = JSON.parse(init.body);
    if (method === "tools/list") return Response.json({ result: { tools: (isAdmin ? REQUIRED_ADMIN_TOOLS : REQUIRED_USER_TOOLS).map((name) => ({ name })) } });
    if (method === "tools/call" && params.name?.endsWith("_get_identity")) {
      return Response.json({ result: { structuredContent: { ok: true, data: { server: isAdmin ? "admin" : "user" } } } });
    }
    if (method === "tools/call" && params.name === "user_list_knowledge_points") {
      return Response.json({ result: { structuredContent: { ok: true, data: { items: [], nextOffset: null, orderRevision: 1 } } } });
    }
    return Response.json({ result: { isError: true, structuredContent: { ok: false, error: { code: "not_found" } } } });
  };
  const outcome = await runSmokeCheck({ baseUrl: "https://example.test", userToken: VALID_USER_TOKEN, adminToken: VALID_ADMIN_TOKEN, fetchImpl });
  assert.equal(outcome.ok, true, JSON.stringify(outcome.results));
});

test("a missing Knowledge Point order-scope (migration 0025 absent) is caught even with a full tool catalog", async () => {
  const fetchImpl = async (url, init) => {
    const isAdmin = url.includes("/admin-mcp");
    const { method, params } = JSON.parse(init.body);
    if (method === "tools/list") return Response.json({ result: { tools: (isAdmin ? REQUIRED_ADMIN_TOOLS : REQUIRED_USER_TOOLS).map((name) => ({ name })) } });
    if (method === "tools/call" && params.name?.endsWith("_get_identity")) {
      return Response.json({ result: { structuredContent: { ok: true, data: { server: isAdmin ? "admin" : "user" } } } });
    }
    if (method === "tools/call" && params.name === "user_list_knowledge_points") {
      // orderRevision missing — as if the table/migration weren't present.
      return Response.json({ result: { structuredContent: { ok: true, data: { items: [], nextOffset: null } } } });
    }
    return Response.json({ result: { isError: true } });
  };
  const outcome = await runSmokeCheck({ baseUrl: "https://example.test", userToken: VALID_USER_TOKEN, adminToken: VALID_ADMIN_TOKEN, fetchImpl });
  assert.equal(outcome.ok, false);
  const kpCheck = outcome.results.find((r) => r.name === "User MCP Knowledge Point order-scope read succeeds");
  assert.equal(kpCheck.ok, false);
});

test("cross-audience acceptance (a wrong-audience token NOT rejected) fails the check", async () => {
  const fetchImpl = async () => Response.json({ result: { tools: [] } }); // 200, i.e. wrongly accepted
  const outcome = await runSmokeCheck({ baseUrl: "https://example.test", userToken: VALID_USER_TOKEN, adminToken: VALID_ADMIN_TOKEN, fetchImpl });
  const crossCheck = outcome.results.find((r) => r.name === "User token rejected on Admin MCP");
  assert.equal(crossCheck.ok, false);
});

// --- CLI-level reproduction of the exact scenario the review reported --------------

test("CLI: a malformed token supplied on the command line never appears in stdout or stderr", () => {
  const scriptPath = fileURLToPath(new URL("./mcp-smoke-check.mjs", import.meta.url));
  const malformedToken = `Bearer ${MARKER}\nINVALID`;
  let output = "";
  let status = 0;
  try {
    output = execFileSync("node", [
      scriptPath, "--base-url", "https://example.test",
      "--user-token", malformedToken, "--admin-token", VALID_ADMIN_TOKEN,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    status = error.status;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  assert.notEqual(status, 0, "a malformed token must exit non-zero");
  assert.ok(!output.includes(MARKER), `CLI output must never include the credential marker; got: ${output.length} chars`);
  assert.ok(!output.toLowerCase().includes("bearer "), "CLI output must never echo an Authorization-shaped value");
});

// --- End-to-end against a real bundled Worker --------------------------------------

test("end-to-end against a real bundled Worker: every check passes for a healthy deployment, and fails for a wrong token", async (t) => {
  const workerRoot = fileURLToPath(new URL("..", import.meta.url));
  const [{ text }] = (await build({
    stdin: {
      contents: `export { default as worker } from './src/index.ts';
        export * from './src/mcp/credentials.ts';`,
      resolveDir: workerRoot,
    },
    bundle: true, format: "esm", platform: "node", conditions: ["workerd"], write: false,
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  })).outputFiles;
  const buildDir = await mkdtemp(join(tmpdir(), "prepdeck-smoke-e2e-"));
  t.after(() => rm(buildDir, { recursive: true, force: true }));
  const bundlePath = join(buildDir, "worker.mjs");
  await writeFile(bundlePath, text);
  const { worker, issueMcpCredential } = await import(pathToFileURL(bundlePath).href);

  const schemaFiles = [
    "0001_init.sql", "0003_exam_management_columns.sql", "0004_attempts_and_grading.sql",
    "0009_learning_mode.sql", "0010_exam_badge_icon.sql", "0011_exam_providers.sql",
    "0014_knowledge_points.sql", "0015_question_authoring.sql",
    "0017_mcp_credentials.sql", "0018_mcp_credential_names.sql", "0019_admin_mcp_audit_log.sql",
    "0020_admin_mcp_create_idempotency.sql", "0021_admin_mcp_audit_log_targets.sql", "0022_question_bank_tags.sql",
    "0023_admin_mcp_import_jobs.sql", "0024_admin_mcp_import_committed_items.sql", "0025_kp_order_scopes.sql",
    "0026_question_tag_links.sql", "0027_drop_questions_tags_json.sql", "0033_question_needs_review.sql", "0034_question_components.sql", "0035_exam_official_format.sql",
  ];
  const schema = (await Promise.all(schemaFiles.map((name) =>
    readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8")))).join("\n");

  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(schema);
  for (const [id, role] of [["alice", "user"], ["admin", "admin"]]) {
    sqlite.prepare("INSERT INTO users (id, email, role, status, created_at) VALUES (?, ?, ?, 'active', ?)")
      .run(id, `${id}@example.test`, role, new Date().toISOString());
  }
  const DB = { prepare(sql) {
    const methodsFor = (args) => ({
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      // Real D1's db.batch() returns populated `.results` for a SELECT the
      // same way `.all()` does — the KP order-scope read batches two SELECTs
      // together (rows + revision), so this fake must too (same technique as
      // mcp-user-knowledge-points.test.mjs's fixture).
      _isSelect: /^\s*select\b/i.test(sql),
    });
    return { bind: (...args) => methodsFor(args), ...methodsFor([]) };
  } };
  DB.batch = async (statements) => {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await (statement._isSelect ? statement.all() : statement.run()));
      sqlite.exec("COMMIT");
      return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  };

  const baseUrl = "https://prepdeck.smoke-e2e.test";
  const env = {
    DB, ENVIRONMENT: "production", APP_BASE_URL: baseUrl, AUTH_MODE: "cookie",
    KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    RATE_LIMITER: { idFromName: (key) => key, get: () => ({ fetch: async () => Response.json({ allowed: true, retryAfter: 60 }) }) },
    BUCKET: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ objects: [], truncated: false }) },
    IMPORT_VALIDATE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    IMPORT_EXECUTE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  const expiresAt = Date.now() + 60_000;
  const alice = await issueMcpCredential(DB, { userId: "alice", audience: "user", name: "smoke", expiresAt });
  const admin = await issueMcpCredential(DB, { userId: "admin", audience: "admin", name: "smoke", expiresAt });

  const fetchImpl = (url, init) => worker.fetch(new Request(url, init), env);

  const healthy = await runSmokeCheck({ baseUrl, userToken: alice.token, adminToken: admin.token, fetchImpl });
  assert.equal(healthy.ok, true, JSON.stringify(healthy.results));
  assert.equal(healthy.results.length, 7);

  // A syntactically valid but wrong/unknown token must fail cleanly, not throw.
  const wrongToken = `pd_mcp_user_${"0".repeat(64)}`;
  const unhealthy = await runSmokeCheck({ baseUrl, userToken: wrongToken, adminToken: admin.token, fetchImpl });
  assert.equal(unhealthy.ok, false);
  assert.equal(unhealthy.results.find((r) => r.name === "User MCP catalog reachable and scoped").detail, "unexpected status 401");
});
