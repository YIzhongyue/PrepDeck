import type { McpAudience, McpPrincipal } from "../credentials";
import { McpApplicationError } from "../errors";
import { pageResult } from "../conventions";
import { EXAM_QUESTION_SCAN_LIMIT } from "../../lib/questionManagement";
import { stemPreview } from "../../lib/questionQuality";
import type { StudyMutationResult } from "../../lib/studyMutationResult";

// Pieces shared by the User and Admin MCP service adapters.

/** Identity-bound service adapter. Add narrowly named application service
 * operations here as business catalogs are implemented. Those operations
 * must close over this principal and call canonical service logic; never
 * proxy HTTP, accept an effective userId, or expose raw DB/SQL to tools.
 */
export function identityAdapter(principal: McpPrincipal, audience: McpAudience) {
  if (principal.audience !== audience) throw new McpApplicationError("unauthorized");
  const userId = principal.userId;
  return Object.freeze({
    getIdentity: () => ({ userId, server: audience }),
  });
}

export function studyMutationData<T>(result: StudyMutationResult<T>): T {
  if (!result.ok) throw new McpApplicationError(result.reason, { studyReason: result.detail });
  return result.data;
}

export interface Page { limit: number; offset: number }

// Bounded/paginated result envelope shared by every list-returning admin
// tool below, built on conventions.ts's pageResult() so every tool's
// output has the same {items, nextOffset} shape. pageResult() itself
// assumes `rows` is already windowed by `offset` (its own doc comment:
// "Query at most limit + 1 rows after applying authorization and
// filters") — true for the SQL-paginated tools (getRecentContentChanges,
// listTags), which query `LIMIT limit + 1 OFFSET offset` and can pass
// their rows straight through.
export function page<T>(rows: T[], input: Page, extra?: Record<string, unknown>) {
  const { items, nextOffset } = pageResult(rows, { limit: input.limit, offset: input.offset });
  return { items, nextOffset, ...extra };
}

// The find_* quality tools instead scan a whole exam and filter in memory,
// so their `matches` array starts at index 0 regardless of `offset`. Window
// it to the same `limit + 1` slice an equivalent SQL query would have
// returned before handing it to page(), or `offset` would be silently
// ignored and every page past the first would repeat page one.
export function pageInMemory<T>(rows: T[], input: Page, extra?: Record<string, unknown>) {
  return page(rows.slice(input.offset, input.offset + input.limit + 1), input, extra);
}

// Trimmed, list-friendly view of a question — full content is available via
// admin_get_question. Keeps find_* results compact for an MCP client.
export function summarize(q: { id: string; examId: string; externalId: string | null; sequenceNumber: number; type: string; stem: string; updatedAt: string }) {
  return {
    id: q.id, examId: q.examId, externalId: q.externalId, sequenceNumber: q.sequenceNumber,
    type: q.type, stemPreview: stemPreview(q.stem), updatedAt: q.updatedAt,
  };
}

export function scanMeta(scannedCount: number) {
  return { scannedCount, truncated: scannedCount >= EXAM_QUESTION_SCAN_LIMIT };
}
