# Credential contract

Secrets belong to the MCP host/client, not the model. Installing a Skill neither
authenticates nor grants PrepDeck membership. Use the audience in this package's
[connection contract](connection.json): User and Admin connections have separate
endpoints, credentials and variables. Never fall back from User to Admin.

Configure the endpoint, then let the user securely supply the credential to the
host. Prefer native secure input/credential stores; environment-backed MCP
configuration is suitable for compatible local hosts. The host resolves the
secret and attaches `Authorization: Bearer …` on every request. The agent must
not read, print, echo, cat, log or retrieve the value merely to call a tool.
Never request a token in ordinary chat when secure entry exists. Never place
tokens in URLs, tool arguments, versioned files, generated packages or snapshots.

Use `PREPDECK_USER_MCP_TOKEN` for the User connection and
`PREPDECK_ADMIN_MCP_TOKEN` for the Admin connection. Do not use one variable for
both. Preserve unrelated MCP entries when updating authorized configuration.
If a host predates a newly defined environment variable, reload/restart it so
it inherits the variable; diagnose by names/status, never by printing values.

## Maintained local client examples

These examples describe documented configuration capabilities, not an end-to-end
certification of every client/version. Replace only the deployment origin and
use the selected audience's entries. Ask for client/version if unknown; save
configuration only where authorized. After saving, separately verify the actual
connection and discover its runtime tools.

**Codex CLI:** merge the matching table into the user's MCP configuration. The
host resolves `bearer_token_env_var`; do not interpolate its value yourself.
See [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

```toml
[mcp_servers.prepdeck]
url = "<PREPDECK_ORIGIN>/mcp"
bearer_token_env_var = "PREPDECK_USER_MCP_TOKEN"

[mcp_servers.prepdeck-admin]
url = "<PREPDECK_ORIGIN>/admin-mcp"
bearer_token_env_var = "PREPDECK_ADMIN_MCP_TOKEN"
```

**Claude Code:** its `.mcp.json` supports `${VAR}` expansion in HTTP headers.
Merge only the requested connection; the host, not the model, resolves the value.
See [Claude Code MCP](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcp-json).

```json
{
  "mcpServers": {
    "prepdeck": {
      "type": "http", "url": "<PREPDECK_ORIGIN>/mcp",
      "headers": { "Authorization": "Bearer ${PREPDECK_USER_MCP_TOKEN}" }
    },
    "prepdeck-admin": {
      "type": "http", "url": "<PREPDECK_ORIGIN>/admin-mcp",
      "headers": { "Authorization": "Bearer ${PREPDECK_ADMIN_MCP_TOKEN}" }
    }
  }
}
```

**VS Code MCP in the editor:** use a password input in the user's MCP
configuration. For Admin, use a separate `prepdeck-admin-token` input and
`prepdeck-admin` connection at the Admin endpoint; do not reuse the User input.
Interactive inputs are not forwarded to every Agent Host/session type. Check the
actual execution host. See [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

```json
{
  "inputs": [{ "type": "promptString", "id": "prepdeck-user-token",
    "description": "PrepDeck User MCP token", "password": true }],
  "servers": {
    "prepdeck": {
      "type": "http", "url": "<PREPDECK_ORIGIN>/mcp",
      "headers": { "Authorization": "Bearer ${input:prepdeck-user-token}" }
    }
  }
}
```

## Hosted clients and unsupported environments

A hosted chatbot cannot read an environment variable on the user's laptop.
Use that platform's supported remote MCP credential mechanism only if it can
send a Bearer header with this transport. PrepDeck currently provides no OAuth
discovery/authorization; OAuth-only clients cannot connect yet. OAuth remains a
future host-managed option, not a flow to invent in this setup.

Other clients, including IDE extensions and cloud agents, require checking their
current HTTP/credential capabilities before supplying configuration syntax.
When the host cannot securely configure this connection, explain the specific
limitation and guide the user to supported settings/client options. Do not claim
that ordinary conversation can change every chatbot's settings. Do not bypass
the limitation by asking the model to construct authenticated raw HTTP requests.

Expired/revoked tokens must be replaced through PrepDeck's token-management UI,
then securely updated in the host. Stop on wrong audience or membership errors;
retrying with a more privileged token is not a repair.
