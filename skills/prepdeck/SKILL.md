---
name: prepdeck
description: Review PrepDeck learning progress, discover study questions, and manage your personal Knowledge Points through the configured User MCP connection. Use for PrepDeck study and personal notes; use prepdeck-admin for question-bank administration.
---

# PrepDeck

Use User MCP as the only PrepDeck backend. Installing this Skill does not grant
access. If disconnected, read [setup](references/setup.md) and the shared
[credential contract](references/credentials.md); never retrieve a secret merely
to invoke a tool.

Connect/initialize, discover `tools/list`, and verify `user_get_identity({})`
when available. The identity must report `server: "user"`. Use only the tools and
input schemas actually exposed by this deployment. An absent capability is a
limitation to report, not permission to invent a tool or fall back to Admin MCP,
HTTP APIs, SQL, or application internals. The checked examples below are guidance,
not an exhaustive catalog.

Read [workflows](references/workflows.md) for study, history, question discovery
and Knowledge Point tasks. Reads do not record an attempt, mark a question studied,
or change progress/bookmarks. Use only explicit personal-note mutation tools for
the user's requested edits. Never pass an effective `userId` or owner override.
Delete notes, groups, tags or attachments only with clear intent for those exact
targets; resolve ambiguity before the destructive call.

Preserve server validation, visibility, ownership, pagination and limits. On a
revision conflict, fetch current state and reconcile the requested edit; do not
silently replace a revision and overwrite intervening work. For `rate_limited` or
`unavailable`, inspect both structured `error.retryAfter` (seconds) and HTTP
`Retry-After`. Wait at least the supplied delay; if absent, pause and report the
temporary failure. Retry a read once; before retrying an uncertain mutation, read
its result/current state and confirm it was not already applied. If still blocked,
report the outcome and stop retrying. Do not hot-loop or rotate tokens to evade a
quota. An HTTP 200 with `isError: true` / `ok: false` is a failed tool call.

Report actual results with question/note IDs, scope, incomplete pages and any
unsupported request. Keep tokens and unnecessary private note content out of
logs/output.
