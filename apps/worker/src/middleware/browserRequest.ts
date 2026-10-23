import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";
import { configuredApplicationOrigin } from "../lib/trustedOrigin";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Browser sessions need an origin boundary: SameSite allows sibling origins. */
export const requireTrustedBrowserOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const expected = configuredApplicationOrigin(c.env);
  if (!expected) {
    return c.json({ error: "Application origin is not configured" }, 503);
  }

  const origin = c.req.header("Origin");
  // A present Origin (including opaque "null") is authoritative. Never let
  // a forged/mismatched Origin fall back to a more permissive Referer.
  let source = origin;
  if (origin === undefined) {
    try { source = new URL(c.req.header("Referer") ?? "").origin; } catch { source = undefined; }
  }
  // The opt-in local workflow serves Vite and the built Worker UI on separate
  // ports. Its explicit preview origin is never trusted in production or when
  // APP_BASE_URL is not itself an HTTP loopback development origin.
  const isLocalHttp = (origin: string) => {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  };
  const preview = c.env.ENVIRONMENT === "development" && c.env.ENABLE_DEV_PASSWORD_LOGIN === "true"
    ? configuredApplicationOrigin({ ...c.env, APP_BASE_URL: c.env.DEV_WORKER_ORIGIN ?? "" }) : null;
  const trustedPreview = preview !== null && isLocalHttp(expected) && isLocalHttp(preview) && source === preview;
  if (source !== expected && !trustedPreview) return c.json({ error: "Forbidden request origin" }, 403);
  return next();
};

// These are the only protected REST routes accepting a non-JSON body. Each
// independently validates its accepted image media types and upload limits.
const IMAGE_UPLOAD = /^\/api\/(?:me\/avatar|kp-images\/[^/]+|exams\/[^/]+\/badge|providers\/[^/]+\/icon)\/?$/;

/** Keep browser JSON mutations out of the CORS-safelisted media types. */
export const requireJsonMutationBody: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method) || c.req.raw.body === null) return next();
  if (c.req.method === "POST" && IMAGE_UPLOAD.test(c.req.path)) return next();
  const mediaType = (c.req.header("Content-Type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (mediaType !== "application/json") {
    // HTTP runtimes can expose an empty stream for a bodyless mutation. Check
    // actual bytes, not Content-Length (which is not authoritative). Peek only
    // until the first nonempty chunk; never buffer an entire rejected upload.
    const reader = c.req.raw.clone().body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.byteLength > 0) {
          return c.json({ error: "Content-Type must be application/json" }, 415);
        }
      }
    } finally {
      // A tee branch's cancellation may wait for the original body; do not
      // await it here, as downstream handlers have not consumed that body yet.
      void reader.cancel().catch(() => undefined);
    }
  }
  return next();
};
