# User MCP setup

1. Install the `prepdeck.skill` archive with the client's supported Skill importer,
   or extract its `prepdeck/` directory into that client's documented Skill
   location. Retain all references and metadata. Skill installation is separate
   from authentication.
2. Configure connection `prepdeck` using the active deployment's origin followed
   by `/mcp`: `<PREPDECK_ORIGIN>/mcp`. The advertised name is
   `prepdeck-user-mcp`; [connection.json](connection.json) records this contract.
   Use remote HTTP MCP with stateless Streamable HTTP compatibility. The host
   sends `Authorization: Bearer …` on every request. There is no local stdio
   command, separate SSE-only endpoint or OAuth discovery flow.
3. Create a User token in **Settings → MCP access** and enter it directly in the
   MCP host's secure credential input/store. For compatible local clients the
   environment variable is `PREPDECK_USER_MCP_TOKEN`. Read
   [credentials](credentials.md) for supported example formats and limitations.
   Do not substitute an Admin credential or browser session. A dismissed token
   cannot be retrieved; create or rotate through the app when needed.
4. Initialize/connect, list available tools, verify that the catalog belongs to
   User MCP, then call `user_get_identity` with `{}` if available. Confirm
   `server: "user"`; an Admin catalog/identity is a configuration error. A
   harmless `user_list_exams` call can verify the data path. No mutation is needed.
   GET on the MCP URL is not a connectivity test (only POST is supported).
5. Discover the runtime catalog before the task. Report configuration saved and
   connection verified separately, including any unavailable identity/read tool.
   Never claim success from editing a configuration file alone.

**Settings → Copy setup prompt** copies a placeholder prompt for the current
origin. The separate **Copy setup prompt with token** action exists only while
the freshly issued token is available. That action shares the secret with any AI
service where the user pastes it; normal setup should use secure client entry.
Done, reload, rotation, revocation or known expiration remove that fresh secret
from the app's prompt action.

The repository's operator smoke checker follows the same initialize/discover/
identity/read sequence and checks audience isolation. It requires operator-managed
secrets and is not a reason for a model to inspect environment values.
