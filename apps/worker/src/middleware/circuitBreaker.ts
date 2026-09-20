import type { MiddlewareHandler } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";
// Explicit extension: this module is imported directly by Node's native TS
// runtime in scripts/circuit-breaker.test.mjs (no bundler resolving bare
// specifiers there), unlike every other relative import in src/.
import { isMcpPath, mcpThrottleResponse } from "./rateLimit.ts";

export type CircuitMode = "normal" | "degraded" | "emergency";

// Touch no storage (no D1/KV/R2), so anyone may reach them even in emergency
// mode: starting an OAuth redirect and clearing a session cookie are both
// pure, storage-free operations. Deliberately excluded: /api/auth/login and
// /api/auth/google/callback both do real, unauthenticated D1/KV work (a user
// lookup or an OAuth token exchange + session creation) — exactly the cost
// emergency mode exists to shed — so those two stay behind the
// EMERGENCY_ADMIN_IPS check below rather than being open to anyone.
const NO_STORAGE_RECOVERY_PATHS = new Set([
  "/api/auth/google/start",
  "/api/auth/logout",
]);

const DEGRADED_BLOCKED_PREFIXES = [
  "/api/ai/",
];

function configuredMode(value: string | undefined): CircuitMode {
  if (!value || value === "normal") return "normal";
  if (value === "degraded") return value;
  // A typo must fail closed rather than silently disabling containment.
  return "emergency";
}

// implementation — MCP callers get the same { ok, error: { code, message } }
// shape every other MCP rejection (IP gate, account quota, tool errors)
// uses, instead of the REST/browser-facing { error: "..." } shape. The
// X-PrepDeck-Circuit diagnostic header is kept in both cases.
function response(mode: CircuitMode, path: string): Response {
  if (isMcpPath(path)) {
    const throttled = mcpThrottleResponse("unavailable", "MCP is temporarily restricted.", 503, 300);
    throttled.headers.set("X-PrepDeck-Circuit", mode);
    return throttled;
  }
  return Response.json(
    { error: "Service temporarily restricted", mode },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300", "X-PrepDeck-Circuit": mode } },
  );
}

function exactAdminSource(request: Request, configured: string | undefined): boolean {
  const source = request.headers.get("CF-Connecting-IP")?.trim();
  if (!source || !configured) return false;
  return configured.split(",").some((candidate) => candidate.trim() === source);
}

/**
 * Global, storage-free cost circuit. Keep this as the first security gate:
 * only the bounded MCP metrics observer may precede it; rejected requests
 * must not authenticate or touch D1, KV, or R2.
 */
export const circuitBreaker: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const mode = configuredMode(c.env.CIRCUIT_MODE);
  if (mode === "normal") return next();

  const path = c.req.path;

  if (mode === "emergency") {
    if (path === "/api/health" && (c.req.method === "GET" || c.req.method === "HEAD")) {
      return c.json({ status: "restricted", mode }, 200, { "Cache-Control": "no-store", "X-PrepDeck-Circuit": mode });
    }
    if (NO_STORAGE_RECOVERY_PATHS.has(path) || exactAdminSource(c.req.raw, c.env.EMERGENCY_ADMIN_IPS)) return next();
    return response(mode, path);
  }

  const safeMethod = c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS";
  const blockedFeature = DEGRADED_BLOCKED_PREFIXES.some((prefix) => path.startsWith(prefix))
    || path.includes("/ai-explanations")
    || path.includes("/import");
  if (!safeMethod || blockedFeature) return response(mode, path);
  return next();
};
