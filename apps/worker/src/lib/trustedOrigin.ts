import type { Env } from "../bindings";

type OriginConfig = Pick<Env, "APP_BASE_URL" | "ENVIRONMENT">;

/** A deployment-owned origin. Never derive this authority from request headers. */
export function configuredApplicationOrigin(env: Partial<OriginConfig>): string | null {
  if (typeof env.APP_BASE_URL !== "string") return null;
  let url: URL;
  try { url = new URL(env.APP_BASE_URL); } catch { return null; }
  // Accept the origin with an optional trailing slash, not URL credentials,
  // paths, query strings or parser-normalized alternatives.
  if (env.APP_BASE_URL !== url.origin && env.APP_BASE_URL !== `${url.origin}/`) return null;
  if (url.protocol === "https:") return url.origin;
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (env.ENVIRONMENT === "development" && url.protocol === "http:" && loopback) return url.origin;
  return null;
}
