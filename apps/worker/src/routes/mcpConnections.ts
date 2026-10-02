// Issue #102 — connected OAuth applications, managed separately from PATs
// (routes/mcpTokens.ts). Like that factory, it backs two mounts in index.ts:
// /api/mcp-connections (User MCP grants, any authenticated user) and
// /api/admin/mcp-connections (Admin MCP grants, requireAdmin). Each caller
// only ever sees and revokes their own grants for that audience. Nothing here
// returns a secret: grants hold none, and token digests are never selected.

import { Hono } from "hono";
import type { ListMcpOAuthGrantsResponse } from "@prepdeck/shared";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAdmin } from "../middleware/admin";
import { isMcpOAuthEnabled, type McpAudience } from "../mcp/oauth/config";
import { listGrants, revokeOwnedGrant } from "../mcp/oauth/grants";

export function createMcpConnectionsRouter(audience: McpAudience) {
  const router = new Hono<{ Bindings: Env; Variables: Variables }>();
  if (audience === "admin") router.use("*", requireAdmin);

  // Listed even while OAuth is switched off, so a user can still see and
  // revoke connections made before it was.
  router.get("/", async (c) => {
    const body: ListMcpOAuthGrantsResponse = {
      enabled: isMcpOAuthEnabled(c.env),
      grants: await listGrants(c.env.DB, c.get("user").id, audience),
    };
    return c.json(body);
  });

  // Ends refresh and every access token of the connection on the next request.
  router.post("/:id/revoke", async (c) => {
    const revoked = await revokeOwnedGrant(c.env.DB, { id: c.req.param("id"), userId: c.get("user").id, audience });
    if (!revoked) return c.json({ error: "Connection not found" }, 404);
    return c.json({ ok: true });
  });

  return router;
}
