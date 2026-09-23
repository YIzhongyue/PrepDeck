# MCP foundation

[Documentation index](../README.md)

implementation established the transport and authentication boundary for implementation.
implementation (see "Token lifecycle" below) added self-service token
management API/UI. implementation added User MCP's learning/history/question-
discovery read tools; implementation added User MCP's personal Knowledge Point
tools (notes, groups, tags, question links). implementation added Admin MCP's
first business catalog (read-only question-bank/quality-control tools);
implementation added Admin MCP's question mutation tools (create/update/delete,
batch, with an audit trail); implementation added exam lifecycle, bulk import,
and tag-catalog mutation tools. implementation hardened this surface for
production: deployment-configurable rate limits (including a stricter
budget for Admin content mutations), privacy-safe audit records, and a
normalized throttling response shape across every gate a request passes
through, and bounded Analytics Engine metrics for authentication, calls and
mutation outcomes. See the per-issue sections below for each server's current tool
list, and "Request safety and limits" for the hardening detail.

## Endpoints and runtime

| Endpoint | Server name | Credential namespace |
| --- | --- | --- |
| `/mcp` | `prepdeck-user-mcp` | `pd_mcp_user_` |
| `/admin-mcp` | `prepdeck-admin-mcp` | `pd_mcp_admin_` |

Use `<PREPDECK_ORIGIN>/mcp` and `<PREPDECK_ORIGIN>/admin-mcp` for the intended
production, staging or local origin. See [connection setup](../guides/mcp-and-skills.md).
Both endpoints are mounted at the Worker
root, separately from the browser API's `/api/*` session/Access middleware.
The circuit breaker and IP rate limiter explicitly protect both MCP paths.
Worker-first asset routing includes `/mcp`, `/admin-mcp`, and their subpaths so
requests reach the Worker instead of the SPA fallback. The local Vite proxy
forwards both MCP paths to Wrangler on port 8787. No separate hostname or audience-specific
Durable Object is required — both audiences are served by the same Worker,
distinguished by path, credential namespace, and independent catalogs/quotas
(logical, not physical, separation; see "Request safety and limits").

The official `@modelcontextprotocol/server` v2 SDK's Web Standard
`createMcpHandler` runs a fresh server for every authenticated request. It
supports the 2026-07-28 protocol and stateless legacy Streamable HTTP clients
(tested with 2025-11-25). The SDK handles discovery/initialization, JSON-RPC
validation, notifications, and tool dispatch. Legacy calls may receive a
finite SSE response; modern calls receive JSON. No sessions, resumable streams,
subscriptions, resources or prompts are advertised. Business mutations are
exposed as tools in the audience-specific catalogs below.
Authenticated GET/DELETE/OPTIONS return 405 with `Allow: POST`.

The User and Admin factories and tool registrations live in separate
`src/mcp/user/server.ts` and `src/mcp/admin/server.ts` files. Neither factory
imports the other catalog. Only the common runtime and conventions are shared.

SDK references: [Web Standard serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard.html)
and [low-level server](https://ts.sdk.modelcontextprotocol.io/v2/advanced/low-level-server.html).
The low-level SDK server lets the application validate tool arguments with its
own fixed error vocabulary instead of returning raw schema-validation details.

## Authentication and provisioning

Apply the complete ordered [migration chain](../../migrations) before enabling
clients, not just the initial credential migrations. See [Deployment](#deployment). Until credentials
are provisioned, neither endpoint grants access. No remote migrations are
performed by the implementation tests.

Clients must send `Authorization: Bearer <token>` on **every** request, including
discovery, initialization, notifications, and tool calls. Cookies, Cloudflare
Access JWTs, URL parameters, and tool arguments cannot authenticate. URLs with
query strings are rejected. Send credentials only over HTTPS outside local
development, and store them in the client's secret store rather than a project
configuration committed to Git. This foundation uses pre-provisioned bearer
credentials, not an OAuth authorization/discovery service; OAuth-only clients
need the later authentication integration.

`src/mcp/credentials.ts` exposes `issueMcpCredential(db, input)` as a **trusted
internal provisioning primitive**. It is not reachable from MCP directly; the
only callers are the self-service routes in `src/routes/mcpTokens.ts` (see
"Token lifecycle" below), which authorize the caller and derive the owner from
their own authenticated context before calling it — `userId` is never a client
capability.

```ts
// Inside trusted provisioning code with a D1 binding and an authorized owner:
const credential = await issueMcpCredential(env.DB, {
  userId: authorizedOwner.id,
  audience: "user", // "admin" additionally requires a currently active admin
  name: "claude-desktop",
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // omit/null: never expires
});
// Deliver credential.token once via a secure channel. Never log it.
// Use credential.id for subsequent management/auditing.
```

The primitive generates a 256-bit random secret, prefixes its audience, and
stores only SHA-256 of the complete token. Creation checks active status and
the required role in the INSERT statement. D1 stores:

- credential ID, owner ID, and immutable intended server audience;
- a caller-chosen display name (1-100 chars), shown in Settings/admin lists;
- token digest, creation time, optional expiry, optional revocation time,
  and the time of last successful authentication (`last_used_at`);
- timestamps as Unix milliseconds (unlike some older application tables).

`revokeMcpCredential`/`getMcpCredentialOwned`/`listMcpCredentials` revoke or
read back credentials with a parameterized query scoped to owner + audience,
so cross-owner and cross-audience access is impossible even given a raw
credential ID. Rotation (`routes/mcpTokens.ts`, `POST /:id/rotate`) issues a
fresh credential with the same name and the same *relative* lifetime (a
30-day token rotates into a fresh 30-day token), then revokes the original.
Never change a credential's audience to rotate it. `touchMcpCredentialLastUsed`
records `last_used_at` after every successful `authenticateMcp` call
(best-effort; never gates or slows down authentication on failure).

Authentication checks both the prefix and stored audience, then joins the
credential to the current user row on every request. Unknown, expired, or
revoked credentials return 401. Deleted accounts lose credentials through
the foreign key; inactive accounts and demoted admins return 403. Even an admin
account needs two separately issued credentials to use both servers. A User
credential owned by an admin still gets only the User catalog and own identity.

The authenticated principal contains only the owner ID, credential ID, and
audience. Raw credentials and the browser's auth headers are stripped before
the SDK sees the request. Principals are per request and never globally shared.

## Adapter and tool conventions

`src/mcp/adapter.ts` binds service operations to the authenticated principal.
The initial operation reports `{ userId, server }`, without email, token ID,
raw token, or account role. Both adapters reject the wrong audience.

When adding a business catalog:

1. Put its registrations in the appropriate server directory only.
2. Add narrowly named operations to the corresponding identity-bound adapter.
   Close over the credential-derived owner ID; never accept an effective
   `userId`, `ownerId`, role, or server override in a tool's input.
3. Extract/reuse canonical application services from the HTTP routes as needed.
   Authorization, ownership, validation, concurrency, and transactions belong
   in those services, shared by HTTP and MCP. Do not duplicate business rules,
   proxy internal HTTP calls, or expose SQL/D1/HTTP as generic tool operations.
4. Register through `defineMcpTool`, with a strict Zod object schema. Unknown
   keys and invalid values fail before the adapter executes. Bound strings,
   collection sizes, pagination, and any relationship lists in the schema.
5. Use stable application IDs. Throw `McpApplicationError(code)` for expected
   domain failures. Map service-specific errors without copying their message,
   cause, SQL, submitted values, or private content to the client.

Successful tools return matching MCP `structuredContent` and JSON text content:

```json
{"ok":true,"data":{"userId":"user-id","server":"user"}}
```

Tool failures set MCP `isError: true`, with matching structured/text content
(`retryAfter`, seconds, is present only for `rate_limited`/`unavailable`
when the underlying limiter provided one):

```json
{"ok":false,"error":{"code":"invalid_input","message":"Invalid request input."}}
```

This one fixed code vocabulary (`src/mcp/errors.ts`'s `MCP_ERRORS`) is used
on **two different paths**, which report failure differently — implementation
review made this worth stating explicitly, since it's easy to assume every
code always produces a distinct HTTP status:

- **Pre-dispatch** (origin/method/body-size/credential problems that never
  reach a tool call — the entire authenticate-and-route step in
  `mcp/routes.ts`, including the circuit breaker and every rate-limit gate
  discussed in "Request safety and limits"): `httpError()` returns a real,
  distinct HTTP status with this JSON body, and a `Retry-After` header for
  `rate_limited`/`unavailable`.
- **Dispatched** (a tool call reached `defineMcpTool`'s `invoke()` — a
  schema-validation failure, or the operation itself throwing
  `McpApplicationError`, including an operation-level rate limiter like
  Admin's mutation quota or User's Knowledge Point write quota): always
  **HTTP 200**, with `isError: true` and this same JSON body in the tool
  result's `structuredContent` — never a distinct HTTP status, per the MCP
  `CallToolResult` convention (`src/mcp/catalog.ts`). A tool failure
  correctly staying HTTP 200 is not a bug; the client-facing contract is
  the structured `{code, message, retryAfter?}`, not the transport status.

| Code | Pre-dispatch HTTP status | Meaning |
| --- | --- | --- |
| `unauthenticated` | 401 + Bearer challenge | Missing/invalid/wrong-audience/expired/revoked credential |
| `unauthorized` | 403 | Inactive account, insufficient role, or origin rejection |
| `invalid_input` | 400 | Invalid body or input (also occurs dispatched, on schema/business validation) |
| `not_found` | 404 | Missing resource or tool in this catalog |
| `conflict` | 409 (dispatched-only; no pre-dispatch case) | Stale revision, modified proposal, or existing dependency |
| `rate_limited` | 429 + `Retry-After` | A quota was exceeded — the account/mutation/import-specific gate that rejected it decides whether this is pre-dispatch (mcp/routes.ts's account quota) or dispatched (an operation-level limiter) |
| `unavailable` | 503 + `Retry-After` | The relevant rate limiter (or another dependency it needs) was unreachable — same pre-dispatch/dispatched split as `rate_limited` |
| `internal` | 500 (dispatched-only; no pre-dispatch case) | Unexpected failure, with fixed message |

## Token lifecycle (implementation)

`src/routes/mcpTokens.ts` exports `createMcpTokensRouter(audience)`, mounted
twice under the normal `/api/*` session/Access middleware (not the raw MCP
transport above):

| Mount | Audience | Extra guard | Who manages what |
| --- | --- | --- | --- |
| `/api/mcp-tokens` | `user` | (any authenticated user) | Each user manages only their own User MCP tokens. |
| `/api/admin/mcp-tokens` | `admin` | `requireAdmin` | Each admin manages only their own Admin MCP tokens — a personal access token bound to their account, not a shared service credential. |

Both mounts expose the same four operations, always scoped to the caller's
own `(userId, server)` pair — one caller can never see, revoke, or rotate
another's credential, and a 404 is returned identically for "not found" and
"found but not yours" so existence is never leaked:

- `GET /` — list the caller's credentials as `McpCredentialSummary[]`
  (id, name, createdAt, expiresAt, lastUsedAt, revokedAt, computed `status`).
  Never includes the token or its hash.
- `POST /` — body `{ name, expiresInDays? }`. `name` is required (1-100
  chars); `expiresInDays` is optional (omit for a token that never expires)
  and bounded to `[1, MCP_TOKEN_MAX_EXPIRES_IN_DAYS]` (3650). Returns
  `{ credential, token }` — the **only** response that ever includes the raw
  token.
- `POST /:id/revoke` — sets `revoked_at`; 404 if not found/not owned, 200 on success; a second call returns 404 because the token is already revoked.
- `POST /:id/rotate` — 404 if not found/not owned, 409 if already revoked;
  otherwise issues a replacement (same name, same relative lifetime) and
  revokes the original, returning `{ credential, token }` for the new one.

Shared response types (`McpCredentialSummary`, `ListMcpCredentialsResponse`,
`CreateMcpCredentialResponse`, `RotateMcpCredentialResponse`, and the
`MCP_TOKEN_NAME_MAX_LENGTH`/`MCP_TOKEN_MAX_EXPIRES_IN_DAYS` constants) live in
`@prepdeck/shared` (`packages/shared/src/mcp.ts`) so the worker route
validation and the web UI share one source of truth.

`apps/web/src/components/McpTokensCard.tsx` is the UI for both surfaces: a
list of tokens with status/created/last-used/expiry, Rotate/Revoke actions,
and a "Create token" form. A freshly issued or rotated token is held in local
component state only, shown once with a Show/Hide + Copy control, and
discarded — reopening the card (or reloading) never shows it again, matching
the "full token displayed only once" requirement. It is mounted from
`screens/Settings.tsx` ("MCP access", `/api/mcp-tokens`) and from the Admin
console's "MCP tokens" tab (`screens/Admin.tsx`, `/api/admin/mcp-tokens`).

Tests: `apps/worker/scripts/mcp-tokens.test.mjs` covers the HTTP CRUD surface
(ownership isolation, validation, rotation, admin gating, namespace
separation) against an in-memory D1-shaped SQLite DB; `mcp-foundation.test.mjs`
covers non-expiring credentials and `last_used_at` tracking end-to-end through
the real `/mcp` transport.

Tool failures use an MCP result, not an HTTP error. SDK protocol failures retain
JSON-RPC numeric codes and request IDs, but expose only fixed messages and
`error.data = { code, message }`. A request ID containing the bearer credential
is redacted. Protocol unknown-method errors map to `not_found`; malformed
messages and parameters map to `invalid_input`; other SDK failures map to
`internal`. This boundary intentionally suppresses raw SDK exception reporting.

## User MCP: learning, history, and question discovery (implementation)

Read-only. Registered in `src/mcp/user/server.ts`, implemented in
`src/mcp/adapter.ts`'s `createUserMcpAdapter`. Every operation is scoped
exclusively to `principal.userId` (never a caller-supplied id) and reuses
the same service-layer logic as the REST routes/UI where it already
existed, adding new extracted/pure query modules
(`src/lib/attemptQuery.ts`, `wrongBookQuery.ts`, `bookmarksQuery.ts`,
`unattemptedQuery.ts`, `practiceSelection.ts`, `annotationsQuery.ts`)
where no REST equivalent did:

- `user_get_learning_overview`, `user_get_exam_progress`, `user_get_learning_stats` — dashboard/progress summaries.
- `user_list_attempts`, `user_get_attempt`, `user_get_recent_attempts` — attempt history and per-attempt detail.
- `user_get_wrong_questions`, `user_get_bookmarked_questions`, `user_get_unattempted_questions` — the three review pools.
- `user_search_questions`, `user_get_question`, `user_list_exams`, `user_get_exam`, `user_list_question_tags` — question-bank reads (full answer key included — a deliberate product decision, since these are read via the user's own MCP token).
- `user_get_recommended_questions`, `user_get_questions_for_review`, `user_get_practice_candidates` — practice-selection tools combining the pools above.
- `user_list_annotations`, `user_get_annotations_for_question` — the user's own highlight/underline/bold annotations.

Tests: `apps/worker/scripts/mcp-user-learning.test.mjs`.

## User MCP: Knowledge Points (implementation)

Registered in `src/mcp/user/server.ts`, implemented in
`createUserMcpAdapter`. Personal, private Markdown notes with groups, tags,
and question links — mutating, unlike the implementation catalog above:

- `user_list_knowledge_points`, `user_search_knowledge_points`, `user_get_knowledge_point`, `user_get_knowledge_points_for_question` — reads, owner-scoped.
- `user_list_knowledge_point_groups`, `user_list_knowledge_point_tags` — taxonomy reads.
- `user_create_knowledge_point`, `user_update_knowledge_point`, `user_delete_knowledge_point` — note CRUD; update requires a matching `baseRevision` (optimistic concurrency, same optimistic-concurrency intent as Admin question edits, whose field is `expectedRevision`).
- `user_link_knowledge_point_question`, `user_unlink_knowledge_point_question` — question links, capped and idempotent.
- `user_create_knowledge_point_group`, `user_rename_knowledge_point_group`, `user_delete_knowledge_point_group` — deleting a group falls its notes back to Ungrouped, never deletes them.
- `user_create_knowledge_point_tag`, `user_rename_knowledge_point_tag`, `user_delete_knowledge_point_tag`, `user_unlink_knowledge_point_tag` — tag taxonomy, capped per note.
- `user_reorder_knowledge_points` — custom drag-and-drop order, with stale-revision rejection.

No image-upload tool exists on this catalog (images are pasted/uploaded
through the web UI only, at `POST /api/kp-images/:knowledgePointId`); read
tools return image references (`{ id, url, status }`, `url` pointing at
`/api/kp-images/:id`) that only resolve for the owning user's own session —
see "Request safety and limits" below for how that's covered by this
suite's own tests, not assumed.

Content mutations here consume a second, KP-write-specific rate-limit
quota (see "Request safety and limits") on top of the blanket per-account
MCP quota, since a note body can be up to 200,000 characters.

Tests: `apps/worker/scripts/mcp-user-knowledge-points.test.mjs`.

## Question-bank read tools (implementation)

Admin MCP's first business catalog, registered in `src/mcp/admin/server.ts`
and implemented in `src/mcp/adapter.ts`'s `createAdminMcpAdapter`. Every
operation is read-only (no tool here may mutate `db`) and reuses the same
service-layer logic as the Admin REST routes/UI rather than duplicating
query logic: `src/lib/examManagement.ts` (extracted from `routes/exams.ts`
so both the REST route and MCP tools call the same `listExams`/`getExam`),
`src/lib/questionManagement.ts` (existing `searchQuestions`/`getQuestion`
plus new bounded/paginated reads), and `src/lib/questionQuality.ts` (pure,
independently unit-tested quality-control checks).

Question-bank reads:

- `admin_search_questions` — `{ examId, q?, type?, difficulty?, tag?, needsReview?, limit?, offset? }`,
  the same exam-scoped search used by Admin's question list. `needsReview` is an
  Admin-only filter over the review-workflow column (omitted = both states); the
  User MCP's `user_search_questions` has no equivalent.
- `admin_get_question` — `{ examId, id }`, the full stored `Question`.
- `admin_list_exams` — `{ includeArchived? }`.
- `admin_get_exam` — `{ id }`, including providers and question count.
- `admin_get_exam_statistics` — `{ examId }`: counts by type/difficulty, the
  quality-control counts below, and `{ total, completed }` attempt counts.

Quality-control and maintenance reads (all `{ examId, limit?, offset? }`
unless noted, all deterministic and explainable rather than AI-judged):

- `admin_find_duplicate_questions` — groups questions whose stem is
  identical after trimming/case/whitespace normalization.
- `admin_find_questions_missing_explanations` — null or blank `explanation`.
- `admin_find_questions_with_invalid_answer_references` — a choice-based
  question whose `correctAnswers` reference an option id that does not
  exist in `options[]`, or a `true_false` question missing exactly the
  `"true"`/`"false"` option pair.
- `admin_find_questions_missing_metadata` — no `difficulty` set or an empty
  `tags` array.
- `admin_get_question_bank_statistics` — `{}`, the same statistics as
  `admin_get_exam_statistics` aggregated across the whole bank (bounded scan;
  see below), plus a per-exam question-count breakdown.
- `admin_get_recent_content_changes` — `{ examId?, sinceMs?, limit?, offset? }`,
  questions ordered by `updated_at DESC`.

Metadata reads:

- `admin_list_tags` — `{ examId?, limit?, offset? }`: distinct tags and their
  question counts, merging usage derived from `question_tag_links`
  (implementation; previously `questions.tags_json`) with the registered tag
  catalog. Entries indicate whether they are registered — since implementation, every
  tag actually applied to a question is by definition registered (there is
  no more "used but unregistered" state); `registered: false` no longer
  occurs.

The four `find_*` tools and both statistics tools scan every matching
question row rather than a single page, because their checks need the whole
set (e.g. to group duplicates). That scan is bounded — 2,000 rows for one
exam, 5,000 across the bank (`EXAM_QUESTION_SCAN_LIMIT`/
`BANK_QUESTION_SCAN_LIMIT` in `questionManagement.ts`) — and the statistics
tools report `truncated: true` if the bound was reached, so a caller never
mistakes a partial scan for a complete one. The `find_*` tools additionally
paginate their *matched* results through the same `pageResult` convention as
every other list-returning tool. A nonexistent `examId` returns `not_found`
before any scan runs.

Tests: `apps/worker/src/lib/questionQuality.test.ts` unit-tests the pure
checks; `apps/worker/scripts/mcp-foundation.test.mjs` exercises every tool
above end-to-end (seeded duplicate/missing-explanation/invalid-reference/
missing-metadata questions across two exams, one archived), asserting
correctness, pagination, `not_found` handling, that reads never mutate the
question bank, and that User MCP cannot reach any admin tool.

## Question mutation tools (implementation)

Admin MCP's first mutating catalog. A propose-then-commit pattern
(`admin_validate_question_payload` first, then the create/update tool)
binds the exact previewed payload to the commit via a stateless
`proposalToken` (SHA-256 of the reviewed target + payload — no
server-side proposal storage); a mismatch means "refresh the preview,"
never a silent reapply of stale content:

- `admin_validate_question_payload` — `{ examId, id?, payload }`: previews a create or edit without writing, returns `proposalToken` and (for an edit) `diff`/`answerRevised`.
- `admin_preview_component_question` — `{ examId, id?, question, stimuli?, assets? }`: validates one 2.0 item and its referenced material, then uses the same proposal flow. Returns the normalized `payload` for an unchanged create/update commit; edits retain the same revision guard. See the [component contract](../../skills/pdf-to-quiz/references/component-format.md#web-ui-and-mcp).
- `admin_create_question` — commits a previewed create; a retry with the same `proposalId` replays the original result instead of duplicating (standalone idempotency ledger, `migrations/0020_admin_mcp_create_idempotency.sql`, independent of the `questions` table so a replay after deletion is still recognized).
- `admin_update_question` — commits a previewed edit; requires `expectedRevision` to match (optimistic concurrency) and preserves implementation's answer-revision semantics.
- `admin_delete_question` — requires `expectedRevision`; blocked (409) by a dependent attempt rather than cascading.
- `admin_batch_create_questions`, `admin_batch_update_questions` — up to `MAX_BATCH_MUTATION_ITEMS` (50) previewed items per call; per-item outcomes correlated to input order via `inputIndex`, so a partial batch failure is fully attributable.

Every successful/failed mutation writes a row to `admin_mcp_audit_log`
(`migrations/0019_admin_mcp_audit_log.sql`,
`migrations/0021_admin_mcp_audit_log_targets.sql`) atomically with the
mutation itself (one D1 `batch()`, so the audit row can never be missing
for a committed write or present for a rolled-back one) — see "Request
safety and limits" for exactly what it does and does not persist.

Tests: `apps/worker/scripts/mcp-foundation.test.mjs`.

## Exam lifecycle, bulk import, and tag catalog (implementation, implementation)

Browser/API authoring and imports now write the same actor/action/target/outcome
vocabulary to a session-aware audit table. The `content_mutation_audit` view joins
that history with Admin MCP's existing audit without inventing a credential for
browser sessions; see [content mutation auditing](../operations/content-mutation-audit.md).

Also in `src/mcp/admin/server.ts`/`createAdminMcpAdapter`:

- `admin_create_exam`, `admin_update_exam`, `admin_archive_exam` — no separate concurrency token; exams have no `revision` column, matching REST.
- `admin_validate_import`, `admin_preview_import`, `admin_execute_import`, `admin_get_import_status` — reuses `lib/importConflicts.ts`'s re-import preservation rules and `@prepdeck/shared`'s `validateImportFile`; `admin_execute_import` requires an explicit resolution for every changed row and is safely resumable after a stale/interrupted claim (`migrations/0023_admin_mcp_import_jobs.sql`, `migrations/0024_admin_mcp_import_committed_items.sql`). Import bodies get a widened request cap (see below) and their own native Cloudflare rate limiters, separate from the account/mutation quotas.
- `admin_create_tag`, `admin_update_tag`, `admin_merge_tags` — a registered-tag catalog (`migrations/0022_question_bank_tags.sql`, `migrations/0026_question_tag_links.sql`) with an ID-based many-to-many association table (`question_tag_links`, `migrations/0026_question_tag_links.sql`) replacing the original free-text `questions.tags_json` as live storage (`migrations/0027_drop_questions_tags_json.sql` removes the column). Tool inputs stay name-addressed (`lib/questionBankTags.ts` resolves a name to its catalog id at every entry point using one shared normalization — including the migration's own backfill, which reimplements the exact same trim/strip-`#`/collapse-whitespace/lower-case pipeline in SQL rather than a looser approximation), but rename/merge are now pure catalog + association changes: a rename never changes a tag's id (so no question row, revision, or association is touched, regardless of how many questions carry it — implementation removed the implementation-era 500-question rewrite cap along with the per-row rewrite it existed to bound), and a merge reassigns/removes `question_tag_links` rows, remaps saved import tag identities and deletes the source catalog rows, atomically with a compare-and-swap on the target catalog row's `revision` **and** on every source's own `revision` (`sourceDriftCondition`, folded into the target's own guard) — a concurrent edit to the target *or* to any one source aborts the whole merge, not just that source. Both invalidate the cached practice catalog for every affected exam without bumping question content or answer revisions.

  Every question-row write that changes a question's own tags resolves/creates the needed catalog rows, then diffs and applies `question_tag_links` in the SAME `db.batch()` as the row's own INSERT/UPDATE (not a separate best-effort step): for an update, the link statements are guarded on the row landing at exactly its expected post-write `revision` **and** `updated_at` together (revision alone is an incrementing counter a *different* concurrent writer could legitimately also reach — pairing it with the request's own timestamp removes that ambiguity), so a stale-revision write can never still apply a tag-link change alongside it, and `question_tag_links` never drifts out of sync with a question it's supposed to be committed with.

  Re-import conflict classification (`lib/importConflicts.ts`) compares current linked tag IDs with `import_baseline_tag_ids_json`, rather than display names. A merge remaps and deduplicates the baseline IDs in the same guarded transaction as live associations; it does not change question content or answer revisions. This is the only part of a merge that writes question rows at all, and it is the only unbounded work in that transaction: the statement has no index-usable predicate, so it leads with `import_baseline_tag_ids_json IS NOT NULL` to drop every never-imported question before expanding a JSON array per row. Renames preserve identity. Both operations therefore avoid false `locally_edited` conflicts while retaining genuine manual-edit conflicts. Separately, `admin_preview_import`'s `importToken` binds the current name-to-ID resolution (`tagResolutionSnapshot`); execution rejects a taxonomy change after preview instead of silently committing a different identity.

Tests: `apps/worker/scripts/mcp-foundation.test.mjs`, `apps/worker/scripts/question-bank-tags.test.mjs`.

## Pagination

`paginationSchema` and `pageResult` in `src/mcp/conventions.ts` define the shared
collection convention: integer `limit` defaults to 25 (range 1–100), integer
`offset` defaults to 0 (range 0–100,000). Numeric strings are rejected.

Apply all ownership, visibility, and filters **before** SQL pagination. Use a
stable sort with an ID tie-breaker, query at most `limit + 1` rows, then pass the
rows and validated page to `pageResult`. It returns at most `limit` items and
`nextOffset`, or `null` at the end/boundary. Do not load a whole table and slice
it in memory. Offset paging is not a snapshot: concurrent writes may move rows;
collections requiring stronger guarantees should introduce scoped opaque cursors.
The small foundation tool catalogs themselves fit in one `tools/list` response
and reject nonempty catalog cursors.

## Request safety and limits (hardened in implementation)

- Request URL origin and any supplied `Origin` must match trusted `APP_BASE_URL`.
  With `ENVIRONMENT=development`, direct local Worker origins
  `http://localhost:8787` and `http://127.0.0.1:8787` are also allowed. A missing
  Origin is supported for native clients. No cross-origin CORS access is added.
- POST bodies are capped while reading the stream, independently of
  `Content-Length`: 64 KiB by default (`MAX_MCP_BODY_BYTES`, `src/mcp/runtime.ts`),
  widened per-endpoint only with a stated reason — 1 MiB for User MCP
  (`USER_MCP_BODY_MAX_BYTES`, `src/mcp/routes.ts`; a Knowledge Point body can be
  up to 200,000 characters), 5 MiB for Admin MCP (`IMPORT_BODY_MAX_BYTES`,
  `src/lib/importSecurity.ts`; import tools accept a full file inline). Import
  JSON nesting depth is separately capped at 32 (`IMPORT_JSON_MAX_DEPTH`).
- Three throttling gates run in request order, all fail-closed (an
  unavailable limiter blocks the request rather than allowing it) and all
  using the same fixed `rate_limited`/`unavailable` codes — but gates 1 and
  2 are pre-dispatch (a real HTTP status + `Retry-After` header, before a
  tool ever runs), while gate 3 is dispatched (HTTP 200, `isError: true`,
  `retryAfter` inside the tool result instead of a header) — see the error
  code table above for exactly which is which:
  1. The circuit breaker and global per-IP limiter (shared with `/api/*`,
     mounted ahead of MCP auth/dispatch). MCP traffic is always classified
     as a mutating request here (every MCP call is POST), so it fails
     closed rather than degrading.
  2. A per-account quota, independent per audience:
     `mcp:<audience>:user:<userId>`, keyed so rotating/reissuing a
     credential can never reset it. Defaults: 60 req/min User, 30 req/min
     Admin — configurable via the `MCP_USER_RATE_LIMIT_PER_MINUTE` /
     `MCP_ADMIN_RATE_LIMIT_PER_MINUTE` Wrangler vars (`wrangler.toml`
     `[vars]`), so a quota can be tuned by deploying a config change alone.
  3. Three narrower, stricter, **operation-level** (dispatched, not
     pre-dispatch) quotas layered on top of gate 2 for higher-blast-radius
     operations, each its own env var with its own default
     (`configuredLimit()`, `src/middleware/rateLimit.ts`), throwing
     `McpApplicationError("unavailable")` if the limiter itself is
     unreachable or `("rate_limited", { retryAfter })` on a deny — both
     surfaced through the dispatched-tool-error path, never a distinct
     HTTP status:
     - Admin MCP content mutations (question create/update/delete/batch,
       exam lifecycle, tag tools): `MCP_ADMIN_MUTATION_RATE_LIMIT_PER_MINUTE`,
       default 10/min. Admin *reads* stay on gate 2's blanket quota only.
     - User MCP Knowledge Point writes: `MCP_KP_WRITE_RATE_LIMIT_PER_MINUTE`,
       default 30/min.
     - Admin's import tools use their own native Cloudflare Rate Limiting
       bindings instead of `consumeRateLimit()`
       (`IMPORT_VALIDATE_RATE_LIMITER` 20/min, `IMPORT_EXECUTE_RATE_LIMITER`
       5/min, `wrangler.toml`), scoped per `userId:examId` since validation
       does real D1 duplicate lookups — same `unavailable`/`rate_limited`
       split, but without `retryAfter` (Cloudflare's native binding doesn't
       return one).
- REST/browser callers hitting the shared circuit-breaker/IP-limiter code
  path (gate 1) keep their own unrelated `{ error: "..." }` shape — only MCP
  paths (`/mcp`, `/admin-mcp`) get the MCP envelope
  (`isMcpPath()`/`mcpThrottleResponse()`, `src/middleware/rateLimit.ts`).
- `admin_mcp_audit_log` records every Admin MCP mutation's actor, tool,
  action, target exam/question ids, and outcome
  (success/partial/failure/skipped), atomically with the mutation itself
  (see implementation above). Its `detail_json` intentionally never carries
  question content: a create/update's audit row stores only the set/changed
  field *names* (`{"fields":["stem","tags"]}`), never the values — the audit
  log is a persisted logging surface like any other and is held to the same
  "no routine sensitive-content logging" bar as console output. The tool
  call's own return value (to the authorized caller only) is unaffected and
  still carries the full payload/diff.
- Normal application logging does not log MCP headers, bodies, tokens, or raw
  exceptions — `src/mcp/runtime.ts` redacts the bearer token from any echoed
  response text and swallows raw SDK exceptions before they reach a client
  or a log line. Keep production invocation logging disabled as currently
  configured (`wrangler.toml` `[observability.logs]`). A separate Analytics
  Engine dataset records bounded request/tool counters, authentication outcomes,
  latency, protocol/application errors, early throttle/circuit rejects and Admin
  mutation outcomes. It contains no credentials, identities, request IDs or
  content. See the [MCP metrics runbook](../operations/mcp-observability.md) for
  the schema, five-minute queries, cost estimate and rollout checks.
- Deliberately out of scope for this issue (see the issue discussion for
  why): a dedicated MCP health/smoke-check *endpoint* (an authenticated
  post-deployment script covers this instead — see "Deployment" below) and
  physically separate Worker deployments per audience (the logical
  separation above — distinct paths, credential namespaces, catalogs, and
  quotas within one Worker — is the current design; a physical split is a
  later architectural choice if ever needed).

## Deployment

Both endpoints ship as part of the single `prepdeck` Worker
(`apps/worker/wrangler.toml`) — there is no separate MCP deployment step.

**Bindings/vars this surface needs** (all declared in `wrangler.toml`,
typed in `src/bindings.ts`):

| Name | Kind | Purpose |
| --- | --- | --- |
| `DB` | D1 binding | credentials, audit log, and every business table MCP tools read/write through the shared `lib/*` services. |
| `MCP_METRICS` | Analytics Engine dataset binding | bounded MCP metrics; production `prepdeck_mcp_metrics`, development `prepdeck_mcp_metrics_development`. |
| `MCP_METRICS_ENABLED` | var | exactly `"true"` enables metrics (checked in for both environments); `"false"`/missing disables them without changing authentication or tools. |
| `RATE_LIMITER` | Durable Object binding | the account/mutation/KP-write quotas above (`src/rateLimiterObject.ts`). |
| `IMPORT_VALIDATE_RATE_LIMITER`, `IMPORT_EXECUTE_RATE_LIMITER` | native Cloudflare Rate Limiting bindings | import-specific quotas. |
| `BUCKET` | R2 binding | import file archiving (Admin) and Knowledge Point images (User, via REST `/api/kp-images`, not an MCP tool). |
| `APP_BASE_URL` | var | trusted Origin/URL check (see above) and absolute-URL construction. |
| `ENVIRONMENT` | var | `"development"` additionally allows the local Worker origins above. |
| `MCP_USER_RATE_LIMIT_PER_MINUTE`, `MCP_ADMIN_RATE_LIMIT_PER_MINUTE`, `MCP_ADMIN_MUTATION_RATE_LIMIT_PER_MINUTE`, `MCP_KP_WRITE_RATE_LIMIT_PER_MINUTE` | vars | optional; see "Request safety and limits" for defaults if unset/non-numeric. |
| `CIRCUIT_MODE`, `EMERGENCY_ADMIN_IPS` | vars | cost-containment circuit breaker (`src/middleware/circuitBreaker.ts`), shared with REST — see `docs/operations/cloudflare-cost-containment.md`. |

The metrics completion of implementation adds no D1 migration. Verify dataset ingestion
after deployment using the [MCP metrics rollout checklist](../operations/mcp-observability.md#rollout-and-verification).

No MCP-specific secret exists: credentials are provisioned application-side
(see "Authentication and provisioning" above), not via a Wrangler secret.

**Migrations**: apply **every** file in `migrations/` in order, with the
normal D1 migration process (remote and local) — do not treat any
hand-picked subset as sufficient, since MCP tools share their tables with
REST (e.g. `0014_knowledge_points.sql`) and new migrations land on an
ongoing basis. `npm run db:migrate:remote --workspace apps/worker` (or
`db:migrate:local`) always applies whatever hasn't been applied yet, so
running it is the correct way to stay current rather than updating a list
here. MCP-specific migrations as of this writing:
`0017_mcp_credentials.sql`, `0018_mcp_credential_names.sql`,
`0019_admin_mcp_audit_log.sql`, `0020_admin_mcp_create_idempotency.sql`,
`0021_admin_mcp_audit_log_targets.sql`, `0022_question_bank_tags.sql`,
`0023_admin_mcp_import_jobs.sql`, `0024_admin_mcp_import_committed_items.sql`,
`0025_kp_order_scopes.sql`, `0026_question_tag_links.sql`,
`0027_drop_questions_tags_json.sql` — plus the earlier, REST-shared
`0014_knowledge_points.sql` that User MCP's Knowledge Point tools also
depend on. Until `0017`/`0018` are applied, neither endpoint grants access
(no credentials table to authenticate against); until `0025` is applied,
Knowledge Point list/reorder tools that read `orderRevision` fail.

**Local development**: `npm run dev:worker` serves both `/mcp` and
`/admin-mcp` on `http://localhost:8787` directly; the web dev server's Vite
proxy forwards both paths there too, so a client pointed at either the
worker port or the web dev port reaches the same endpoints. Issue
credentials for local testing the same way as production — through
`POST /api/mcp-tokens` or `POST /api/admin/mcp-tokens` (see "Token
lifecycle"), signed in as a seeded local user — never by hand-inserting a
row, since `issueMcpCredential` is what actually hashes and namespaces the
token correctly.

Development limiter bindings currently require manual setup; see
[local limitations](../guides/development-and-deployment.md#local-limitations).

**Post-deployment verification**: `apps/worker/scripts/mcp-smoke-check.mjs`
is a small, authenticated, non-mutating script for confirming a deployment
is healthy without adding an unauthenticated tool-discovery endpoint. Given
one User and one Admin token, it checks: both endpoints are reachable and
return `200` on `tools/list`; each catalog is audience-scoped (a User token
against `/admin-mcp` and vice versa both get `401`) *and* contains a
required baseline of business tool names spanning every catalog generation
(implementation for User, implementation for Admin) — not just "non-empty," so a
deployment stuck on an old, narrower catalog fails loudly instead of
passing; a read-only identity tool call round-trips on each server; and a
representative database-backed business read (`user_list_knowledge_points`,
scoped to `ungrouped: true`) succeeds and returns `orderRevision`, catching
a missing/failed migration (see `0025_kp_order_scopes.sql` above) that an
identity-only check cannot. Every diagnostic it prints is either a fixed
category or one of its own constants — never raw response text or an
exception's own message, since a Fetch/Headers error can embed a malformed
credential's value verbatim; token format is validated up front, before
any request, for the same reason. Run it after any deploy that touches MCP:

Have the trusted operator/CI secret store provide `PREPDECK_MCP_BASE_URL`,
`PREPDECK_USER_MCP_TOKEN` and `PREPDECK_ADMIN_MCP_TOKEN` to the script process.
It reads these environment variables directly; do not echo values or expand
tokens into command-line arguments. See [credential setup](../guides/mcp-and-skills.md).

```bash
node apps/worker/scripts/mcp-smoke-check.mjs
```

It exits non-zero (and prints which check failed) on any unexpected status,
missing tool, or broken business read, so it can be wired into a deploy
pipeline's post-deploy step. It never prints either token or any other
network/response-derived text, and performs no mutation — safe to run
repeatedly against production with the same pair of long-lived,
narrowly-purposed tokens. `apps/worker/scripts/mcp-smoke-check.test.mjs`
covers this script itself: malformed-credential/sensitive-marker leakage
(including a literal CLI subprocess run), the old-catalog false-positive
case, a missing order-scope migration, and an end-to-end pass/fail run
against a real bundled Worker.

## Verification

`npm test --workspace apps/worker` runs every test below, each bundling the
real Worker with the SDK's `workerd` conditions against a SQLite-backed D1
adapter (applying the actual migrations, not a hand-rolled schema):

- `mcp-foundation.test.mjs` — transport/auth foundation (both protocol eras,
  independent catalogs, credential namespaces and stored audience,
  revoked/expired credentials, account status/role changes, concurrent
  identities, spoofed identity arguments, fixed error responses,
  secret-free storage/logging) plus the full Admin MCP catalog (implementation reads,
  implementation mutations with audit-privacy assertions, implementation exam/import/tag tools)
  end-to-end against a seeded question bank, and the full throttling stack
  (implementation: circuit/IP gates, blanket account quota, Admin-mutation quota, and
  their normalized envelope, including real quota-exhaustion and
  credential-rotation cases with a stateful rate-limiter stub), plus metrics
  privacy, auth/error categories, JSON/SSE outcomes, partial/replayed batches,
  bounded volume and sink-failure isolation.
- `mcp-tokens.test.mjs` — the token-lifecycle HTTP CRUD surface (ownership
  isolation, validation, rotation, admin gating, namespace separation).
- `mcp-user-learning.test.mjs` — the implementation read catalog end-to-end.
- `mcp-user-knowledge-points.test.mjs` — the implementation Knowledge Point catalog
  end-to-end, a REST harness for cross-checking the shared lib layer
  against REST callers, KP-write-quota exhaustion, and (implementation) the real
  `/api/kp-images` attachment route's cross-user isolation reached through
  an MCP-returned image ref, not just the MCP tool call that returns it.
- `circuit-breaker.test.mjs`, `security-rate-limit.test.mjs` — the shared
  gates MCP inherits, independent of any MCP-specific wiring.
- `mcp-smoke-check.test.mjs` — the post-deployment script itself (see
  "Deployment" above): malformed-credential/sensitive-marker leakage
  (including a literal CLI subprocess run reproducing the exact scenario a
  review found), the old-catalog false-positive case, a missing
  order-scope migration, and an end-to-end pass/fail run against a real
  bundled Worker.

No remote migrations or deployments are performed by any of these tests —
see "Deployment" above for the post-deployment smoke check that exercises
an actual deployed environment.
