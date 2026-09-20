import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";

export const MAX_PAGE_SIZE = 100;
export const paginationSchema = z.strictObject({
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  offset: z.number().int().min(0).max(100_000).default(0),
});

/** Query at most limit + 1 rows after applying authorization and filters. */
export function pageResult<T>(rows: T[], page: z.infer<typeof paginationSchema>) {
  const { limit, offset } = paginationSchema.parse(page);
  return {
    items: rows.slice(0, limit),
    nextOffset: rows.length > limit && offset + limit <= 100_000 ? offset + limit : null,
  };
}

export function toolResult(body: Record<string, unknown>, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, ...(isError ? { isError: true } : {}) };
}
