import { Hono } from "hono";
import type { Server } from "@modelcontextprotocol/server";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { consumeRateLimit, configuredLimit } from "../middleware/rateLimit";
import { authenticateMcp, touchMcpCredentialLastUsed, type McpAudience, type McpPrincipal } from "./credentials";
import { createUserMcpServer, userMcpTools } from "./user/server";
import { createAdminMcpServer, adminMcpTools } from "./admin/server";
import { httpError, McpApplicationError } from "./errors";
import { serveMcp } from "./runtime";
import { IMPORT_BODY_MAX_BYTES } from "../lib/importSecurity";
import type { McpObservation } from "./observability";
import type { McpTool, McpToolPolicy } from "./catalog";
import { bearerChallenge, scopePolicy } from "./oauth/config";
import { touchGrantLastUsed } from "./oauth/grants";

// implementation — user_update_knowledge_point/user_create_knowledge_point accept
// a bodyMarkdown up to 200,000 characters (matching REST's own
// MAX_BODY_LENGTH), which a CJK/emoji-heavy note can exceed in raw UTF-8
// bytes alone well past the default 64 KB cap — a note that size could be
// *read* over MCP but never saved back unmodified. Sized with real headroom
// over the realistic worst case (200,000 chars at up to 4 bytes/char in
// UTF-8, plus JSON-RPC envelope overhead), not a tight fit.
export const USER_MCP_BODY_MAX_BYTES = 1_048_576;

interface Catalog {
  tools(principal: McpPrincipal, env: Env): McpTool[];
  serve(tools: readonly McpTool[], observation?: McpObservation, policy?: McpToolPolicy): Server;
}

/**
 * Issue #102 — answers a tools/call for a tool the OAuth grant's scopes do not
 * cover with HTTP 403 and an insufficient_scope challenge (MCP authorization
 * spec, "Scope challenge handling"), before dispatch, so a client can step up
 * by reauthorizing. The catalog server independently refuses it too.
 */
function enforceScopes(body: string, tools: readonly McpTool[], policy: McpToolPolicy) {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return; /* The SDK owns protocol validation. */ }
  for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
    const { method, params } = (message ?? {}) as { method?: unknown; params?: { name?: unknown } };
    if (method !== "tools/call") continue;
    const tool = tools.find((candidate) => candidate.definition.name === params?.name);
    if (tool && !policy.allows(tool.definition)) throw new McpApplicationError("insufficient_scope");
  }
}

// implementation — admin-audience import tools need to accept a full import file
// inline (up to IMPORT_LIMITS.maxQuestions), well past the default 64 KB cap
// that's appropriate for every other (small, single-question) tool call. The
// admin audience is already the more trusted, more tightly rate-limited one
// (see the per-audience consumeRateLimit call below), so widening its body
// cap to match REST's existing import limit doesn't weaken the posture for
// the user MCP endpoint, which keeps the default.
function endpoint(
  audience: McpAudience,
  catalog: Catalog,
  opts?: { maxBodyBytes?: number },
) {
  const router = new Hono<{ Bindings: Env; Variables: Variables }>();
  router.onError((error, c) => httpError(error, (code) => {
    c.get("mcpObservation")?.rejected(code);
    return bearerChallenge(c.env, audience, code, c.req.raw.headers.has("Authorization"));
  }));
  router.all("/", async (c) => {
    const observation = c.get("mcpObservation");
    if (observation) observation.stage = "origin";
    const request = c.req.raw;
    const allowedOrigins = new Set([new URL(c.env.APP_BASE_URL).origin]);
    if (c.env.ENVIRONMENT === "development") {
      allowedOrigins.add("http://localhost:8787");
      allowedOrigins.add("http://127.0.0.1:8787");
    }
    // Validate against trusted configuration, never request-derived Host.
    const origin = request.headers.get("Origin");
    if (!allowedOrigins.has(new URL(request.url).origin) || (origin !== null && !allowedOrigins.has(origin))) {
      throw new McpApplicationError("unauthorized");
    }
    // Credentials are accepted exclusively in Authorization, never in URLs.
    if (new URL(request.url).search) throw new McpApplicationError("invalid_input");
    if (observation) observation.stage = "auth";
    const principal = await authenticateMcp(request, c.env, audience, observation);
    // Best-effort activity tracking for Settings/admin token and connected-app
    // lists; never gates or slows down the actual MCP call on failure.
    await (principal.credentialType === "oauth" ? touchGrantLastUsed(c.env.DB, principal.credentialId)
      : touchMcpCredentialLastUsed(c.env.DB, principal.credentialId)).catch(() => {});
    if (observation) observation.stage = "method";
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
    }
    // Separate audiences and account keys; rotating tokens cannot reset quotas,
    // and the key names the account, not the credential, so PATs and OAuth
    // connections of one account share a single budget (issue #102).
    // implementation — max is deployment-configurable (MCP_ADMIN_RATE_LIMIT_PER_MINUTE
    // / MCP_USER_RATE_LIMIT_PER_MINUTE); defaults match the original fixed values.
    if (observation) observation.stage = "account_limit";
    const max = principal.audience === "admin"
      ? configuredLimit(c.env.MCP_ADMIN_RATE_LIMIT_PER_MINUTE, 30)
      : configuredLimit(c.env.MCP_USER_RATE_LIMIT_PER_MINUTE, 60);
    const limit = await consumeRateLimit(c.env, `mcp:${principal.audience}:user:${principal.userId}`,
      { windowSeconds: 60, max }).catch(() => null);
    if (!limit || !limit.allowed) {
      return Response.json({ ok: false, error: {
        code: limit ? "rate_limited" : "unavailable",
        message: limit ? "Too many MCP requests." : "MCP rate-limit service unavailable.",
      } }, { status: limit ? 429 : 503, headers: {
        "Cache-Control": "no-store", "Retry-After": String(limit ? Math.max(1, Math.ceil(limit.retryAfter)) : 30),
      } });
    }
    if (observation) observation.stage = "protocol";
    const tools = catalog.tools(principal, c.env);
    const policy = principal.scopes ? scopePolicy(audience, principal.scopes) : undefined;
    return serveMcp(request, () => catalog.serve(tools, observation, policy), opts?.maxBodyBytes, observation,
      policy ? (body) => enforceScopes(body, tools, policy) : undefined);
  });
  router.all("*", () => httpError(new McpApplicationError("not_found")));
  return router;
}

export const userMcpRouter = endpoint("user", { tools: userMcpTools, serve: createUserMcpServer }, { maxBodyBytes: USER_MCP_BODY_MAX_BYTES });
export const adminMcpRouter = endpoint("admin", { tools: adminMcpTools, serve: createAdminMcpServer }, { maxBodyBytes: IMPORT_BODY_MAX_BYTES });
