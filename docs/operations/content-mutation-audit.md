# Content mutation audit

[Documentation index](../README.md)

Question creation, editing and deletion from the Admin browser/API write
`question_mutation_audit_log` with `entry_point = 'admin_api'`. JSON import
execution uses `import_api`; Admin MCP retains its credential-aware
`admin_mcp_audit_log`. The `content_mutation_audit` view combines both sources
with actor, timestamp, entry point, credential/tool where applicable, action,
exam, stable target IDs and outcome. Apply migration
`0029_question_mutation_audit.sql` before deploying the updated routes.

A successful row mutation and its audit entry commit in the same D1 batch.
Stale writes record failure; rolled-back batches record failure after rollback.
Import keeps/skips and unresolved conflicts remain distinguishable. Audits store
bounded reasons, not question payloads, answers, user cookies or bearer tokens.
Reads and preview-only calls do not produce mutation success records.

Two categories of record are written outside their mutation's batch, because
they do not have one. An audit that accompanies a **rejected** request
(`invalid_json`, `validation`, `stale_revision`, `dependency_conflict`) is
written on its own and is best-effort: the handler has already decided the
response, so a failed audit write must not turn a 4xx the caller can act on
into a 500. An import's decisions about rows it does **not** write (unchanged,
kept, conflicting) are written before the content batches, so a run that later
rolls a batch back still records what it concluded about the rows it left
alone.

Unchanged import rows are aggregated rather than audited individually. A
re-imported catalog is overwhelmingly rows that already match, and one row per
match would mean thousands of identical "nothing happened" records per run,
forever — nothing prunes this table. One `skipped`/`identical` record covers up
to `AUDIT_TARGETS_PER_ROW` (200) questions, naming each of them in
`target_ids_json` with the count in `detail_json`, so no question is dropped
from the record. Genuine conflicts and explicit keep resolutions stay one row
each: each carries its own reason and reflects a decision someone made.

## Retention

Audit rows are written on every content mutation and are never read back by the
application, so a daily sweep (`scheduled/pruneContentMutationAudit.ts`, on the
existing `17 3 * * *` trigger) deletes rows older than `AUDIT_RETENTION_MS`
(180 days). It deletes in bounded pages and a missed or partial run is simply
picked up the next day.

The sweep covers **both** tables behind the view, including the pre-existing
`admin_mcp_audit_log`. That is deliberate: the view is the operational read
surface, so retaining MCP history longer than browser/import history would make
the same query silently under-report one entry point against another for the
same period. Anyone who needs a longer horizon than 180 days should export
before the window closes rather than raise it for one table only.

The view is an operational database reference, not a new browser or MCP SQL
interface. Existing Admin MCP recent-content queries continue to return current
question metadata; they are not the audit log and do not represent deleted rows.
Access audit data only through authorized operational tooling. Historical
browser edits before this migration have no invented actor or outcome.

The authoring API and Admin MCP still share canonical validation, question IDs,
revision checks, answer-key snapshots and cache invalidation. MCP writes require
the reviewed proposal payload/revision; batches return per-item outcomes and
retain their existing retry rules. Tag catalog merges remap stored import tag
IDs in the same transaction as live tag associations, without changing content
or answer revisions. Later manual edits still trigger re-import conflicts.

Verification uses the actual route/MCP implementations with SQLite and all
relevant migrations: `mutation-consistency.test.mjs` exercises success, stale
writes, skipped imports and rollback; `mcp-foundation.test.mjs` covers separate
audiences, preview/commit, batch retries, audit records and merged-tag imports;
`question-authoring.test.mjs` covers all question types, pagination, dependencies
and historical grading.
