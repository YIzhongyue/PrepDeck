import type { Env } from "../../../bindings";
import type { McpPrincipal } from "../../credentials";
import { McpApplicationError } from "../../errors";
import { examExists } from "../../../lib/examManagement";
import { consumeRateLimit, configuredLimit } from "../../../middleware/rateLimit";

// What every User MCP operation module closes over: the credential's own
// user (never a caller-supplied id) and the account's write quotas.
export type UserAdapterContext = ReturnType<typeof createUserAdapterContext>;

export function createUserAdapterContext(principal: McpPrincipal, env: Env) {
  const db = env.DB;
  const userId = principal.userId;

  async function requireExam(examId: string): Promise<void> {
    if (!(await examExists(db, examId))) throw new McpApplicationError("not_found");
  }

  // Separate from reads and Knowledge Point writes, shared across all tokens
  // for this account. Consume before service calls (including stale cleanup).
  async function consumeStudyWriteLimit(): Promise<void> {
    const max = configuredLimit(env.MCP_STUDY_WRITE_RATE_LIMIT_PER_MINUTE, 30);
    const result = await consumeRateLimit(env, `mcp:user:${userId}:study-write`, { windowSeconds: 60, max }).catch(() => null);
    if (!result) throw new McpApplicationError("unavailable", { retryAfter: 30 });
    if (!result.allowed) throw new McpApplicationError("rate_limited", { retryAfter: result.retryAfter });
  }

  // implementation — a second, KP-mutation-specific write quota, distinct from
  // the blanket per-account MCP request quota already applied to every call
  // (including reads) in mcp/routes.ts. Fails closed: an unavailable limiter
  // blocks the write rather than silently allowing it. implementation — max is
  // deployment-configurable via MCP_KP_WRITE_RATE_LIMIT_PER_MINUTE; default
  // matches the original fixed value.
  async function consumeKnowledgePointWriteLimit(): Promise<void> {
    const max = configuredLimit(env.MCP_KP_WRITE_RATE_LIMIT_PER_MINUTE, 30);
    const result = await consumeRateLimit(env, `mcp:user:${userId}:kp-write`, { windowSeconds: 60, max }).catch(() => null);
    // implementation — distinguish "this limiter is unreachable" from an
    // unrelated application failure, and carry the limiter's own
    // retryAfter through to the caller instead of discarding it.
    if (!result) throw new McpApplicationError("unavailable");
    if (!result.allowed) throw new McpApplicationError("rate_limited", { retryAfter: result.retryAfter });
  }

  return { db, env, userId, requireExam, consumeStudyWriteLimit, consumeKnowledgePointWriteLimit };
}
