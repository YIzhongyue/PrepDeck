import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { createMcpCredentialRequestSchema } from "./mcp.schema.ts";

// The route's 400 message for `body` (the first issue's; see apps/worker/src/lib/requestBody.ts), or null when it is accepted.
function error(schema: z.ZodType, body: unknown): string | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]!.message;
}

const data = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => schema.parse(body);

test("MCP tokens: a trimmed name and an optional lifetime", () => {
  assert.deepEqual(data(createMcpCredentialRequestSchema, { name: "  laptop " }), { name: "laptop" });
  assert.deepEqual(data(createMcpCredentialRequestSchema, { name: "laptop", expiresInDays: null }), { name: "laptop", expiresInDays: null });
  for (const name of [undefined, "   ", "n".repeat(101), 5]) {
    assert.equal(error(createMcpCredentialRequestSchema, { name }), "name is required (1-100 characters)");
  }
  for (const expiresInDays of [0, 3651, 1.5, "30"]) {
    assert.equal(error(createMcpCredentialRequestSchema, { name: "laptop", expiresInDays }), "expiresInDays must be an integer between 1 and 3650");
  }
});
