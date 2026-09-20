import type { MiddlewareHandler } from "hono";
import type { Env } from "../bindings";
import type { Variables } from "../context";

export type RateLimitClass = "auth" | "ai" | "write" | "read" | "health" | "draft";

interface Limit { windowSeconds: number; max: number }

const LIMITS: Record<RateLimitClass, Limit> = {
  auth: { windowSeconds: 60, max: 10 },
  ai: { windowSeconds: 60, max: 20 },
  write: { windowSeconds: 60, max: 60 },
  read: { windowSeconds: 60, max: 300 },
  health: { windowSeconds: 60, max: 120 },
  // Mock-exam autosave (draft answers/flags): single-row UPDATEs fired on
  // every option click with no client-side debounce. These are far cheaper
  // than a generic write and need enough headroom that a fast test-taker
  // clicking through a whole exam in under a minute never gets silently
  // dropped (a dropped draft save is scored as unanswered at /complete).
  draft: { windowSeconds: 60, max: 600 },
};

// PUT /api/attempts/:id/answers/:questionId and PUT /api/attempts/:id/flags/:questionId
const DRAFT_SAVE_PATH = /^\/api\/attempts\/[^/]+\/(answers|flags)\/[^/]+$/;
// PUT /api/knowledge-points/:id — debounced (~1s) content autosave. Given the
// same headroom as attempt drafts so the client's retry/backoff path and any
// fast typers never get silently rate-limited.
const KP_AUTOSAVE_PATH = /^\/api\/knowledge-points\/[^/]+$/;

// This cache is only a degraded-mode brake for low-risk reads/health checks.
// Security-sensitive quotas fail closed and never rely on isolate-local state.
const degradedHits = new Map<string, { reset: number; count: number }>();

export function classifyRequest(method: string, path: string): RateLimitClass {
  if (path === "/api/health") return "health";
  if (
    ["/api/auth/google/start", "/api/auth/google/callback", "/api/auth/login", "/api/auth/logout"].includes(path)
  ) {
    return "auth";
  }
  // implementation — public, unauthenticated endpoint hit from an email link.
  if (path === "/api/email/unsubscribe") return "auth";
  if (path === "/api/ai/generate") return "ai";
  if (method === "PUT" && (DRAFT_SAVE_PATH.test(path) || KP_AUTOSAVE_PATH.test(path))) return "draft";
  return method === "GET" || method === "HEAD" ? "read" : "write";
}

// Cloudflare overwrites CF-Connecting-IP at its edge. Forwarded/X-Real-IP are
// intentionally ignored. Grouping IPv6 by /64 prevents trivial privacy-address
// rotation while retaining a useful client/network boundary.
export function trustedClientKey(headers: Headers): string {
  const address = headers.get("CF-Connecting-IP")?.trim();
  if (!address) return "unknown";
  if (!address.includes(":")) return /^\d{1,3}(\.\d{1,3}){3}$/.test(address) ? `v4:${address}` : "unknown";
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return "unknown";
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return "unknown";
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  if (groups.length !== 8) return "unknown";
  return `v6:${groups.slice(0, 4).map((part) => part.padStart(4, "0")).join(":")}/64`;
}

// Wrangler vars are always delivered as strings (or absent locally unless
// set in .dev.vars). Used to make specific quotas deployment-configurable
// without a redeploy of code, while keeping a safe fallback when unset.
export function configuredLimit(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function consumeRateLimit(env: Env, key: string, limit: Limit): Promise<{ allowed: boolean; retryAfter: number }> {
  const id = env.RATE_LIMITER.idFromName(key);
  const response = await env.RATE_LIMITER.get(id).fetch("https://rate-limiter/consume", {
    method: "POST",
    body: JSON.stringify(limit),
  });
  if (!response.ok) throw new Error(`rate limiter returned ${response.status}`);
  return response.json();
}

// implementation — /mcp and /admin-mcp sit behind three throttling gates in
// order: this module's circuit breaker + IP limiter (mounted first, ahead
// of authentication), then the per-account quota in mcp/routes.ts. Only the
// last one used to return the { ok, error: { code, message } } shape MCP
// clients get from every tool-level error; the first two returned the
// REST/browser-facing { error: "..." } shape instead. An MCP client
// shouldn't have to parse two different rejection shapes depending on which
// gate rejected it, so both gates use this helper for MCP paths while REST
// callers keep their existing shape unchanged.
export function isMcpPath(path: string): boolean {
  return path === "/mcp" || path.startsWith("/mcp/") || path === "/admin-mcp" || path.startsWith("/admin-mcp/");
}

export function mcpThrottleResponse(code: string, message: string, status: number, retryAfterSeconds: number): Response {
  return Response.json({ ok: false, error: { code, message } }, {
    status,
    headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}

function rejected(c: Parameters<MiddlewareHandler>[0], retryAfter: number) {
  if (isMcpPath(c.req.path)) return mcpThrottleResponse("rate_limited", "Too many requests for this endpoint.", 429, retryAfter);
  c.header("Retry-After", String(Math.max(1, Math.ceil(retryAfter))));
  return c.json({ error: "Too many requests — please try again later." }, 429);
}

function degradedConsume(key: string, limit: Limit): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const current = degradedHits.get(key);
  const entry = !current || current.reset <= now ? { reset: now + limit.windowSeconds * 1000, count: 0 } : current;
  entry.count += 1;
  degradedHits.set(key, entry);
  return { allowed: entry.count <= limit.max, retryAfter: (entry.reset - now) / 1000 };
}

/** First line inside the Worker. Cloudflare WAF/Rate Limiting remains line one at the edge. */
export const generalRateLimit: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const observation = c.get("mcpObservation");
  if (observation) observation.stage = "ip_limit";
  const kind = classifyRequest(c.req.method, c.req.path);
  const limit = LIMITS[kind];
  const ip = trustedClientKey(c.req.raw.headers);
  const keys: Array<[string, Limit]> = [[`${kind}:ip:${ip}`, limit]];
  if (kind === "ai") keys.push(["ai:global", { windowSeconds: 60, max: 200 }]);

  try {
    for (const [key, keyLimit] of keys) {
      const result = await consumeRateLimit(c.env, key, keyLimit);
      if (!result.allowed) return rejected(c, result.retryAfter);
    }
  } catch {
    // Authentication, AI, and mutations fail closed when shared atomic state
    // is unavailable. Reads and health checks retain availability with a
    // deliberately non-authoritative, per-isolate degraded limiter.
    if (kind === "auth" || kind === "ai" || kind === "write" || kind === "draft") {
      if (isMcpPath(c.req.path)) return mcpThrottleResponse("unavailable", "Rate-limit service unavailable.", 503, 30);
      c.header("Retry-After", "30");
      return c.json({ error: "Rate-limit service unavailable" }, 503);
    }
    const result = degradedConsume(`${kind}:ip:${ip}`, limit);
    if (!result.allowed) return rejected(c, result.retryAfter);
  }
  if (observation) observation.stage = "routing";
  await next();
};

/** Run after authentication so the key contains the server-resolved user id. */
export const authenticatedRateLimit: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const kind = classifyRequest(c.req.method, c.req.path);
  if (kind !== "ai" && kind !== "write" && kind !== "draft") return next();
  const result = await consumeRateLimit(c.env, `${kind}:user:${c.get("user").id}`, LIMITS[kind]).catch(() => null);
  if (!result) {
    c.header("Retry-After", "30");
    return c.json({ error: "Rate-limit service unavailable" }, 503);
  }
  if (!result.allowed) return rejected(c, result.retryAfter);
  await next();
};
