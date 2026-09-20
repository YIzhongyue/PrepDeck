# MCP metrics and operational checks

[Documentation index](../README.md) · [MCP architecture](../architecture/mcp.md)

implementation records privacy-safe, structured request and tool metrics in Cloudflare
Analytics Engine. The implementation and bindings are checked in; production
availability still requires deployment and the verification below. This is a
separate channel from the 5% Workers Logs head sample. No per-request console
logging, D1 counter writes, extra credential lookups or new public endpoints are
introduced. The existing `admin_mcp_audit_log` remains the durable mutation audit.

## Configuration and schema

`MCP_METRICS` binds to `prepdeck_mcp_metrics` in production and
`prepdeck_mcp_metrics_development` in the development environment.
`MCP_METRICS_ENABLED` must be exactly `"true"`; missing/other values disable
collection. Both checked-in environments enable it. Local Wrangler simulates the
binding; it does not send metric points to the production dataset. A separately
deployed development environment uses its own dataset. Other development binding
limitations still apply; see the [development guide](../guides/development-and-deployment.md#local-limitations).

The `mcp.v1` positional schema is defined in
[`observability.ts`](../../apps/worker/src/mcp/observability.ts). Change its version
if field order or meaning changes. `index1` is `user` or `admin` (never an identity).

| Analytics Engine column | Meaning |
| --- | --- |
| `blob1` | Schema: `mcp.v1`. |
| `blob2` | Event: `request` or `tool`. |
| `blob3` | Audience: `user` or `admin`. |
| `blob4` | Requested method: `initialize`, `server/discover`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `unknown`, or `not_dispatched`. |
| `blob5` | Matched, code-owned tool name; `unknown` for a rejected tool lookup; `none` on request points. |
| `blob6` | Outcome: `success`, `error`, `partial`, `failed`, `skipped`, or `replayed`. |
| `blob7` | Fixed MCP error code, `method_not_allowed`, or `none`. |
| `blob8` | Auth: `not_attempted`, `success`, `missing`, `malformed`, `wrong_audience`, `invalid_or_expired_or_revoked`, `account_not_authorized`, or `internal`. |
| `blob9` | Last stage reached: `circuit`, `ip_limit`, `routing`, `origin`, `auth`, `method`, `account_limit`, `protocol`; tool points use `tool`. |
| `blob10` | `admin_mutation` for content mutation tools, `other` for other tool calls, `none` for requests. Validation/preview tools are not content mutations. |
| `blob11` | Configured effective circuit mode: `normal`, `degraded`, `emergency` (also the fail-closed value for invalid configuration). |
| `blob12` | Request response transport: `json`, `sse`, or `none`; tool points use `none`. |
| `double1` | Count, always 1. |
| `double2` | Elapsed milliseconds, clamped to 0–3,600,000. Request duration covers middleware through response construction; tool duration covers dispatch/validation/service execution. |
| `double3` | HTTP status on request points; 0 on tool points. |
| `double4` | Slow-call indicator: 1 at duration >= 1,000 ms, otherwise 0. |
| `double5`–`double10` | Reported batch/import item counts: created, updated, skipped, failed, conflict, replayed. Each is bounded to 10,000. Zero on requests and non-batch tools. |
| `double11` | Tool observations omitted after the per-request point cap; zero on tool points. |

One request point is emitted after every completed MCP request, including unknown
subpaths and pre-authentication rejects. One tool point is emitted per dispatched
tool attempt, including unknown names. Calls rejected by SDK validation before
dispatch appear only as request errors. Protocol errors and MCP `isError` results
are counted as errors even when their HTTP status is 200, for JSON and legacy SSE.
The method is reduced from the bounded request body to the allowlist; headers,
JSON-RPC IDs, argument keys/values and client metadata are never metric labels.

Unknown, expired and revoked tokens intentionally share one auth bucket, matching
the existing filtered lookup. Inactive accounts/demoted admins share
`account_not_authorized`; database failures become `internal`. Earlier origin,
circuit or IP rejection has `not_attempted`, not an authentication failure.

Admin batch/import outcomes describe returned results, **not exact committed
writes**. Mixed completed/replayed and skipped/failed/conflicting items are
`partial`; all failures are `failed`; only skips/conflicts are `skipped`.
Batch create replay items have their own count and do not increase `created`.
Whole-call idempotent replays have outcome `replayed` and zero item counts. Import
resume can still report previously committed items, and a failed response can
follow committed work: use the D1 audit when investigating actual writes.
Single mutations are counted as calls, not inferred row counts. When registering
an Admin content mutation, update the code-owned mutation classification and its
tests alongside the catalog.

## Five-minute queries

Use the Analytics Engine SQL API with an account token granted **Account
Analytics Read**, held in the operator's secret store. This token is for querying,
not a new Worker secret. Query the staging dataset first (substitute its name).
The examples use `_sample_interval` weights because Analytics Engine can apply
adaptive sampling. Results are estimates, not billing/audit totals. Do not add
user IDs, IPs, request paths, credentials or content to improve correlation.

Authentication and request errors, including requests rejected before auth:

```sql
SELECT intDiv(toUInt32(timestamp), 300) * 300 AS window_start,
       blob3 AS audience, blob8 AS auth, blob9 AS stage,
       blob7 AS error, SUM(_sample_interval * double1) AS requests
FROM prepdeck_mcp_metrics
WHERE timestamp >= NOW() - INTERVAL '1' DAY
  AND blob1 = 'mcp.v1' AND blob2 = 'request'
GROUP BY window_start, audience, auth, stage, error
ORDER BY window_start DESC
```

Tool volume, mean latency, slow calls and outcomes (unknown names stay one group):

```sql
SELECT intDiv(toUInt32(timestamp), 300) * 300 AS window_start,
       blob3 AS audience, blob5 AS tool, blob6 AS outcome, blob7 AS error,
       SUM(_sample_interval * double1) AS calls,
       SUM(_sample_interval * double2) / SUM(_sample_interval * double1) AS mean_ms,
       SUM(_sample_interval * double4) AS slow_calls
FROM prepdeck_mcp_metrics
WHERE timestamp >= NOW() - INTERVAL '1' DAY
  AND blob1 = 'mcp.v1' AND blob2 = 'tool'
GROUP BY window_start, audience, tool, outcome, error
ORDER BY window_start DESC
```

Throttling and unavailable dependencies: count each rejected attempt once (a
request-level quota reject or a tool-level rejection, not both). Tool-level
`unavailable` may also mean another unavailable dependency; it is not proof of
quota exhaustion. Circuit mode is a request attribute, not a transition log.

```sql
SELECT intDiv(toUInt32(timestamp), 300) * 300 AS window_start,
       blob3 AS audience, blob9 AS stage, blob5 AS tool,
       blob7 AS error, blob11 AS circuit_mode,
       SUM(_sample_interval * double1) AS rejected
FROM prepdeck_mcp_metrics
WHERE timestamp >= NOW() - INTERVAL '1' DAY AND blob1 = 'mcp.v1'
  AND blob7 IN ('rate_limited', 'unavailable')
  AND (blob2 = 'tool' OR (blob2 = 'request' AND blob9 != 'protocol'))
GROUP BY window_start, audience, stage, tool, error, circuit_mode
ORDER BY window_start DESC
```

Admin mutations and reported item outcomes:

```sql
SELECT intDiv(toUInt32(timestamp), 300) * 300 AS window_start,
       blob5 AS tool, blob6 AS outcome, blob7 AS error,
       SUM(_sample_interval * double1) AS calls,
       SUM(_sample_interval * double5) AS created,
       SUM(_sample_interval * double6) AS updated,
       SUM(_sample_interval * double7) AS skipped,
       SUM(_sample_interval * double8) AS failed,
       SUM(_sample_interval * double9) AS conflicts,
       SUM(_sample_interval * double10) AS replayed_items
FROM prepdeck_mcp_metrics
WHERE timestamp >= NOW() - INTERVAL '1' DAY
  AND blob1 = 'mcp.v1' AND blob2 = 'tool' AND blob10 = 'admin_mutation'
GROUP BY window_start, tool, outcome, error
ORDER BY window_start DESC
```

For request latency, use the tool query's weighted mean with `blob2 = 'request'`
and group by audience/method. For dropped tool observations, sum
`_sample_interval * double11` on **request** rows.

Suggested operational signals (dashboards/alerts must be configured separately):

- Sustained auth-failure, unknown-tool or quota-rejection growth above twice the
  normal same-hour baseline across three five-minute windows; require a minimum
  volume appropriate to the deployment to avoid paging on one test request.
- Any sustained `internal`/`unavailable` errors, a growing slow-call share, or
  unexpected Admin mutation volume. Check the stage/tool first; use restricted
  D1 audit access for actual mutation investigation.
- Increasing `partial`/`failed`/`conflict` outcomes: inspect import/revision
  conflicts before retrying mutations. Replays are not additional writes.
- Nonzero omitted-tool counts, or no MCP points while confirmed MCP traffic is
  present: verify the enable flag, binding, dataset and ingestion health. A quiet
  dataset alone does not prove the application is healthy or idle.

## Volume and failure behavior

Run `npm run metrics:estimate --workspace apps/worker`. It exercises the real
emitter with 100,000 requests per scenario and reports serialized point sizes,
point counts and bytes. The tool-call case uses the longest current catalog name
and maximum tool latency. Current results: 2 points / about 395 JSON bytes per
tool call, 1 point / 206 bytes per auth reject, and 1 point / 192 bytes per circuit
reject. These measure application payloads, not provider storage overhead or
invoice amounts. They receive **no** Workers Logs sampling discount.

The budget is below 512 serialized bytes per point and 1,024 bytes per ordinary
single-tool request. A collector emits at most 32 tool points plus one request
summary, below Analytics Engine's 250-point invocation limit; excess tool
observations increment the summary's omitted count. This is a telemetry bound,
not a new tool/request limit. No retry queues or per-request console fallback
are used. A synchronous sink failure disables further writes for that request;
a missing/disabled sink bypasses collection. Authentication, quotas, tools and
D1 audit continue to use their existing failure policies.

Account ingestion failures after enqueue cannot be detected by the Worker.
Analytics Engine delivery and adaptive sampling make this diagnostic telemetry,
not an exactly-once security ledger. Monitor its ingestion cost separately from
Workers Logs and review current account limits before enabling it. Set
`MCP_METRICS_ENABLED = "false"` and deploy that configuration to stop metrics
without disabling quotas/audit. Analytics Engine's documented retention is three
months; it does not inherit Workers Logs' seven-day target or implement D1 audit
purging. Grant dataset query access only to the operations/security group.

## Rollout and verification

1. Run `npm run typecheck`, `npm test --workspace apps/worker`, and
   `npm run metrics:estimate --workspace apps/worker`. Tests exercise the real SDK
   and SQLite-backed services with an in-memory Analytics Engine sink, including
   privacy sentinels, JSON/SSE errors, auth/quota/circuit failures, actual batch
   partial/replay outcomes, bounded volume and sink failure isolation.
2. Confirm Analytics Engine is available in the destination account and the
   dataset binding/enable flag are included in the intended environment. There
   is no new D1 migration. Deployment creates the dataset on its first write.
3. After an authorized staging deployment, run the existing non-mutating
   `node apps/worker/scripts/mcp-smoke-check.mjs` with `PREPDECK_MCP_BASE_URL`,
   `PREPDECK_USER_MCP_TOKEN`, and `PREPDECK_ADMIN_MCP_TOKEN` injected from the secret
   store. Do not paste credentials into CLI arguments, logs or PRs.
4. Allow ingestion time; run the queries above on staging. Expect both audiences,
   successful catalog/identity calls and `wrong_audience` auth rejects from the
   smoke script. Inspect a restricted raw point sample for only the documented
   fields and no tokens, identities, IDs, private notes, questions or imports.
   Exercise quota/circuit changes and mutations only in an isolated staging
   environment, not by exhausting production limits.
5. Record staging evidence, verify account access/retention/cost controls, then
   use the normal production deployment process and repeat the read-only smoke
   check. Source tests and dry-run bundles do not prove live ingestion; no
   dashboard, alert rule or production deployment is installed by this change.

Primary references: [binding and writes](https://developers.cloudflare.com/analytics/analytics-engine/get-started/),
[SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/),
[SQL reference](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/),
[sampling](https://developers.cloudflare.com/analytics/analytics-engine/sampling/),
[limits and retention](https://developers.cloudflare.com/analytics/analytics-engine/limits/),
[local binding support](https://developers.cloudflare.com/workers/local-development/bindings-per-env/).
