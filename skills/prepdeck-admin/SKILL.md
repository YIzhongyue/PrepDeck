---
name: prepdeck-admin
description: Inspect and maintain PrepDeck question banks through Admin MCP, including quality checks, reviewed question edits, imports, exams and taxonomy. Use for explicit PrepDeck administration, not personal study or Knowledge Points.
---

# PrepDeck Admin

Use Admin MCP as the only privileged PrepDeck backend. Installation does not
grant access. Read [setup](references/setup.md) and the shared
[credential contract](references/credentials.md) if disconnected. User tokens and
browser sessions do not authenticate Admin MCP; never retrieve an Admin secret
to construct a request in model context.

Initialize, discover `tools/list`, and verify `admin_get_identity({})` when
available with `server: "admin"`. Runtime tools/schemas are authoritative. Use
only exposed tools; report an unavailable capability instead of inventing it or
using direct SQL, REST, storage, or application internals. Administration must
retain the server's validation, authorization, revisions and audit records.

Read [workflows](references/workflows.md) before edits/imports. First inspect and
prepare the concrete proposal. Where preview/validation exists, display its
before/after or create/update/skip/conflict results. Obtain explicit approval for
the reviewed high-impact proposal before committing; existing approval applies
only to the exact reviewed scope. Preserve `proposalToken`, `proposalId`,
`expectedRevision`, and import bindings returned by the relevant tool. A stale
token or conflict requires current state, fresh validation/preview, a new diff
and approval for the changed proposal; never blind-retry or force overwrite.

Prefer bounded batches to loops of individual mutations when supported. Respect
the discovered item limit and report per-item `inputIndex`/IDs and outcomes,
including partial failure. Do not describe a mixed batch as wholly successful.

Inspect structured `error.retryAfter` (seconds) as well as HTTP `Retry-After`
for `rate_limited` / `unavailable`. Wait at least that delay; if none is provided,
pause and report the temporary failure. Retry a read once. For a mutation with an
uncertain result, check current state/import status before retrying; reuse exact
idempotency bindings only where the schema guarantees replay. Stop after a
repeated failure and report what is known. Do not evade quotas with credentials
or hot retry loops. `isError: true` / `ok: false` remains failure under HTTP 200.

Require clear intent for destructive operations, identify exact targets and
dependencies, and keep unrelated data outside the change. Report resulting IDs,
revisions and partial outcomes without unnecessary question/import content in
logs. Never include credentials in output.
