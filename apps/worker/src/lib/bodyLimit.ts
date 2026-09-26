import { bodyLimit } from "hono/body-limit";

// Defense in depth for the small JSON routes (issue #45): notes, annotations
// and attempt answers. Their fields have their own length limits, but a body is
// parsed before any field is checked, so an oversized request is refused here,
// from Content-Length or while streaming, before it is buffered and parsed.
// Imports, uploads and the AI proxy keep their own, larger limits.
export const JSON_BODY_MAX_BYTES = 64 * 1024;

export const jsonBodyLimit = bodyLimit({
  maxSize: JSON_BODY_MAX_BYTES,
  onError: (c) => c.json({ error: `Request body exceeds ${JSON_BODY_MAX_BYTES} bytes` }, 413),
});
