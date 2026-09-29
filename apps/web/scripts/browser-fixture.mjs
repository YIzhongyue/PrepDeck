// Shared pieces of the *.browser.mjs fixture servers and their waits (issue #83).

// A request body, parsed the way its Content-Type says. The fixtures used to
// JSON.parse every body, so the form POST that starts sign-in (issue #82)
// threw inside the request handler and took the whole fixture server down
// with a SyntaxError that said nothing about which request sent it.
export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const raw = Buffer.concat(chunks);
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const text = type.startsWith("image/") || type === "application/octet-stream" ? "" : raw.toString("utf8");
  if (type === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(text);
    return { raw, text, form, payload: Object.fromEntries(form) };
  }
  const declaredJson = type === "application/json" || type.endsWith("+json");
  // fetch() labels a bare string body text/plain, and an upload of a file the
  // browser cannot type has none: those are read as JSON only if they are.
  if ((declaredJson || type === "" || type === "text/plain") && text.trim()) {
    try {
      return { raw, text, payload: JSON.parse(text) };
    } catch {
      // Declared JSON that is not is the app's bug, so it is reported, with
      // the request that sent it, rather than parsed into something.
      if (declaredJson) throw new Error(`${req.method} ${req.url} sent a body labelled ${type} that is not JSON: ${text.slice(0, 80)}`);
    }
  }
  return { raw, text, payload: {} };
}

// Polls `read` until `until` accepts what it returns, and on a timeout says
// what it last read. A bare 30 s waitForFunction reports only that it timed
// out, which for a chain like "load settings, save the zone, update the
// provider" does not say which link broke. `describe` adds context, such as
// the fixture's request log, to the failure.
export async function waitUntil(label, read, { until = Boolean, timeout = 10_000, interval = 50, describe } = {}) {
  const deadline = Date.now() + timeout;
  let last, error;
  for (;;) {
    try {
      last = await read();
      error = undefined;
      if (until(last)) return last;
    } catch (caught) {
      error = caught;
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  const seen = error ? `reading it threw ${error.message}` : `it last read ${show(last)}`;
  const context = describe ? `\n${await Promise.resolve().then(describe).then(show, caught => `(describe failed: ${caught.message})`)}` : "";
  throw new Error(`Timed out after ${timeout} ms waiting for ${label}; ${seen}${context}`);
}

function show(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}
