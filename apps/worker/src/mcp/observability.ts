import type { MiddlewareHandler } from "hono";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { Env } from "../bindings";
import type { Variables } from "../context";
import type { McpAudience } from "./credentials";
import { MCP_ERRORS, type McpErrorCode } from "./errors";

export type McpAuthOutcome = "not_attempted" | "success" | "missing" | "malformed"
  | "wrong_audience" | "invalid_or_expired_or_revoked" | "account_not_authorized" | "internal";
type Stage = "circuit" | "ip_limit" | "routing" | "origin" | "auth" | "method" | "account_limit" | "protocol";
type Outcome = "success" | "error" | "partial" | "failed" | "skipped" | "replayed";
type ErrorCode = McpErrorCode | "none" | "method_not_allowed";
const METHODS = ["initialize", "server/discover", "notifications/initialized", "ping", "tools/list", "tools/call"] as const;
type Method = typeof METHODS[number] | "unknown" | "not_dispatched";

// Code-owned names only, checked after catalog lookup. Validation/preview tools
// are deliberately excluded: these outcomes describe content mutation calls.
const ADMIN_MUTATIONS = new Set([
  "admin_create_question", "admin_update_question", "admin_delete_question",
  "admin_batch_create_questions", "admin_batch_update_questions",
  "admin_create_exam", "admin_update_exam", "admin_archive_exam", "admin_execute_import",
  "admin_create_tag", "admin_update_tag", "admin_merge_tags",
]);
export const MAX_MCP_TOOL_METRICS = 32;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function errorCode(value: unknown): McpErrorCode {
  return typeof value === "string" && Object.hasOwn(MCP_ERRORS, value) ? value as McpErrorCode : "internal";
}

function duration(start: number) {
  return Math.min(3_600_000, Math.max(0, Math.round(performance.now() - start)));
}

/** One request-scoped collector, no identities, raw strings or business storage.
 * Dataset writes are synchronous enqueue operations, independent of Workers Logs
 * head sampling. Missing/disabled/failed telemetry must not change MCP behavior.
 * See docs/operations/mcp-observability.md for the versioned positional schema.
 */
export class McpObservation {
  stage: Stage = "circuit";
  auth: McpAuthOutcome = "not_attempted";
  private method: Method = "not_dispatched";
  private outcome: Outcome = "success";
  private error: ErrorCode = "none";
  private transport: "none" | "json" | "sse" = "none";
  private readonly start = performance.now();
  private toolPoints = 0;
  private omittedTools = 0;
  private finished = false;
  private sink?: AnalyticsEngineDataset;
  private readonly mode: "normal" | "degraded" | "emergency";

  constructor(env: Env, private readonly audience: McpAudience) {
    this.sink = env.MCP_METRICS;
    this.mode = !env.CIRCUIT_MODE || env.CIRCUIT_MODE === "normal" ? "normal"
      : env.CIRCUIT_MODE === "degraded" ? "degraded" : "emergency";
  }

  protocol(body: string) {
    // The body has already passed the transport byte bound. Keep only a closed
    // method enum; never retain/log parsed arguments, ids, or unknown methods.
    this.method = "unknown";
    try {
      const method = record(JSON.parse(body)).method;
      if (METHODS.some((candidate) => candidate === method)) this.method = method as Method;
    } catch { /* SDK owns validation and the outward response. */ }
  }

  protocolResponse(message: unknown, transport: "json" | "sse") {
    this.transport = transport;
    const error = record(record(message).error);
    if (Object.keys(error).length) this.failure(errorCode(record(error.data).code));
  }

  private failure(code: ErrorCode) {
    this.outcome = "error";
    // Preserve the first tool/protocol error if a future transport batches calls.
    if (this.error === "none") this.error = code;
  }

  tool(registeredName: string | undefined, result: CallToolResult, start: number) {
    const name = registeredName ?? "unknown";
    const mutation = this.audience === "admin" && ADMIN_MUTATIONS.has(name);
    const body = record(result.structuredContent);
    const code = result.isError || body.ok === false ? errorCode(record(body.error).code) : "none";
    let outcome: Outcome = code === "none" ? "success" : "error";
    // Only inspect fixed summary fields/status enums, never copy the payload.
    // These count *reported* item outcomes, not committed writes (see D1 audit).
    const counts: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0]; // created, updated, skipped, failed, conflict, replayed
    if (mutation && code === "none") {
      const data = record(body.data);
      if (data.idempotentReplay === true) {
        outcome = "replayed";
      } else if (Array.isArray(data.outcomes)) {
        for (const item of data.outcomes) {
          const { status, reason } = record(item);
          if (reason === "idempotent_replay" || reason === "idempotent_replay_deleted_since") {
            counts[5] = Math.min(10_000, counts[5]! + 1);
            continue;
          }
          const index = typeof status === "string" ? ["created", "updated", "skipped", "failed", "conflict"].indexOf(status) : -1;
          if (index >= 0) counts[index] = Math.min(10_000, counts[index]! + 1);
        }
        const [created, updated, skipped, failed, conflict, replayed] = counts;
        if (failed + skipped + conflict > 0) {
          outcome = created + updated + replayed > 0 ? "partial" : failed > 0 ? "failed" : "skipped";
        } else if (replayed > 0 && created + updated === 0) {
          outcome = "replayed";
        }
      }
    }
    if (code !== "none") this.failure(code);
    else if (this.outcome !== "error" && outcome !== "success") this.outcome = outcome;
    if (this.toolPoints >= MAX_MCP_TOOL_METRICS) { this.omittedTools++; return; }
    this.toolPoints++;
    this.write("tool", name, outcome, code, mutation ? "admin_mutation" : "other", duration(start), 0, counts);
  }

  finish(status: number) {
    if (this.finished) return;
    this.finished = true;
    if (status >= 400) {
      const code: ErrorCode = status === 405 ? "method_not_allowed"
        : (Object.entries(MCP_ERRORS).find(([, value]) => value.status === status)?.[0] as McpErrorCode | undefined) ?? "internal";
      this.failure(code);
    }
    this.write("request", "none", this.outcome, this.error, "none", duration(this.start), status, [0, 0, 0, 0, 0, 0]);
  }

  private write(event: "request" | "tool", tool: string, outcome: Outcome, error: ErrorCode,
    kind: "none" | "other" | "admin_mutation", elapsed: number, status: number, counts: number[]) {
    if (!this.sink) return;
    try {
      this.sink.writeDataPoint({
        indexes: [this.audience],
        blobs: ["mcp.v1", event, this.audience, this.method, tool, outcome, error, this.auth,
          event === "tool" ? "tool" : this.stage, kind, this.mode, event === "tool" ? "none" : this.transport],
        doubles: [1, elapsed, status, elapsed >= 1000 ? 1 : 0, ...counts, event === "request" ? this.omittedTools : 0],
      });
    } catch {
      // Do not recursively log a sink failure or retry on the request path.
      this.sink = undefined;
    }
  }
}

export const observeMcp: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  if (c.env.MCP_METRICS_ENABLED !== "true" || !c.env.MCP_METRICS) return next();
  const observation = new McpObservation(c.env, c.req.path.startsWith("/admin-mcp") ? "admin" : "user");
  c.set("mcpObservation", observation);
  try { await next(); }
  catch (error) { observation.finish(500); throw error; }
  finally { observation.finish(c.res.status); }
};
