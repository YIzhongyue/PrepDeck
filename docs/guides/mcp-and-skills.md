# MCP connections and Skills

[Documentation index](../README.md)

## Available now

The same deployment exposes User MCP at `<PREPDECK_ORIGIN>/mcp` and Admin MCP at
`<PREPDECK_ORIGIN>/admin-mcp`. Use the origin for your production, staging or local
environment; do not copy production URLs into local fixtures. Both accept
authenticated HTTP POST MCP. They are logically separate servers/catalogs in one
Worker. [Architecture and lifecycle](../architecture/mcp.md) owns their detailed
transport, error, revision and quota contracts.

User MCP provides identity, question discovery, learning/history/statistics and
personal Knowledge Point operations. Admin MCP provides question-bank reads/QC,
question mutations, imports, exam lifecycle and taxonomy. Always discover the
current `tools/list`; a planned or historical tool need not exist in a particular
deployment. Source registrations are [User](../../apps/worker/src/mcp/user/server.ts)
and [Admin](../../apps/worker/src/mcp/admin/server.ts), not a manually copied list
in an agent prompt.

## Configure a connection

Skill installation and MCP access are separate. Install the optional packages
below, configure the connection, securely enter a credential, verify access,
then discover the runtime tools. A Skill cannot grant membership or a role.

1. In the app, create a named User token in **Settings → MCP access**. An admin
   creates an independent Admin token in **Admin → MCP tokens**. Record the
   newly shown token once in the MCP host's secure store; it is not recoverable
   through the listing API. Rotate a lost token rather than trying to read it back.
2. Configure the appropriate endpoint in a client that supports authenticated
   remote MCP. The host sends `Authorization: Bearer …` on every request.
   A browser cookie, Access JWT, query parameter or token in tool arguments is
   not accepted as MCP authentication. User tokens never authorize Admin tools,
   even when owned by an admin.
3. Let the host resolve credentials through its supported secure store/input or
   environment-backed configuration. Recommended variable names for compatible
   local clients are `PREPDECK_USER_MCP_TOKEN` and `PREPDECK_ADMIN_MCP_TOKEN`.
   Reference the variable name in configuration; do not ask the model to print,
   read or paste its value. Keep tokens out of chat, URLs and versioned files.
4. Hosted clients cannot be assumed to read your computer's environment. This
   server does not implement OAuth authorization/discovery, so an OAuth-only
   client is not supported by the current bearer-only setup. A local host may
   require restart/reload to inherit a newly set environment variable. Maintained
   [client examples](../../skills/prepdeck/references/credentials.md) cover Codex
   CLI, Claude Code and VS Code editor MCP. They follow those clients' documented
   formats; they are not a certification of every version, extension or hosted
   session. A normal conversation cannot configure every chatbot.
5. Initialize/connect, list tools, confirm the correct audience with its identity
   tool, and perform a harmless read. No data mutation is needed to test a
   connection. The [smoke checker](../../apps/worker/scripts/mcp-smoke-check.mjs)
   checks both audience catalogs and a database-backed read; see
   [deployment verification](../architecture/mcp.md#deployment).

The operator smoke-check script reads `PREPDECK_MCP_BASE_URL`,
`PREPDECK_USER_MCP_TOKEN` and `PREPDECK_ADMIN_MCP_TOKEN` directly from its process
environment. Let a trusted operator/CI secret store inject them; invoke the script
without token arguments and never echo their values. This script-based verification
is separate from the MCP host's credential handling for ordinary agent tool calls.

### Copy a setup prompt

**Settings → MCP access → Copy setup prompt** copies complete connection guidance
using the current app origin and a User token placeholder. It works before a token
is created and when a previously shown token has been dismissed. The prompt asks
the client to configure MCP only where it has authorized configuration access,
otherwise provide client-specific instructions. It distinguishes saved settings
from verified connectivity and directs secure credential entry.

After creation/rotation, **Copy setup prompt with token** is available beside
the one-time token. It includes that fresh secret; pasting shares it with the
selected AI service. Done, reload, revocation, rotation or known expiration
discard that secret from the prompt action. Listing tokens never retrieves it.
The ordinary action always uses a placeholder, and copying never changes tokens.
Clipboard failures provide a selectable fallback; it remains sensitive when the
token-inclusive action was selected. Admin token cards do not offer User setup.

## Admin workflow contract

Preview/validation binds high-impact changes to a reviewed payload using
`proposalToken` where the tool provides it. Preserve `expectedRevision` and explicit
approval for the reviewed operation. On a stale proposal/conflict, fetch current
state, preview the updated difference and obtain approval for the changed proposal;
do not silently overwrite or blindly retry a previous commit. Use bounded batches
where supported, respect `rate_limited` / `unavailable` and `retryAfter`, and report
per-item partial outcomes. All writes use Admin MCP's validation/audit services;
direct database writes are not a substitute.

## Skills and packaging

Three independent packages are available from this source tree:

| Skill / artifact | Purpose | Backend |
| --- | --- | --- |
| [prepdeck](../../skills/prepdeck/SKILL.md) / `prepdeck.skill` | Study, progress and personal Knowledge Points | User MCP only |
| [prepdeck-admin](../../skills/prepdeck-admin/SKILL.md) / `prepdeck-admin.skill` | Reviewed question-bank administration | Admin MCP only |
| [pdf-to-quiz](../../skills/pdf-to-quiz/SKILL.md) / `pdf-to-quiz.skill` | Offline PDF conversion to import JSON and evidence | No MCP connection |

MCP supplies the authenticated protocol/capability layer; the first two Skills
supply optional instructions/workflows for agents using it. `pdf-to-quiz` creates
an import before an admin reviews/uploads it and has no deployed runtime component.
The [release workflow](../../.github/workflows/release-skills.yml) calls
[package-skills.sh](../../.github/scripts/package-skills.sh), packaging directories
under `skills/` containing `SKILL.md` as `.skill` archives. Obtain available
artifacts from [repository releases](https://github.com/YIzhongyue/PrepDeck/releases)
whose source includes the desired package. Use the client's supported Skill import
mechanism. For clients that load Skill folders, `.skill` is a ZIP: extract its
complete named folder into the client's documented Skill directory. Keep references
and `agents/` metadata together. Do not assume every chatbot imports this format.
Follow [User setup](../../skills/prepdeck/references/setup.md) or
[Admin setup](../../skills/prepdeck-admin/references/setup.md) after installation.

The shared [credential contract](../../skills/prepdeck/references/credentials.md)
is included identically inside both archives so either installs independently.
Secrets stay in the MCP host; the model does not retrieve them to make calls.

### Contributor validation

With Python 3.12+ and `PyYAML>=6,<7` installed, run:

```bash
python -m unittest discover -s .github/scripts -p 'test_validate_skills.py'
python .github/scripts/validate_skills.py --package-output dist/skills
```

CI and release packaging validate front matter/client metadata, self-contained
relative links, intended file inventory, likely User/Admin secrets, connection
audience boundaries and concrete tool names against the actual MCP registrations.
The deterministic archives are scanned and byte-compared to validated sources.
Future Skill directories are packaged generically. The existing Worker MCP smoke
tests exercise initialization/discovery/read behavior without production secrets.
See [Skill and onboarding verification](skill-verification.md) for scenario and
browser checks; validation does not replace reviewing the agent's decisions.
