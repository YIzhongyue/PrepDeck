// Cloudflare Workers bindings, matching apps/worker/wrangler.toml.

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  KV: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  // Privacy-safe MCP counters, separate from Workers Logs head sampling.
  // Optional for older deployments; telemetry never gates authentication/tools.
  MCP_METRICS?: AnalyticsEngineDataset;
  MCP_METRICS_ENABLED?: "true" | "false";
  // implementation — Cloudflare Email Sending binding for the daily review email.
  // Type comes from the generated worker-configuration.d.ts (`wrangler
  // types`), not @cloudflare/workers-types (which predates this binding) —
  // rerun `wrangler types` after changing the [[send_email]] block.
  EMAIL: SendEmail;
  // Cloudflare's native, distributed Rate Limiting bindings. These protect
  // costly Admin imports across Worker isolates and regions.
  IMPORT_VALIDATE_RATE_LIMITER: RateLimit;
  IMPORT_EXECUTE_RATE_LIMITER: RateLimit;
  // Cloudflare Access — kept only as an opt-in rollback path (AUTH_MODE =
  // "access"). docs/requirements/authentication-and-users.md's primary login path is direct Google OAuth below.
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  // "cookie": our own signed session cookie (apps/worker/src/lib/session.ts),
  // established either by direct Google OAuth (routes/auth.ts /google/*,
  // docs/requirements/authentication-and-users.md) or, for local dev only, email+password login. This is the
  // production default. "access": require a verified Cf-Access-Jwt-Assertion
  // header instead (Cloudflare Access in front of the app) — a rollback path,
  // not otherwise used.
  AUTH_MODE: "cookie" | "access";
  // Deployment identity is an explicit binding: authentication decisions must
  // never infer it from request-controlled URL, Host, or forwarding headers.
  ENVIRONMENT: "development" | "production";
  // String-valued because Wrangler vars are delivered as strings. Password
  // login requires this to be exactly "true" in addition to ENVIRONMENT being
  // "development"; missing/unknown values fail closed.
  ENABLE_DEV_PASSWORD_LOGIN: "true" | "false";
  // HMAC key for signing the session cookie. Set via
  // `wrangler secret put SESSION_SECRET` (remote) or `.dev.vars` (local) —
  // never committed.
  SESSION_SECRET: string;
  // Google OAuth 2.0 Web client (docs/requirements/authentication-and-users.md). The client ID is not secret
  // (it's visible in the browser-facing auth URL) and lives in wrangler.toml
  // [vars]; the client secret is a real secret — `wrangler secret put
  // GOOGLE_CLIENT_SECRET` (remote) or `.dev.vars` (local).
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // Cost-containment circuit breaker. This is deliberately a plain Worker
  // variable so it can be changed by deploying a known configuration without
  // reading D1, KV, or R2 on the request path.
  CIRCUIT_MODE?: "normal" | "degraded" | "emergency";
  // Comma-separated source IPs/CIDRs are enforced at the Cloudflare WAF. The
  // Worker repeats exact-IP checks here as defence in depth in emergency mode.
  EMERGENCY_ADMIN_IPS?: string;
  // implementation — MCP per-account request quotas (requests per 60s window),
  // deployment-configurable without a code change. String-valued like every
  // other Wrangler var; missing/non-numeric values fall back to the defaults
  // in src/mcp/routes.ts and src/mcp/adapter.ts (see configuredLimit()).
  MCP_USER_RATE_LIMIT_PER_MINUTE?: string;
  MCP_ADMIN_RATE_LIMIT_PER_MINUTE?: string;
  MCP_KP_WRITE_RATE_LIMIT_PER_MINUTE?: string;
  // implementation — a separate, stricter budget for Admin MCP content mutations
  // (create/update/delete/batch question tools, exam lifecycle, tag tools),
  // on top of the blanket MCP_ADMIN_RATE_LIMIT_PER_MINUTE account quota that
  // also covers reads. Imports have their own native rate limiters instead
  // (IMPORT_VALIDATE_RATE_LIMITER/IMPORT_EXECUTE_RATE_LIMITER above).
  MCP_ADMIN_MUTATION_RATE_LIMIT_PER_MINUTE?: string;
  // implementation — daily review email. The scheduled job that sends these runs
  // outside any request context, so absolute links (CTA, unsubscribe, logo)
  // can't be derived from a request origin the way routes/auth.ts derives
  // its OAuth redirect URI; this is the explicit source of truth instead.
  APP_BASE_URL: string;
  // Must be an address on a domain onboarded via
  // `wrangler email sending enable <domain>`, or sends fail with
  // E_SENDER_NOT_VERIFIED.
  EMAIL_FROM_ADDRESS: string;
}
