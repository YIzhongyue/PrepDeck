// The two MCP catalogs and the conventions every tool follows: tool names
// and behavioral hints, protocol versions, pagination and error shapes.
// The harness is mcp-foundation-fixture.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import {
  worker, paginationSchema, pageResult, defineMcpTool, McpApplicationError, fixture, rpc, USER_TOOL_NAMES,
  ADMIN_TOOL_NAMES, payload,
} from "./mcp-foundation-fixture.mjs";

const { z } = await import("zod");

// Independent wire-contract expectations. Review these alongside handler
// changes: a name prefix alone does not describe side effects or safe retries.
const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const MUTATION_ANNOTATIONS = {
  // [destructive, idempotent]; all operate inside the PrepDeck instance.
  user_start_practice: [true, false],
  user_submit_practice_answer: [false, true],
  user_complete_practice: [false, true],
  user_set_learning_progress: [true, true],
  user_create_knowledge_point: [false, false],
  user_update_knowledge_point: [true, true],
  user_delete_knowledge_point: [true, true],
  user_link_knowledge_point_question: [false, true],
  user_unlink_knowledge_point_question: [true, true],
  user_create_knowledge_point_group: [false, true],
  user_rename_knowledge_point_group: [true, false],
  user_delete_knowledge_point_group: [true, false],
  user_create_knowledge_point_tag: [false, true],
  user_rename_knowledge_point_tag: [true, false],
  user_delete_knowledge_point_tag: [true, true],
  user_unlink_knowledge_point_tag: [true, true],
  user_reorder_knowledge_points: [true, true],
  admin_create_question: [false, true],
  admin_update_question: [true, true],
  admin_delete_question: [true, true],
  admin_archive_question: [true, true],
  admin_unarchive_question: [false, true],
  admin_batch_create_questions: [false, true],
  admin_batch_update_questions: [true, true],
  admin_create_exam: [false, true],
  admin_update_exam: [true, true],
  admin_archive_exam: [true, true],
  admin_execute_import: [true, true],
  admin_create_tag: [false, true],
  admin_update_tag: [true, false],
  admin_merge_tags: [true, false],
};

test("dedicated endpoints initialize and publish independent catalogs", async (t) => {
  const f = await fixture(t);
  for (const [audience, credential] of [["user", f.alice], ["admin", f.admin]]) {
    const initialize = await rpc(f.env, audience, credential.token, "initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "boundary-test", version: "1.0" },
    });
    assert.equal(initialize.status, 200);
    const initialized = (await payload(initialize)).result;
    assert.equal(initialized.serverInfo.name, `prepdeck-${audience}-mcp`);
    if (audience === "user") assert.match(initialized.instructions, /user_present_question/);
    const response = await rpc(f.env, audience, credential.token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Mcp-Session-Id"), null);
    const tools = (await payload(response)).result.tools;
    assert.deepEqual(tools.map((tool) => tool.name), audience === "admin" ? ADMIN_TOOL_NAMES : USER_TOOL_NAMES);
    for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false);
    const call = await payload(await rpc(f.env, audience, credential.token, "tools/call", { name: `${audience}_get_identity` }));
    assert.deepEqual(call.result.structuredContent, { ok: true, data: { userId: audience === "user" ? "alice" : "admin", server: audience } });
  }
});

test("both MCP catalogs publish complete behavioral hints over JSON and legacy SSE", async (t) => {
  const f = await fixture(t);
  for (const protocolVersion of ["2025-11-25", "2026-07-28"]) {
    for (const [audience, token] of [["user", f.alice.token], ["admin", f.admin.token]]) {
      const response = await rpc(f.env, audience, token, "tools/list", {}, {
        headers: { "MCP-Protocol-Version": protocolVersion },
      });
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("Content-Type").includes(
        protocolVersion === "2025-11-25" ? "text/event-stream" : "application/json",
      ));
      const tools = (await payload(response)).result.tools;
      assert.deepEqual(tools.map(tool => tool.name), audience === "admin" ? ADMIN_TOOL_NAMES : USER_TOOL_NAMES);
      for (const tool of tools) {
        const mutation = MUTATION_ANNOTATIONS[tool.name];
        assert.deepEqual(tool.annotations, mutation ? {
          readOnlyHint: false, destructiveHint: mutation[0], idempotentHint: mutation[1], openWorldHint: false,
        } : READ_ANNOTATIONS, tool.name);
        for (const value of Object.values(tool.annotations)) assert.equal(typeof value, "boolean", tool.name);
      }
    }
  }
  for (const name of Object.keys(MUTATION_ANNOTATIONS)) {
    assert.ok([...USER_TOOL_NAMES, ...ADMIN_TOOL_NAMES].includes(name), `stale annotation expectation: ${name}`);
  }
});

test("PDF schemas are discoverable in both MCP audiences without question-bank writes", async (t) => {
  const f = await fixture(t);
  const results = [];
  for (const [audience, credential] of [["user", f.alice], ["admin", f.admin]]) {
    const response = await payload(await rpc(f.env, audience, credential.token, "tools/call", {
      name: `${audience}_get_import_schemas`, arguments: {},
    }));
    assert.equal(response.result.structuredContent.ok, true);
    results.push(response.result.structuredContent.data);
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0].capabilities.interactions, ["choice", "text", "order", "match"]);
  assert.equal(results[0].componentImportSchema.properties.schemaVersion.const, "2.0");
  assert.equal(results[0].importSchema.properties.schemaVersion.const, "1.0");
  assert.equal(results[0].importPermission, "admin");
  assert.equal(results[0].acceptsPdfUpload, false);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM questions").get().n, 0);
  assert.equal(f.bucketObjects.size, 0);
  const unauthenticated = await worker.fetch(new Request(`${f.env.APP_BASE_URL}/api/import-schemas`), f.env);
  assert.equal(unauthenticated.status, 401);
});

test("2026 protocol discovery and tool calls use the same authenticated catalog", async (t) => {
  const f = await fixture(t);
  const _meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "modern-test", version: "1.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const options = { headers: { "MCP-Protocol-Version": "2026-07-28" } };
  const discovery = await rpc(f.env, "user", f.alice.token, "server/discover", { _meta }, options);
  assert.equal(discovery.status, 200);
  const discovered = await payload(discovery);
  assert.ok(!discovered.error, JSON.stringify(discovered));
  const response = await rpc(f.env, "user", f.alice.token, "tools/call", { _meta, name: "user_get_identity", arguments: {} }, options);
  const result = await payload(response);
  assert.ok(!result.error, JSON.stringify(result));
  assert.equal(result.result.structuredContent.data.userId, "alice");
});

test("pagination bounds and tool error conventions are reusable", async () => {
  assert.deepEqual(paginationSchema.parse({}), { limit: 25, offset: 0 });
  for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 100001 }, { limit: "25" }, { ownerId: "other" }]) {
    assert.equal(paginationSchema.safeParse(input).success, false);
  }
  assert.deepEqual(pageResult([1, 2, 3], { limit: 2, offset: 0 }), { items: [1, 2], nextOffset: 2 });
  assert.deepEqual(pageResult([3], { limit: 2, offset: 2 }), { items: [3], nextOffset: null });
  for (const code of ["unauthenticated", "unauthorized", "invalid_input", "not_found", "internal"]) {
    const tool = defineMcpTool("test", READ_ANNOTATIONS, "Test", z.strictObject({}), () => { throw new McpApplicationError(code); });
    const result = await tool.invoke({});
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, code);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  }
  const tool = defineMcpTool("test", READ_ANNOTATIONS, "Test", z.strictObject({}), () => { throw new Error("private failure"); });
  assert.ok(!JSON.stringify(await tool.invoke({})).includes("private failure"));
});
