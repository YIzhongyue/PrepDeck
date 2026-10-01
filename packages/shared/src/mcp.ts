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

// --- MCP OAuth authorization (issue #102) ------------------------------------
// OAuth-capable MCP clients can connect by signing in with Google through
// PrepDeck and approving access, instead of pasting a PAT. Both credential
// kinds work on the same /mcp and /admin-mcp endpoints. See
// apps/worker/src/mcp/oauth/ and docs/architecture/mcp.md#oauth-authorization.

export type McpAudienceName = "user" | "admin";

// The scope taxonomy. Each scope belongs to exactly one MCP audience, so a
// grant for one endpoint can never authorize the other. Read scopes allow the
// tools annotated readOnlyHint: true; write scopes allow every tool of that
// audience (write includes read). The account's current role and status still
// bound everything at request time.
export const MCP_OAUTH_SCOPES = ["mcp:user:read", "mcp:user:write", "mcp:admin:read", "mcp:admin:write"] as const;
export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

export interface McpOAuthScopeInfo {
  audience: McpAudienceName;
  access: "read" | "write";
  label: string;
  description: string;
}

export const MCP_OAUTH_SCOPE_INFO: Record<McpOAuthScope, McpOAuthScopeInfo> = {
  "mcp:user:read": {
    audience: "user", access: "read", label: "Read your study data",
    description: "Exams, questions, your attempts, statistics, annotations and Knowledge Points.",
  },
  "mcp:user:write": {
    audience: "user", access: "write", label: "Record study activity and edit your notes",
    description: "Start and answer practice sessions, set your Learning Mode position, and create, edit or delete your Knowledge Points.",
  },
  "mcp:admin:read": {
    audience: "admin", access: "read", label: "Read the question bank as an administrator",
    description: "Every exam and question, quality-control reports, statistics, exports and import previews.",
  },
  "mcp:admin:write": {
    audience: "admin", access: "write", label: "Change the shared question bank",
    description: "Create, update, archive and delete questions and exams, run imports and edit the tag catalog for every user.",
  },
};

/** What the consent screen shows for one pending authorization request. */
export interface McpAuthorizationRequestView {
  id: string;
  client: {
    id: string;
    /** Self-asserted by the client; shown as unverified. */
    name: string | null;
    /** "dynamic": registered by the client itself. "metadata_document": the client id is an https URL PrepDeck fetched. */
    kind: "dynamic" | "metadata_document";
    /** Where the browser is sent after the decision (scheme + host, or the custom scheme). */
    redirectTarget: string;
  };
  audience: McpAudienceName;
  resource: string;
  scopes: McpOAuthScope[];
  expiresAt: number;
  account: { email: string; role: "admin" | "user" };
  /** False when the signed-in account may not grant this audience (Admin MCP needs an active administrator). */
  eligible: boolean;
}

export interface McpAuthorizationDecisionResponse {
  /** The client's redirect URI with the code (approve) or error (deny); the browser navigates there. */
  redirectTo: string;
}

export type McpOAuthGrantStatus = "active" | "expired";

/** A connected OAuth application, as Settings / the Admin console list it. Never includes a secret. */
export interface McpOAuthGrantSummary {
  id: string;
  clientId: string;
  clientName: string | null;
  clientKind: "dynamic" | "metadata_document";
  audience: McpAudienceName;
  scopes: McpOAuthScope[];
  createdAt: number;
  lastUsedAt: number | null;
  /** "expired": no refresh token is still usable, so the client must reconnect. */
  status: McpOAuthGrantStatus;
}

export interface ListMcpOAuthGrantsResponse {
  /** Whether this deployment accepts OAuth connections at all (MCP_OAUTH_ENABLED). */
  enabled: boolean;
  grants: McpOAuthGrantSummary[];
}
