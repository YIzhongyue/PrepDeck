// implementation — self-service MCP token lifecycle. This same factory backs two
// mounts in index.ts: /api/mcp-tokens (User MCP, any authenticated user
// manages their own tokens) and /api/admin/mcp-tokens (Admin MCP, gated by
// requireAdmin below). Each caller only ever sees/manages their own
// credentials for that audience — an admin's Admin MCP tokens are personal
// access tokens bound to their own account, not a shared service credential.

import { Hono } from "hono";
import { MCP_TOKEN_MAX_EXPIRES_IN_DAYS, MCP_TOKEN_NAME_MAX_LENGTH, type McpCredentialSummary } from "@prepdeck/shared";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import { requireAdmin } from "../middleware/admin";
import {
  getMcpCredentialOwned, issueMcpCredential, listMcpCredentials, revokeMcpCredential, type McpAudience,
} from "../mcp/credentials";
import { McpApplicationError } from "../mcp/errors";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > MCP_TOKEN_NAME_MAX_LENGTH) return null;
  return name;
}

// `undefined`/`null` means "never expires". Any other non-integer or
// out-of-range value is rejected outright.
function parseExpiresInDays(raw: unknown): { ok: true; expiresAt: number | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, expiresAt: null };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > MCP_TOKEN_MAX_EXPIRES_IN_DAYS) return { ok: false };
  return { ok: true, expiresAt: Date.now() + raw * DAY_MS };
}

function freshSummary(issued: { id: string; name: string; createdAt: number; expiresAt: number | null }): McpCredentialSummary {
  return {
    id: issued.id, name: issued.name, createdAt: issued.createdAt, expiresAt: issued.expiresAt,
    lastUsedAt: null, revokedAt: null, status: "active",
  };
}

export function createMcpTokensRouter(audience: McpAudience) {
  const router = new Hono<{ Bindings: Env; Variables: Variables }>();
  if (audience === "admin") router.use("*", requireAdmin);

  router.get("/", async (c) => {
    const userId = c.get("user").id;
    const credentials = await listMcpCredentials(c.env.DB, userId, audience);
    return c.json({ credentials });
  });

  router.post("/", async (c) => {
    const userId = c.get("user").id;
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "Invalid JSON body" }, 400);
    const name = parseName((body as Record<string, unknown>).name);
    if (!name) return c.json({ error: `name is required (1-${MCP_TOKEN_NAME_MAX_LENGTH} characters)` }, 400);
    const expiry = parseExpiresInDays((body as Record<string, unknown>).expiresInDays);
    if (!expiry.ok) return c.json({ error: `expiresInDays must be an integer between 1 and ${MCP_TOKEN_MAX_EXPIRES_IN_DAYS}` }, 400);

    try {
      const issued = await issueMcpCredential(c.env.DB, { userId, audience, name, expiresAt: expiry.expiresAt });
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
  router.post("/:id/rotate", async (c) => {
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
