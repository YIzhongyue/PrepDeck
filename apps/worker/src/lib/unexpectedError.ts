import type { Context } from "hono";

export const UNEXPECTED_ERROR_MESSAGE = "Something went wrong on the server. Please try again.";

// An unhandled error (a D1 failure such as SQLITE_TOOBIG, say) used to reach
// the client as Hono's plain-text 500, which apiFetch cannot read (issue #45).
// It now answers in the JSON error shape every handled error uses, without
// internals. The log line has a fixed shape and a bounded message: no request
// body, headers or user identifiers.
export function handleUnexpectedError(err: Error, c: Context): Response {
  // An HTTPException (from bodyLimit or a route) carries its own response.
  // Duck-typed, as Hono's default handler does, so it holds across bundles.
  if ("getResponse" in err && typeof err.getResponse === "function") return err.getResponse() as Response;
  console.error("api.unhandled_error", { method: c.req.method, route: c.req.routePath, name: err.name, message: err.message.slice(0, 200) });
  return c.json({ error: UNEXPECTED_ERROR_MESSAGE }, 500);
}
