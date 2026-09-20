// Models the byte cost of the one application-level log record this Worker
// actually emits today (apps/worker/src/routes/ai.ts's logAiFailure). There
// is deliberately no scenario here for auth/404/429 aggregate counters or an
// audit sink — nothing in the codebase produces those events yet (see
// docs/operations/observability-runbook.md's "Not yet implemented" section). Extend
// this file only when a corresponding code path actually ships.

const REQUESTS_PER_SCENARIO = 100_000;
const PRODUCTION_HEAD_SAMPLE = 0.05;

const compactBytes = (record) => Buffer.byteLength(JSON.stringify(record) + "\n", "utf8");

const scenarios = [
  {
    // Worst case of the two reasons logAiFailure can emit: "http_error" adds
    // a numeric status that "empty_content" (status: null) doesn't.
    name: "AI upstream failures",
    records: REQUESTS_PER_SCENARIO * PRODUCTION_HEAD_SAMPLE,
    record: { event: "ai.upstream_failure", provider: "anthropic", reason: "http_error", status: 503 },
    maximumBytesPerRequest: 32,
  },
];

console.log("Scenario                         Record B   Emitted B   B/request");
for (const scenario of scenarios) {
  const recordBytes = compactBytes(scenario.record);
  const emittedBytes = recordBytes * scenario.records;
  const bytesPerRequest = emittedBytes / REQUESTS_PER_SCENARIO;
  console.log(
    `${scenario.name.padEnd(32)} ${String(recordBytes).padStart(8)} ${String(emittedBytes).padStart(11)} ${bytesPerRequest.toFixed(4).padStart(11)}`,
  );
  if (recordBytes >= 512) throw new Error(`${scenario.name}: record is ${recordBytes} bytes (limit: 511)`);
  if (bytesPerRequest >= scenario.maximumBytesPerRequest) {
    throw new Error(`${scenario.name}: ${bytesPerRequest} bytes/request exceeds budget`);
  }
}
