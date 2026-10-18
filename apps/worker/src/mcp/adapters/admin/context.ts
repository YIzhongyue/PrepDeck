import type { Env } from "../../../bindings";
import type { McpPrincipal } from "../../credentials";
import { McpApplicationError } from "../../errors";
import { examExists } from "../../../lib/examManagement";
import {
  EXAM_QUESTION_SCAN_LIMIT, getQuestion as getQuestionRow, listQuestions as listQuestionRows, toQuestion,
} from "../../../lib/questionManagement";
import { assertBoundedDepth, IMPORT_JSON_MAX_DEPTH } from "../../../lib/importSecurity";
import { consumeRateLimit, configuredLimit } from "../../../middleware/rateLimit";

// What every Admin MCP operation module closes over: the admin principal,
// existence checks and the content-mutation quota.
export type AdminAdapterContext = ReturnType<typeof createAdminAdapterContext>;

export function createAdminAdapterContext(principal: McpPrincipal, env: Env) {
  const db = env.DB;

  async function requireExam(examId: string): Promise<void> {
    if (!(await examExists(db, examId))) throw new McpApplicationError("not_found");
  }

  async function requireQuestion(examId: string, questionId: string) {
    const row = await getQuestionRow(db, examId, questionId);
    if (!row) throw new McpApplicationError("not_found");
    return row;
  }

  // implementation — a stricter, mutation-specific write quota for Admin MCP,
  // distinct from the blanket per-account request quota already applied to
  // every call (including reads) in mcp/routes.ts. Content mutations are the
  // highest-blast-radius operation this surface exposes, so they get a
  // tighter budget than reads. Imports already have their own native
  // Cloudflare rate limiters (IMPORT_VALIDATE_RATE_LIMITER/
  // IMPORT_EXECUTE_RATE_LIMITER, consumed further below) and are exempt from
  // this one. Fails closed: an unavailable limiter blocks the mutation
  // rather than silently allowing it. One call to this consumes one unit
  // regardless of how many items a batch tool's call mutates.
  async function consumeAdminMutationLimit(): Promise<void> {
    const max = configuredLimit(env.MCP_ADMIN_MUTATION_RATE_LIMIT_PER_MINUTE, 10);
    const result = await consumeRateLimit(env, `mcp:admin:${principal.userId}:mutation`, { windowSeconds: 60, max }).catch(() => null);
    // implementation — same distinction/retryAfter propagation as
    // consumeKnowledgePointWriteLimit above.
    if (!result) throw new McpApplicationError("unavailable");
    if (!result.allowed) throw new McpApplicationError("rate_limited", { retryAfter: result.retryAfter });
  }

  // Full in-scope question set for the quality-control/statistics tools,
  // which need every matching row (not a single page) to compute
  // deterministic checks. Bounded by EXAM_QUESTION_SCAN_LIMIT. Active
  // questions only (see listQuestions).
  async function loadExamQuestions(examId: string) {
    const rows = await listQuestionRows(db, { examId, limit: EXAM_QUESTION_SCAN_LIMIT });
    return rows.map(toQuestion);
  }

  return { db, env, principal, requireExam, requireQuestion, consumeAdminMutationLimit, loadExamQuestions };
}

// assertBoundedDepth throws a plain ExcessiveNestingError (see
// lib/importSecurity.ts) — remapped here to invalid_input so it surfaces to
// the caller as a normal validation failure rather than falling through
// defineMcpTool's catch-all to "internal".
export function assertImportFileDepth(file: unknown): void {
  try {
    assertBoundedDepth(file, IMPORT_JSON_MAX_DEPTH);
  } catch {
    throw new McpApplicationError("invalid_input");
  }
}
