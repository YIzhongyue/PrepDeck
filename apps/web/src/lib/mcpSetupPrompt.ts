export const USER_MCP_TOKEN_PLACEHOLDER = "<PREPDECK_USER_MCP_TOKEN>";

/** Only the explicit one-time User action may supply a freshly issued secret. */
export function buildUserMcpSetupPrompt(origin: string, token?: string): string {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("A valid application origin is required");
  }
  if (token !== undefined && !/^pd_mcp_user_[a-f0-9]{64}$/.test(token)) {
    throw new Error("A fresh User MCP token is required");
  }
  return `Please connect this AI client to my PrepDeck account through User MCP.

Connection name: prepdeck
Server name: prepdeck-user-mcp
Endpoint: ${url.origin}/mcp
Transport: remote HTTP MCP, with stateless Streamable HTTP compatibility
Authentication: Authorization: Bearer ${token ?? USER_MCP_TOKEN_PLACEHOLDER}
Send authentication on every MCP request. This server does not provide OAuth.

Identify this client's actual MCP configuration capabilities. If authorized configuration tools or files are available, add this connection while preserving unrelated MCP entries. Otherwise, guide me through the exact client settings, asking for my client/version only if needed. Do not claim an ordinary chat can configure every client. If this client cannot support remote HTTP MCP with a Bearer header, explain that limitation; do not claim the connection succeeded. There is no local stdio command or separate SSE-only endpoint to invent.

If the token is a placeholder, guide me to enter my User MCP token through the client's secure input or credential store. I can create one in PrepDeck Settings → MCP access; a dismissed token cannot be retrieved. Prefer native secret storage or, for compatible local clients, an environment-backed setting referencing PREPDECK_USER_MCP_TOKEN. The host resolves the secret; do not read or print its environment value. Hosted clients cannot read my computer's local environment. A local host may need restart/reload to inherit a new variable. Do not ask me to paste a token into ordinary chat when secure entry exists.

Do not repeat the token in replies, log it, put it in URLs or tool arguments, or save it in version-controlled files. Do not use Admin MCP or a browser session to authenticate.

Initialize the MCP connection and discover tools with tools/list. If available, call user_get_identity with {} and confirm server is user. Do not use GET on the endpoint as a health check; it accepts authenticated POST. Report configuration saved separately from connection actually verified, and state which tools were discovered. Use only the runtime catalog; do not promise unavailable study or Knowledge Point features. No user-data mutations are needed for setup verification.`;
}

export interface FreshMcpSecret { id: string; token: string; name: string; expiresAt: number | null }

export function isFreshMcpSecretUsable(secret: FreshMcpSecret | null, now = Date.now()): secret is FreshMcpSecret {
  return secret !== null && (secret.expiresAt === null || secret.expiresAt > now);
}
