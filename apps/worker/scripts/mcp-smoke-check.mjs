#!/usr/bin/env node
// implementation — a small, authenticated, non-mutating post-deployment smoke
// check for the User/Admin MCP endpoints. Not a dedicated MCP health
// endpoint (deliberately out of scope — see docs/architecture/mcp.md's
// "Request safety and limits"): this runs against a real deployment as a
// script instead, so it never advertises privileged tool details to an
// unauthenticated caller. Run after any deploy that touches MCP:
//
//   node apps/worker/scripts/mcp-smoke-check.mjs
//
// Prefer the process environment variables below, injected by the trusted
// operator/CI secret store, rather than expanding tokens into CLI arguments.
//
// Flags may also be supplied via PREPDECK_MCP_BASE_URL,
// PREPDECK_USER_MCP_TOKEN, PREPDECK_ADMIN_MCP_TOKEN. Never prints either
// token or any other network/response-derived text — every diagnostic
// below is a fixed category or a value from this script's own constants,
// never an echoed exception message, header, or response body (Node's
// Fetch/Headers validation errors can embed the offending header value,
// Authorization included, verbatim — see classifyError()). Performs no
// mutation, and is safe to run repeatedly in production with the same
// long-lived, narrowly-purposed pair of tokens. Exits non-zero (printing
// which check failed) on any unexpected status, catalog shape, or
// audience leak. See scripts/mcp-smoke-check.test.mjs for automated
// stdout/stderr assertions covering the malformed-credential and
// old-deployment-catalog cases this script exists to catch.
import { pathToFileURL } from "node:url";

export const USER_TOKEN_PATTERN = /^pd_mcp_user_[a-f0-9]{64}$/;
export const ADMIN_TOKEN_PATTERN = /^pd_mcp_admin_[a-f0-9]{64}$/;

// A representative baseline spanning every catalog generation
// (implementation identity; implementation learning; implementation Knowledge Points for User — implementation
// identity; implementation reads; implementation mutations; implementation exam/import/tag for Admin) —
// deliberately not the full ~40-tool catalog, so this script doesn't need
// updating for every future tool, but enough that a deployment stuck on an
// old, narrower catalog (e.g. the implementation foundation with only *_get_identity)
// fails loudly instead of passing every check.
export const REQUIRED_USER_TOOLS = [
  "user_get_identity", "user_get_learning_overview", "user_search_questions",
  "user_list_knowledge_points", "user_create_knowledge_point",
];
export const REQUIRED_ADMIN_TOOLS = [
  "admin_get_identity", "admin_search_questions", "admin_create_question",
  "admin_create_exam", "admin_execute_import", "admin_create_tag",
];

export function parseArgs(argv, env = process.env) {
  const args = { baseUrl: env.PREPDECK_MCP_BASE_URL, userToken: env.PREPDECK_USER_MCP_TOKEN, adminToken: env.PREPDECK_ADMIN_MCP_TOKEN };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[++i];
    if (flag === "--base-url") args.baseUrl = value;
    else if (flag === "--user-token") args.userToken = value;
    else if (flag === "--admin-token") args.adminToken = value;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!args.baseUrl) throw new Error("Missing --base-url (or PREPDECK_MCP_BASE_URL)");
  if (!args.userToken) throw new Error("Missing --user-token (or PREPDECK_USER_MCP_TOKEN)");
  if (!args.adminToken) throw new Error("Missing --admin-token (or PREPDECK_ADMIN_MCP_TOKEN)");
  return args;
}

// Validated once, up front, before any network call — so a malformed token
// (wrong audience prefix, wrong length, or containing characters that would
// later throw a Fetch/Headers "invalid header value" error embedding the
// value itself) is rejected by a fixed message instead of ever reaching
// fetch(). This is the primary defense; classifyError() below is a second,
// defense-in-depth layer for any other exception shape.
function assertTokenFormat(label, token, pattern, expectedShape) {
  if (typeof token !== "string" || !pattern.test(token)) {
    throw new Error(`${label} does not match the expected ${expectedShape} format`);
  }
}

// Never echoes error.message or error.cause: both can carry a raw header
// value (e.g. "Headers.append: \"Bearer <token>\" is an invalid header
// value") or other request-derived text. Only fixed, bounded categories.
function classifyError(error) {
  if (error?.name === "TypeError" && /header/i.test(String(error?.message))) {
    return "malformed request (invalid header value) — check token format";
  }
  if (typeof error?.cause?.code === "string") return `network error (${error.cause.code})`;
  return "request failed (unexpected error)";
}

async function mcpRequest(fetchImpl, baseUrl, path, token, method, params) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  let body = null;
  try {
    body = response.headers.get("Content-Type")?.includes("text/event-stream")
      ? JSON.parse(text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) ?? "null")
      : JSON.parse(text);
  } catch { /* body stays null; callers check response.status first */ }
  return { status: response.status, body };
}

// Every check below either returns { ok, detail } with a fixed/bounded
// detail string, or throws — network/protocol exceptions are caught once,
// centrally, in runSmokeCheck()'s loop and passed through classifyError().

async function checkCatalog(fetchImpl, baseUrl, path, token, expectedPrefix, requiredTools) {
  const { status, body } = await mcpRequest(fetchImpl, baseUrl, path, token, "tools/list", {});
  if (status !== 200) return { ok: false, detail: `unexpected status ${status}` };
  const tools = body?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) return { ok: false, detail: "catalog is empty or malformed" };
  const names = new Set(tools.map((tool) => (typeof tool?.name === "string" ? tool.name : null)).filter(Boolean));
  if ([...names].some((name) => !name.startsWith(expectedPrefix))) {
    return { ok: false, detail: `catalog contains a tool outside the "${expectedPrefix}" namespace` };
  }
  // Names logged below always come from this script's own REQUIRED_* list,
  // never from the response, even though we're reporting on the response.
  const missing = requiredTools.filter((name) => !names.has(name));
  if (missing.length > 0) return { ok: false, detail: `deployment is missing required tool(s): ${missing.join(", ")}` };
  return { ok: true, detail: `${tools.length} tools, all "${expectedPrefix}*", required baseline present` };
}

async function checkCrossAudienceRejected(fetchImpl, baseUrl, path, token) {
  const { status } = await mcpRequest(fetchImpl, baseUrl, path, token, "tools/list", {});
  if (status !== 401) return { ok: false, detail: `expected 401 (wrong-audience credential), got ${status}` };
  return { ok: true, detail: "401 as expected" };
}

async function checkIdentityRoundTrip(fetchImpl, baseUrl, path, token, toolName, expectedServer) {
  const { status, body } = await mcpRequest(fetchImpl, baseUrl, path, token, "tools/call", { name: toolName, arguments: {} });
  if (status !== 200) return { ok: false, detail: `unexpected status ${status}` };
  const result = body?.result;
  if (result?.isError) return { ok: false, detail: "tool call returned isError" };
  const data = result?.structuredContent;
  if (!data?.ok) return { ok: false, detail: "unexpected result envelope" };
  if (data.data?.server !== expectedServer) return { ok: false, detail: "unexpected server field in identity response" };
  return { ok: true, detail: `server="${expectedServer}"` };
}

// A representative non-mutating, database-backed business read: unlike the
// identity tools (which touch no table beyond credentials), listing
// Knowledge Points scoped to exactly one view (`ungrouped: true`) reads
// knowledge_point_order_scopes (migrations/0025_kp_order_scopes.sql) and
// returns `orderRevision` — catching a missing/failed migration or a
// broken business-schema deployment that an identity-only check cannot.
async function checkKnowledgePointOrderScopeRead(fetchImpl, baseUrl, token) {
  const { status, body } = await mcpRequest(fetchImpl, baseUrl, "/mcp", token, "tools/call", {
    name: "user_list_knowledge_points", arguments: { ungrouped: true, limit: 1 },
  });
  if (status !== 200) return { ok: false, detail: `unexpected status ${status}` };
  const result = body?.result;
  if (result?.isError) return { ok: false, detail: "tool call returned isError" };
  const data = result?.structuredContent;
  if (!data?.ok || !Array.isArray(data.data?.items) || typeof data.data?.orderRevision !== "number") {
    return { ok: false, detail: "unexpected result shape (business schema/migration 0025 may be missing)" };
  }
  return { ok: true, detail: "Knowledge Point order-scope read succeeded" };
}

/**
 * Runs every smoke check and returns { ok, results } without touching
 * console or process — safe to call repeatedly from a test with a fake
 * fetchImpl. Throws only a fixed, token-value-free message if either token
 * fails format validation (before any network call).
 */
export async function runSmokeCheck({ baseUrl, userToken, adminToken, fetchImpl = fetch }) {
  assertTokenFormat("User token", userToken, USER_TOKEN_PATTERN, "pd_mcp_user_<64 hex characters>");
  assertTokenFormat("Admin token", adminToken, ADMIN_TOKEN_PATTERN, "pd_mcp_admin_<64 hex characters>");

  const checks = [
    ["User MCP catalog reachable and scoped", () => checkCatalog(fetchImpl, baseUrl, "/mcp", userToken, "user_", REQUIRED_USER_TOOLS)],
    ["Admin MCP catalog reachable and scoped", () => checkCatalog(fetchImpl, baseUrl, "/admin-mcp", adminToken, "admin_", REQUIRED_ADMIN_TOOLS)],
    ["User token rejected on Admin MCP", () => checkCrossAudienceRejected(fetchImpl, baseUrl, "/admin-mcp", userToken)],
    ["Admin token rejected on User MCP", () => checkCrossAudienceRejected(fetchImpl, baseUrl, "/mcp", adminToken)],
    ["User MCP identity tool round-trips", () => checkIdentityRoundTrip(fetchImpl, baseUrl, "/mcp", userToken, "user_get_identity", "user")],
    ["Admin MCP identity tool round-trips", () => checkIdentityRoundTrip(fetchImpl, baseUrl, "/admin-mcp", adminToken, "admin_get_identity", "admin")],
    ["User MCP Knowledge Point order-scope read succeeds", () => checkKnowledgePointOrderScopeRead(fetchImpl, baseUrl, userToken)],
  ];

  const results = [];
  for (const [name, run] of checks) {
    let result;
    try {
      result = await run();
    } catch (error) {
      result = { ok: false, detail: classifyError(error) };
    }
    results.push({ name, ok: result.ok, detail: result.detail });
  }
  return { ok: results.every((r) => r.ok), results };
}

async function cli() {
  const args = parseArgs(process.argv.slice(2));
  const outcome = await runSmokeCheck(args);
  for (const r of outcome.results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} — ${r.detail}`);
  if (outcome.ok) {
    console.log(`\nAll ${outcome.results.length} checks passed.`);
  } else {
    const failed = outcome.results.filter((r) => !r.ok).length;
    console.error(`\n${failed}/${outcome.results.length} checks failed.`);
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  cli().catch((error) => {
    // Only ever reaches here for parseArgs()/assertTokenFormat()'s own
    // fixed messages — both throw before any network call, and every
    // exception from an actual request is already caught and categorized
    // inside runSmokeCheck()'s loop above.
    console.error(error.message);
    process.exitCode = 1;
  });
}
