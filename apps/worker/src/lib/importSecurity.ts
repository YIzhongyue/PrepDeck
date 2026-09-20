export const IMPORT_BODY_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_JSON_MAX_DEPTH = 32;
export const D1_STATEMENTS_PER_BATCH = 50;

type ParsedBody =
  | { ok: true; raw: string; bytes: number; data: unknown }
  | { ok: false; status: 400 | 413; error: string };

function exceedsJsonDepth(raw: string, maxDepth: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of raw) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === "{" || character === "[") {
      if (++depth > maxDepth) return true;
    } else if (character === "}" || character === "]") depth--;
  }
  return false;
}

export async function parseJsonBody(request: Request): Promise<ParsedBody> {
  const contentLengthValue = request.headers.get("content-length");
  let declaredLength: number | undefined;
  if (contentLengthValue !== null) {
    if (!/^\d+$/.test(contentLengthValue)) {
      return { ok: false, status: 400, error: "Content-Length must be a valid non-negative integer" };
    }
    declaredLength = Number(contentLengthValue);
    if (!Number.isSafeInteger(declaredLength)) {
      return { ok: false, status: 400, error: "Content-Length is invalid" };
    }
    if (declaredLength > IMPORT_BODY_MAX_BYTES) {
      return { ok: false, status: 413, error: `Request body exceeds ${IMPORT_BODY_MAX_BYTES} bytes` };
    }
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > IMPORT_BODY_MAX_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413, error: `Request body exceeds ${IMPORT_BODY_MAX_BYTES} bytes` };
      }
      chunks.push(value);
    }
  }
  if (declaredLength !== undefined && declaredLength !== bytes) {
    return { ok: false, status: 400, error: "Content-Length does not match the request body" };
  }

  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    return { ok: false, status: 400, error: "Request body must be valid UTF-8 JSON" };
  }
  if (exceedsJsonDepth(raw, IMPORT_JSON_MAX_DEPTH)) {
    return { ok: false, status: 400, error: `JSON nesting must not exceed ${IMPORT_JSON_MAX_DEPTH} levels` };
  }
  try {
    return { ok: true, raw, bytes, data: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, error: "Request body must be valid UTF-8 JSON" };
  }
}

export async function runD1Batches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let start = 0; start < statements.length; start += D1_STATEMENTS_PER_BATCH) {
    await db.batch(statements.slice(start, start + D1_STATEMENTS_PER_BATCH));
  }
}

// implementation — Admin MCP's import tools receive `file` already parsed by the
// JSON-RPC layer (unlike REST's parseJsonBody, which can scan raw text before
// parsing), so the same nesting-depth protection has to walk the parsed
// value's structure instead of the source text. Thrown, not returned, so
// call sites can treat it like any other validation failure.
export class ExcessiveNestingError extends Error {}

export function assertBoundedDepth(value: unknown, maxDepth: number, depth = 0): void {
  if (depth > maxDepth) throw new ExcessiveNestingError(`JSON nesting must not exceed ${maxDepth} levels`);
  if (Array.isArray(value)) {
    for (const item of value) assertBoundedDepth(item, maxDepth, depth + 1);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) assertBoundedDepth(item, maxDepth, depth + 1);
  }
}
