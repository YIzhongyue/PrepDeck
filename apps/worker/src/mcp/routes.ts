import { Hono } from "hono";
import type { Server } from "@modelcontextprotocol/server";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { consumeRateLimit, configuredLimit } from "../middleware/rateLimit";
import { authenticateUserMcp, authenticateAdminMcp, touchMcpCredentialLastUsed, type McpPrincipal } from "./credentials";
import { createUserMcpServer } from "./user/server";
import { createAdminMcpServer } from "./admin/server";
import { httpError, McpApplicationError } from "./errors";
import { serveMcp } from "./runtime";
import { IMPORT_BODY_MAX_BYTES } from "../lib/importSecurity";
import type { McpObservation } from "./observability";

// implementation — user_update_knowledge_point/user_create_knowledge_point accept
// a bodyMarkdown up to 200,000 characters (matching REST's own
// MAX_BODY_LENGTH), which a CJK/emoji-heavy note can exceed in raw UTF-8
// bytes alone well past the default 64 KB cap — a note that size could be
// *read* over MCP but never saved back unmodified. Sized with real headroom
// over the realistic worst case (200,000 chars at up to 4 bytes/char in
// UTF-8, plus JSON-RPC envelope overhead), not a tight fit.
export const USER_MCP_BODY_MAX_BYTES = 1_048_576;

type Authenticate = typeof authenticateUserMcp;

// implementation — admin-audience import tools need to accept a full import file
// inline (up to IMPORT_LIMITS.maxQuestions), well past the default 64 KB cap
// that's appropriate for every other (small, single-question) tool call. The
// admin audience is already the more trusted, more tightly rate-limited one
// (see the per-audience consumeRateLimit call below), so widening its body
// cap to match REST's existing import limit doesn't weaken the posture for
// the user MCP endpoint, which keeps the default.
function endpoint(
  authenticate: Authenticate,
  createServer: (principal: McpPrincipal, env: Env, observation?: McpObservation) => Server,
  opts?: { maxBodyBytes?: number },
) {
  const router = new Hono<{ Bindings: Env; Variables: Variables }>();
  router.onError((error) => httpError(error));
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
    const principal = await authenticate(request, c.env.DB, observation);
    // Best-effort activity tracking for Settings/admin token lists; never
    // gates or slows down the actual MCP call on failure.
    await touchMcpCredentialLastUsed(c.env.DB, principal.credentialId).catch(() => {});
    if (observation) observation.stage = "method";
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
    }
    // Separate audiences and account keys; rotating tokens cannot reset quotas.
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
    return serveMcp(request, () => createServer(principal, c.env, observation), opts?.maxBodyBytes, observation);
  });
  router.all("*", () => httpError(new McpApplicationError("not_found")));
  return router;
}

export const userMcpRouter = endpoint(authenticateUserMcp, createUserMcpServer, { maxBodyBytes: USER_MCP_BODY_MAX_BYTES });
export const adminMcpRouter = endpoint(authenticateAdminMcp, createAdminMcpServer, { maxBodyBytes: IMPORT_BODY_MAX_BYTES });
