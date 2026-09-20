# Admin MCP setup

1. Install `prepdeck-admin.skill` with the client's supported Skill importer or
   extract its complete `prepdeck-admin/` folder into the client's documented
   Skill location. Keep the references/metadata. Installing the Skill is separate
   from configuring the connection and granting access.
2. Configure connection `prepdeck-admin` at
   `<PREPDECK_ORIGIN>/admin-mcp` using the active local/staging/production origin.
   Its advertised name is `prepdeck-admin-mcp`; see
   [connection.json](connection.json). It uses remote HTTP MCP with stateless
   Streamable HTTP compatibility and Bearer authentication on every POST request.
   It has no local stdio command, separate SSE-only endpoint or OAuth discovery.
3. An active administrator creates their own Admin credential in **Admin → MCP
   tokens** and enters it through the host's secure input/store. Compatible local
   clients can reference `PREPDECK_ADMIN_MCP_TOKEN`. Read
   [credentials](credentials.md) for client formats. User tokens, cookies and
   Access JWTs are insufficient, even for an administrator's account. Losing a
   displayed token requires creation/rotation; listing cannot recover secrets.
4. Initialize/connect and discover the catalog. Confirm the Admin audience and
   `admin_get_identity({})` returning `server: "admin"`, when available. Use a
   harmless `admin_list_exams` or question-bank QC read to check data access.
   Do not write to prove connectivity. GET on the endpoint is unsupported.
5. Report saved configuration separately from verified access. Rediscover tools
   for the requested task; a historical/planned tool may be absent.

These checks follow the repository's read-only operator MCP smoke check. The
operator injects credentials into its process; the agent never inspects them.
Stop on wrong audience or unsupported transport/authentication and guide secure
client configuration instead of requesting a token in chat.
