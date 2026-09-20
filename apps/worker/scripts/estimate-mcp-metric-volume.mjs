import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Exercise the actual emitter, without Workers bindings, business storage or
// remote calls. Analytics Engine ingestion is NOT sampled by Workers Logs.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/mcp/observability.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "node", write: false,
});
const { McpObservation } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const requests = 100_000;
const scenarios = [];
for (const scenario of ["tool_call", "auth_reject", "circuit_reject"]) {
  let points = 0, bytes = 0, maxPointBytes = 0;
  const env = { MCP_METRICS: { writeDataPoint(point) {
    const size = Buffer.byteLength(JSON.stringify(point));
    points++; bytes += size; maxPointBytes = Math.max(maxPointBytes, size);
  } } };
  if (scenario === "circuit_reject") env.CIRCUIT_MODE = "emergency";
  for (let i = 0; i < requests; i++) {
    const observation = new McpObservation(env, "admin");
    if (scenario === "tool_call") {
      observation.auth = "success";
      observation.stage = "protocol";
      observation.protocol('{"method":"tools/call"}');
      // Longest current catalog name; latency capped at one hour, slow flag set.
      observation.tool("admin_find_questions_with_invalid_answer_references",
        { content: [], structuredContent: { ok: true, data: {} } }, performance.now() - 3_600_001);
      observation.protocolResponse({}, "json");
    } else if (scenario === "auth_reject") {
      observation.stage = "auth";
      observation.auth = "invalid_or_expired_or_revoked";
    }
    observation.finish(scenario === "tool_call" ? 200 : scenario === "auth_reject" ? 401 : 503);
  }
  scenarios.push({ scenario, requests, points, jsonBytes: bytes, maxPointBytes,
    bytesPerRequest: Math.ceil(bytes / requests), pointsPerRequest: points / requests });
}
console.log(JSON.stringify({ channel: "analytics_engine", workersLogsHeadSampleApplied: false, scenarios }, null, 2));
if (scenarios.some((s) => s.maxPointBytes >= 512 || s.bytesPerRequest >= 1024)) process.exitCode = 1;
