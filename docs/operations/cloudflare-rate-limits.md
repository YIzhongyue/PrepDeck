# Cloudflare edge rate-limit runbook

[Documentation index](../README.md)

The Worker limiter is defense in depth. The enforceable first boundary must be
Cloudflare WAF **Rate limiting rules**, deployed to production and staging. The
numbers below are starting values; alert on matches and tune them from observed
traffic. Use Cloudflare's source IP characteristic (not an HTTP forwarding
header), a 60-second period, and return `429` with `Retry-After` where the plan
supports a custom response.

These are proposed edge scopes, not evidence of installed WAF rules. Verify the
account's supported periods, counting keys and rule slots before applying them.
The Worker implements its own quotas independently in
[rateLimit.ts](../../apps/worker/src/middleware/rateLimit.ts).

Put exact health/auth/AI/draft rules before generic API rules. The table expresses
scope targets; exclude more specific matches from generic rules as needed:

| Priority | Expression / scope | Characteristics | Limit |
| --- | --- | --- | --- |
| 1 | URI path in `/api/auth/google/start`, `/api/auth/google/callback`, `/api/auth/login`, `/api/auth/logout` | source IP | 10/min |
| 2 | URI path equals `/api/ai/generate` | source IP | 20/min |
| 3 | URI path equals `/api/ai/generate` | authenticated internal user ID (a validated edge claim, never a client-provided header) | 20/min |
| 4 | URI path equals `/api/ai/generate` | one global counting key | 200/min |
| 5 | URI matches `/api/attempts/:id/answers/:questionId` or `/api/attempts/:id/flags/:questionId`, method is PUT | source IP and validated internal user ID | 600/min each |
| 6 | URI starts `/api/`, method is not GET/HEAD (and doesn't match rule 5) | source IP and validated internal user ID | 60/min each |
| 7 | URI starts `/api/`, method is GET/HEAD | source IP | 300/min |
| 8 | URI equals `/api/health` | source IP, 120/min; preferably an IP allow-list for monitoring egress | 120/min |

If the Cloudflare plan cannot key a rule by the application's internal user ID
or a global constant, keep the IP rule at the edge and rely on the Durable
Object for those two atomic counters. Do **not** copy a user ID into a
client-settable header to work around the limitation.

## Shared limiter and failure policy

`RATE_LIMITER` is a Durable Object binding. Each key maps to one object and its
transactional counter, so concurrent requests and requests reaching different
Worker isolates share one authoritative quota. IPv4 addresses use the complete
Cloudflare-provided address; IPv6 addresses are grouped by `/64`.

Storage failure is intentionally **fail-closed** (503, `Retry-After: 30`) for
authentication, AI, and all mutations. Ordinary reads and health checks degrade
to a per-isolate availability brake. That Map is explicitly non-authoritative
and is never a security or cost-control boundary.

## Global circuit breaker

`CIRCUIT_MODE` (`normal` | `degraded` | `emergency`) is the first middleware
and runs before auth, rate limiting, D1, R2, KV, or application logging.
Health checks remain available in every mode. See
[Cost containment](./cloudflare-cost-containment.md) for
the full incident runbook, including the reviewed deployment automation and
the `EMERGENCY_ADMIN_IPS` defence-in-depth allowlist.


## MCP and import budgets

MCP paths `/mcp` and `/admin-mcp` are outside `/api/*`; include them in edge rules
explicitly. All MCP calls are POST, so the shared Worker IP layer classifies them
as writes (60/min). After bearer authentication, per-account quotas default to
60/min User and 30/min Admin. User Knowledge Point writes default to 30/min;
Admin content mutations have a stricter 10/min quota. The four corresponding
`MCP_*_RATE_LIMIT_PER_MINUTE` variables configure those budgets in Wrangler;
rotation does not reset an account's quota. Missing/unreachable mutation/account
limiters fail closed. See [MCP limits](../architecture/mcp.md#request-safety-and-limits-hardened-in-issue-66).

REST and Admin MCP import validation/execution use native bindings scoped to
user + exam: `IMPORT_VALIDATE_RATE_LIMITER` (20/min) and
`IMPORT_EXECUTE_RATE_LIMITER` (5/min). These are distinct from the Admin content
mutation quota. Native import limit failures do not supply a retry duration;
do not promise `retryAfter` on every error. Pre-dispatch MCP rejects with HTTP
429/503; operation-level failures use HTTP 200 with `isError` and structured
`rate_limited`/`unavailable`, preserving a provided `retryAfter`.

Degraded mode blocks every MCP POST, including read tools. Emergency allows only
the documented health/storage-free recovery routes or exact allowed admin sources;
allowed sources still authenticate. Cron jobs are outside this HTTP circuit.
