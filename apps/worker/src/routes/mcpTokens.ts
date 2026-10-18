// implementation — self-service MCP token lifecycle. This same factory backs two
// mounts in index.ts: /api/mcp-tokens (User MCP, any authenticated user
// manages their own tokens) and /api/admin/mcp-tokens (Admin MCP, gated by
// requireAdmin below). Each caller only ever sees/manages their own
// credentials for that audience — an admin's Admin MCP tokens are personal
// access tokens bound to their own account, not a shared service credential.

import { TURNSTILE_ACTIONS, type McpCredentialSummary } from "@prepdeck/shared";
import { createMcpCredentialRequestSchema } from "@prepdeck/shared/schemas";
import { createRouter } from "../context";
import { readBody } from "../lib/requestBody";
import { requireAdmin } from "../middleware/admin";
import { requireTurnstile } from "../middleware/turnstile";
import {
  getMcpCredentialOwned, issueMcpCredential, listMcpCredentials, revokeMcpCredential, type McpAudience,
} from "../mcp/credentials";
import { McpApplicationError } from "../mcp/errors";

const DAY_MS = 24 * 60 * 60 * 1000;

function freshSummary(issued: { id: string; name: string; createdAt: number; expiresAt: number | null }): McpCredentialSummary {
  return {
    id: issued.id, name: issued.name, createdAt: issued.createdAt, expiresAt: issued.expiresAt,
    lastUsedAt: null, revokedAt: null, status: "active",
  };
}

export function createMcpTokensRouter(audience: McpAudience) {
  const router = createRouter();
  if (audience === "admin") router.use("*", requireAdmin);
  // Both issue a working bearer token, so both ask for human verification
  // when the deployment uses it (issue #82). Revoking only takes access away.
  const verifyHuman = requireTurnstile(TURNSTILE_ACTIONS.mcpToken);

  router.get("/", async (c) => {
    const userId = c.get("user").id;
    const credentials = await listMcpCredentials(c.env.DB, userId, audience);
    return c.json({ credentials });
  });

  router.post("/", verifyHuman, async (c) => {
    const userId = c.get("user").id;
    const parsed = await readBody(c, createMcpCredentialRequestSchema);
    if (!parsed.ok) return parsed.response;
    const { name, expiresInDays } = parsed.data;
    // No expiresInDays (or null) means "never expires".
    const expiresAt = expiresInDays == null ? null : Date.now() + expiresInDays * DAY_MS;

    try {
      const issued = await issueMcpCredential(c.env.DB, { userId, audience, name, expiresAt });
      return c.json({ credential: freshSummary(issued), token: issued.token }, 201);
    } catch (err) {
      if (err instanceof McpApplicationError) return c.json({ error: "Could not issue this token" }, 400);
      throw err;
    }
  });

  router.post("/:id/revoke", async (c) => {
    const userId = c.get("user").id;
    const revoked = await revokeMcpCredential(c.env.DB, { id: c.req.param("id"), userId, audience });
    if (!revoked) return c.json({ error: "Token not found" }, 404);
    return c.json({ ok: true });
  });

  // Rotation preserves the token's name and, if it had one, the same
  // *relative* lifetime measured from now (e.g. a 30-day token rotates into
  // a fresh 30-day token) rather than the original absolute expiry.
  //
  // Ordering matters for safety: the predecessor is revoked FIRST, via the
  // same compare-and-swap UPDATE (`revoked_at IS NULL`) that a plain revoke
  // uses. That makes claiming it a mutex — only the request whose UPDATE
  // actually flips revoked_at may proceed to issue a replacement, so two
  // concurrent rotations (or a rotation racing a plain revoke) on the same
  // id can never both succeed. Issuing first and revoking after (the
  // previous implementation) let two concurrent callers both pass the
  // "not yet revoked" check before either revoked it, and a failure between
  // issuance and revocation left both records active. With revoke-first, a
  // failure after the claim (e.g. the replacement INSERT fails) instead
  // leaves the predecessor revoked and no replacement created — the caller
  // loses this credential and must create a new one, but at no point can
  // two credentials from the same rotation ever be active together.
  router.post("/:id/rotate", verifyHuman, async (c) => {
    const userId = c.get("user").id;
    const id = c.req.param("id");
    const existing = await getMcpCredentialOwned(c.env.DB, { id, userId, audience });
    if (!existing) return c.json({ error: "Token not found" }, 404);

    const claimed = await revokeMcpCredential(c.env.DB, { id, userId, audience });
    if (!claimed) return c.json({ error: "This token is already revoked" }, 409);

    const durationMs = existing.expiresAt !== null ? existing.expiresAt - existing.createdAt : null;
    const expiresAt = durationMs !== null ? Date.now() + durationMs : null;
    try {
      const issued = await issueMcpCredential(c.env.DB, { userId, audience, name: existing.name, expiresAt });
      return c.json({ credential: freshSummary(issued), token: issued.token }, 201);
    } catch {
      // The predecessor is already revoked and cannot be un-revoked from
      // here. Reporting failure (rather than a false 201) tells the caller
      // this credential is gone and a new one must be created — the safe
      // failure mode, unlike silently leaving two credentials active.
      return c.json({ error: "This token was revoked, but a replacement could not be issued. Create a new token instead." }, 500);
    }
  });

  return router;
}
