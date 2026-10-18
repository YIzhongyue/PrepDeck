// REST counterpart of defineMcpTool's input validation (mcp/catalog.ts): a
// request body is parsed with a zod schema, and a failure answers with the
// 400 `{ error }` these routes have always returned. The message is the first
// issue's, so every schema used here sets its own messages — including its
// root object's, which answers a body that is missing, not JSON, or not an
// object (most schemas in @prepdeck/shared/schemas).

import type { Context } from "hono";
import { z } from "zod";

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Validates an already-read body. */
export function validateBody<S extends z.ZodType>(c: Context, schema: S, body: unknown): BodyResult<z.output<S>> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, response: c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, 400) };
}

/** Reads the JSON request body and validates it; a body that is not JSON is validated as null. */
export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<BodyResult<z.output<S>>> {
  return validateBody(c, schema, await c.req.json().catch(() => null));
}

const uncheckedObject = z.record(z.string(), z.unknown()).catch(() => ({}));

/**
 * Reads a JSON object body without checking its fields, for a service that
 * checks them itself because User MCP shares it (the knowledge point group
 * and tag names). Anything but an object reads as {}.
 */
export async function readUncheckedBody(c: Context): Promise<Record<string, unknown>> {
  return uncheckedObject.parse(await c.req.json().catch(() => null));
}
