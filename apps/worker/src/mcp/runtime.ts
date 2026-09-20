import { createMcpHandler, type Server } from "@modelcontextprotocol/server";
import { McpApplicationError, errorEnvelope, type McpErrorCode } from "./errors";
import type { McpObservation } from "./observability";

export const MAX_MCP_BODY_BYTES = 64 * 1024;

/** Read streams with a real byte bound, including chunked/lying-length
 * requests, then decode with a *fatal* UTF-8 decoder (matching
 * lib/importSecurity.ts's parseJsonBody) so malformed byte sequences are
 * rejected outright rather than silently replaced — implementation's admin body
 * cap raises maxBytes up to 5 MB for import tools, so this endpoint needs the
 * same strictness REST imports already have, not just a bigger ceiling. */
export async function readMcpBody(request: Request, maxBytes = MAX_MCP_BODY_BYTES): Promise<string> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new McpApplicationError("invalid_input");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new McpApplicationError("invalid_input");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new McpApplicationError("invalid_input");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    throw new McpApplicationError("invalid_input");
  }
}

// The SDK can include rejected input in protocol errors. Replace those
// messages/data with fixed values, preserving JSON-RPC ids and numeric codes.
function sanitizeMessage(message: Record<string, unknown>) {
  if (message.error && typeof message.error === "object") {
    const numericCode = (message.error as { code?: number }).code ?? -32603;
    const code: McpErrorCode = numericCode === -32601 ? "not_found"
      : [-32700, -32600, -32602].includes(numericCode) ? "invalid_input" : "internal";
    const { error } = errorEnvelope(new McpApplicationError(code));
    return { ...message, error: { code: numericCode, message: error.message, data: error } };
  }
  return message;
}

export async function serveMcp(request: Request, factory: () => Server, maxBodyBytes?: number, observation?: McpObservation): Promise<Response> {
  const body = await readMcpBody(request, maxBodyBytes);
  observation?.protocol(body);
  // Both modern and legacy requests receive a fresh server bound to the
  // current credential. No shared sessions or principal captured globally.
  const handler = createMcpHandler(factory, {
    responseMode: "auto", legacy: "stateless", maxSubscriptions: 0, keepAliveMs: 0,
    onerror: () => { /* Raw SDK exceptions may contain credentials or private input. */ },
  });
  try {
    const headers = new Headers(request.headers);
    // The SDK never needs the bearer secret or browser credentials.
    headers.delete("Authorization");
    headers.delete("Cookie");
    headers.delete("Cf-Access-Jwt-Assertion");
    const response = await handler.fetch(new Request(request.url, { method: "POST", headers, body }));
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.delete("Content-Length");
    if (!response.body) return new Response(null, { status: response.status, headers: responseHeaders });
    const text = await response.text();
    const contentType = response.headers.get("Content-Type") ?? "";
    let safeText: string;
    const sanitize = (data: string, transport: "json" | "sse") => {
      const message = sanitizeMessage(JSON.parse(data));
      observation?.protocolResponse(message, transport);
      return JSON.stringify(message);
    };
    if (contentType.includes("application/json")) {
      safeText = sanitize(text, "json");
    } else if (contentType.includes("text/event-stream")) {
      // Legacy transport emits a finite SSE response containing the result.
      // No streaming tools/subscriptions are advertised by this foundation.
      safeText = text.replace(/^data: (.+)$/gm, (_line, data: string) => `data: ${sanitize(data, "sse")}`);
    } else {
      throw new McpApplicationError("internal");
    }
    // Even a caller that places its bearer token in a JSON-RPC id must not
    // cause the token to be reflected in a response/error.
    const token = request.headers.get("Authorization")?.slice(7);
    if (token) safeText = safeText.replaceAll(token, "[REDACTED]");
    return new Response(safeText, { status: response.status, headers: responseHeaders });
  } finally {
    await handler.close();
  }
}
