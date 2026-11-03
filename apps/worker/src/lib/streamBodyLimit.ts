import type { MiddlewareHandler } from "hono";

/** Bound bytes read even when Content-Length is absent or inaccurate. */
export function streamBodyLimit(maxBytes: number, message: string): MiddlewareHandler {
  return async (c, next) => {
    if (Number(c.req.header("content-length")) > maxBytes) return c.json({ error: message }, 413);
    const reader = c.req.raw.body?.getReader();
    if (!reader) return next();
    // A fixed buffer also bounds overhead when a sender uses tiny chunks.
    const bytes = new Uint8Array(maxBytes);
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.byteLength > maxBytes) {
          await reader.cancel();
          return c.json({ error: message }, 413);
        }
        bytes.set(value, size);
        size += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    c.req.raw = new Request(c.req.raw, { body: bytes.subarray(0, size) });
    return next();
  };
}
