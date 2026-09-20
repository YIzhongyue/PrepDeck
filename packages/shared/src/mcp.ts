// DTOs for implementation's MCP token lifecycle management: the self-service
// User MCP token surface in Settings (/api/mcp-tokens) and the Admin-only
// Admin MCP token surface (/api/admin/mcp-tokens). Both share this shape;
// only the audience/server they operate on differs (see
// apps/worker/src/routes/mcpTokens.ts).

export type McpTokenStatus = "active" | "revoked" | "expired";

export const MCP_TOKEN_NAME_MAX_LENGTH = 100;
export const MCP_TOKEN_MAX_EXPIRES_IN_DAYS = 3650;

export interface McpCredentialSummary {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  status: McpTokenStatus;
}

export interface ListMcpCredentialsResponse {
  credentials: McpCredentialSummary[];
}

export interface CreateMcpCredentialRequest {
  name: string;
  // Days from now until expiry. Omit for a token that never expires.
  expiresInDays?: number;
}

// The full bearer token is included only in the create/rotate response —
// never again afterward (list/get only ever return McpCredentialSummary).
export interface CreateMcpCredentialResponse {
  credential: McpCredentialSummary;
  token: string;
}

export interface RotateMcpCredentialResponse {
  credential: McpCredentialSummary;
  token: string;
}
