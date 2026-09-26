# Worker logging and cost-control runbook

[Documentation index](../README.md)

## Production policy

Production Workers Logs use a 5% head sample and disable automatic invocation
logs. The `development` Wrangler environment keeps 100% invocation output for
interactive troubleshooting, but sets `persist = false`. Never deploy the
`development` environment as production.

Application events must be compact JSON with a fixed event name and a small,
closed set of enum-like fields. They must never contain request or response
bodies, URLs with query strings, user IDs, question IDs, model input/output,
API keys, `Cookie`, `Set-Cookie`, or `Authorization` headers. Keep field values
bounded and avoid attacker-controlled values and unbounded cardinality.

### Implemented today

| Event/store | Source | Current contents |
| --- | --- | --- |
| `ai.upstream_failure` | [AI route](../../apps/worker/src/routes/ai.ts) | Fixed provider/reason/status fields; compact JSON; no key or explanation. |
| `auth.google.start*`, `auth.google.callback.*` | [Auth routes](../../apps/worker/src/routes/auth.ts) | Redirect URI/mode, missing-parameter/state booleans, provider error or exception message depending on event. |
| `api.unhandled_error` | [Error handler](../../apps/worker/src/lib/unexpectedError.ts) | Method, route pattern, error name and the first 200 characters of its message; no body, headers or user ID. The client gets a generic JSON 500. |
| `dailyReviewEmail.delivery_failed` | [Email job](../../apps/worker/src/scheduled/sendDailyReviewEmails.ts) | User ID and exception message. |
| `mcp.v1` request/tool metrics (Analytics Engine) | [MCP observation](../../apps/worker/src/mcp/observability.ts) | Fixed audience/method/catalog tool, auth/error/outcome/gate enums, duration and bounded item counts. [Schema and five-minute queries](mcp-observability.md). |
| `admin_mcp_audit_log` (D1, not Workers Logs) | [MCP audit](../../apps/worker/src/mcp/audit.ts) and adapter | Actor/credential, action, target IDs, outcome and changed field names, not complete question content. |

Console events are subject to platform head sampling. D1 mutation audit is an
independent persistent store and is not sampled by Workers Logs. MCP counters
also bypass Workers Logs head sampling, using Analytics Engine with its own
adaptive sampling. Generic REST success/4xx/security counters and circuit
transition logging remain unimplemented; MCP rejected-request counters do not
claim to be transition events.

### Current gaps

The policy above is the target, not a claim that every current call complies.
Email failure logging includes user identity, and OAuth/email logging includes
raw exception messages or provider-supplied values rather than only bounded enums.
Those fields need a future implementation hardening change. Restrict access to
existing logs and do not copy them wholesale into issues or routine diagnostics.
This documentation refactor records the gap without altering application behavior.

MCP's content-minimized D1 audit exists, but automatic age-based deletion/retention
and a general REST mutation audit sink do not. Account-side retention/alerts and
the standalone responder must be verified externally; they are not installed by
this runbook.

### Target design for the remaining general REST pipeline (not yet implemented)

| Event class | Target strategy | Required payload |
| --- | --- | --- |
| Successful requests | 1% sample (the platform head sample is an additional ceiling) | route template, method, duration bucket |
| Expected 4xx | 1%; 404 and 429 use aggregate counters only | route template, status class |
| Authentication failures | Aggregate a count per 5-minute window by outcome and coarse route; emit no per-request event | outcome, route group, count |
| General administrative mutations (beyond existing MCP D1 audit) | Dedicated audit policy and optional metadata sample; not implemented | action, result, opaque audit correlation ID |
| Circuit-breaker transitions | Log every **state transition**, never every rejected request; aggregate rejected counts per 5-minute window | dependency, old/new state, rejected count |

The remaining REST aggregate metric rows above need a counter backend (for example, Cloudflare Analytics
Engine or a Durable Object) before it can ship — `console.log` per request is
not an acceptable substitute, since it can't be queried or aggregated and
would reintroduce the volume this runbook exists to control. Do not key any
of these counters by IP address, identity, path parameter, user agent, or
supplied credential. Do not claim any row in this section is live until the
corresponding backend and emitting code both exist.

### Known limitation: head sampling can't target errors

`head_sampling_rate` is a per-invocation decision made before the request is
handled, so it cannot be conditioned on the outcome — at 5%, roughly 95% of
`ai.upstream_failure` events are simply never captured, regardless of what
this file logs. Raising the production sample rate is the only way to
increase real-world capture of that event; there is currently no Cloudflare
Workers API this codebase uses to force-capture an individual failed
invocation. If upstream failures need reliable capture, either raise
`head_sampling_rate` (at real cost) or route this event through a separate,
outcome-independent channel (for example, an Analytics Engine dataset written
directly from `logAiFailure`, bypassing head sampling entirely) — that is
tracked as backlog, not implemented here.

## Retention, access, and alerts

1. The operational retention targets are **7 days** for Workers Logs and
   **90 days** for administrative audit records, subject to account-supported
   retention settings and an explicit deletion procedure. The existing MCP D1
   audit has no automatic purge; neither target is guaranteed by Wrangler.
   Record the actual configured retention and any difference in the operations ticket.
2. Grant log access only to the production operations and security groups using
   least-privilege, SSO, and MFA. Developers use redacted development logs.
   Review group membership quarterly and after every team change; retain access
   audit records for one year.
3. Alert at 50%, 75%, and 90% of the daily ingest budget and at 75% of storage
   capacity. Page operations on an ingest-rate increase above 2x the trailing
   seven-day hourly baseline. The response is to reduce sampling or disable a
   noisy event—not to discard security audit records.
4. On the first business day of every month, compare dashboard ingestion bytes,
   retained bytes, event counts, and invoice line items with the estimate from
   `npm run logs:estimate --workspace apps/worker`. Record the result in the
   operations ticket.
5. Quarterly, and before enabling a new log source, verify the current Workers
   Logs pricing, included allocation, maximum event size, ingestion/rate limits,
   retention behavior, and sampling semantics in the vendor documentation and
   account plan. Update this runbook and alert thresholds when they differ.

## Load simulation and acceptance criteria

Run the estimator (`npm run logs:estimate --workspace apps/worker`) after
changing `logAiFailure`'s fields or the production head sample. It models only the AI failure event, not total application logging. It simulates
100,000 requests hitting the worse of its two record shapes (`http_error`,
which is larger than `empty_content`) and measures the UTF-8 bytes of the
compact record that would actually be emitted, after the production head
sample. Auth/email events already need additional estimator scenarios; as other events
ship, add a scenario for each — do not let this file drift back to modeling events
the code doesn't produce. MCP has a separate `npm run metrics:estimate --workspace
apps/worker` estimator covering 100,000 requests each for tool calls, auth rejects
and circuit rejects. It models Analytics Engine points with **no** Workers Logs
sampling discount; see [its independent budget](mcp-observability.md#volume-and-failure-behavior).

For the AI console channel, accept a change only when the record stays below 512 bytes and stays below 32
bytes per request after the production head sample. Also inspect a live
staging sample to confirm secrets and response bodies are absent.

During an incident, first identify the event name and route causing the
increase. Reduce its sample rate (or, for `ai.upstream_failure`, the platform
head sample) and revert temporary verbosity within 24 hours.
