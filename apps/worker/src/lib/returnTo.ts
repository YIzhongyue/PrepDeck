// Where to land after Google sign-in (issues #41 and #52): a daily review email
// link, or the screen a learner was on when their session expired. It travels
// in the short-lived OAuth state cookie and is only ever a same-origin path, so
// the sign-in flow cannot be used as an open redirect.

const MAX_RETURN_TO_LENGTH = 2048;
// Paths the Worker serves itself; landing on them after sign-in is never
// the intent, and an API URL would render raw JSON.
const RESERVED_PREFIXES = ["/api/", "/mcp", "/admin-mcp", "/cdn-cgi/"];

/** A validated same-origin relative path (with query), or null. */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > MAX_RETURN_TO_LENGTH) return null;
  // One leading slash, no scheme-relative "//host" or "/\host", and nothing a
  // browser would normalise into another origin (backslashes, control chars).
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try { url = new URL(value, "https://prepdeck.invalid"); } catch { return null; }
  if (url.origin !== "https://prepdeck.invalid") return null;
  if (RESERVED_PREFIXES.some((prefix) => url.pathname === prefix.replace(/\/$/, "") || url.pathname.startsWith(prefix))) return null;
  // Drop a fragment and any `auth` flag: the flag is how the callback reports
  // failures, never something to replay after a success.
  url.searchParams.delete("auth");
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}`;
}
