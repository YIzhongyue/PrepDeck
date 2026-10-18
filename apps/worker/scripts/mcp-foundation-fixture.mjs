// The harness the MCP foundation tests share (mcp-auth-gates, mcp-catalog,
// mcp-metrics, mcp-user-read-tools and the mcp-admin-* files): the real
// Worker bundled once per test file, the migrated database it runs on, the
// faked bindings, and helpers for calling either MCP server over its wire
// format.
import assert from "node:assert/strict";
import { importTs } from "../../../tests/support/bundle.mjs";
import { createBindings } from "../../../tests/support/bindings.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { migrationSql, openDatabase } from "../../../tests/support/migrations.mjs";

// Exercise the real Worker entry and SDK (Workers export conditions), not
// a hand-written JSON-RPC imitation or a mock token verifier.

export const {
  worker, issueMcpCredential, hashMcpToken, paginationSchema, pageResult,
  defineMcpTool, McpApplicationError, createUserMcpAdapter, createAdminMcpAdapter,
  McpObservation, MAX_MCP_TOOL_METRICS, toolResult,
} = await importTs({
  contents: `export { default as worker } from './src/index.ts';
      export * from './src/mcp/credentials.ts';
      export * from './src/mcp/conventions.ts';
      export * from './src/mcp/catalog.ts';
      export * from './src/mcp/errors.ts';
      export * from './src/mcp/adapters/user/index.ts';
      export * from './src/mcp/adapters/admin/index.ts';
      export * from './src/mcp/runtime.ts';
      export * from './src/mcp/observability.ts';`,
  resolveDir: new URL("..", import.meta.url),
}, { platform: "workerd" });

// Only the migrations implementation's Admin MCP read tools actually query
// against (exam/provider/badge columns, pass_mark_pct, question authoring's
// revision columns, plus credentials) — not the full migration history.
const schemaFiles = [
  "0001_init.sql", "0003_exam_management_columns.sql", "0004_attempts_and_grading.sql",
  "0009_learning_mode.sql", "0010_exam_badge_icon.sql", "0011_exam_providers.sql", "0015_question_authoring.sql",
  "0017_mcp_credentials.sql", "0018_mcp_credential_names.sql", "0019_admin_mcp_audit_log.sql",
  "0020_admin_mcp_create_idempotency.sql", "0021_admin_mcp_audit_log_targets.sql", "0022_question_bank_tags.sql",
  "0023_admin_mcp_import_jobs.sql", "0024_admin_mcp_import_committed_items.sql",
  "0026_question_tag_links.sql", "0027_drop_questions_tags_json.sql", "0029_question_mutation_audit.sql",
  "0033_question_needs_review.sql", "0034_question_components.sql", "0035_exam_official_format.sql",
  "0041_provider_archiving.sql", "0042_question_archiving.sql", "0043_question_archive_audit_actions.sql", "0045_mcp_oauth.sql",
];

// implementation's import tools write import_logs (0002 predates schemaFiles'
// question-authoring cut, but import_logs itself is defined in 0001).
const schema = migrationSql({ only: schemaFiles });

export async function fixture(t) {
  const sqlite = openDatabase(t, false);
  sqlite.exec(schema);
  for (const [id, role] of [["alice", "user"], ["bob", "user"], ["admin", "admin"]]) {
    sqlite.prepare("INSERT INTO users (id, email, role, status, created_at) VALUES (?, ?, ?, 'active', ?)")
      .run(id, `${id}@example.test`, role, new Date().toISOString());
  }
  const queries = [];
  const DB = createD1(sqlite, { onQuery: ({ sql, args }) => { queries.push({ sql, args }); } });
  const metrics = [];
  const env = {
    ...createBindings(),
    MCP_METRICS_ENABLED: "true", MCP_METRICS: { writeDataPoint: (point) => metrics.push(structuredClone(point)) },
    DB, ENVIRONMENT: "production", APP_BASE_URL: "https://prepdeck.test", AUTH_MODE: "cookie",
  };
  const expiresAt = Date.now() + 60_000;
  const alice = await issueMcpCredential(DB, { userId: "alice", audience: "user", name: "alice's token", expiresAt });
  const bob = await issueMcpCredential(DB, { userId: "bob", audience: "user", name: "bob's token", expiresAt });
  const admin = await issueMcpCredential(DB, { userId: "admin", audience: "admin", name: "admin's token", expiresAt });
  const adminUser = await issueMcpCredential(DB, { userId: "admin", audience: "user", name: "admin's user token", expiresAt });
  return {
    sqlite, DB, env, metrics, queries, alice, bob, admin, adminUser,
    limits: env.RATE_LIMITER.calls, kvInvalidations: env.KV.deletes, bucketObjects: env.BUCKET.objects,
  };
}

export function rpc(env, audience, token, method = "tools/list", params, options = {}) {
  const headers = new Headers({
    "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25", "CF-Connecting-IP": "192.0.2.1",
    "Mcp-Method": method,
    ...(params?.name ? { "Mcp-Name": params.name } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers,
  });
  if (headers.get("MCP-Protocol-Version") === "2026-07-28") params = {
    ...params, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
  const path = audience === "admin" ? "/admin-mcp" : "/mcp";
  return worker.fetch(new Request(`${env.APP_BASE_URL}${path}${options.query ?? ""}`, {
    method: options.method ?? "POST", headers,
    ...((options.method ?? "POST") === "POST" ? { body: options.body ?? JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) } : {}),
  }), env);
}

// implementation — expected User MCP catalog, in registration order.
// implementation adds the Knowledge Points tools at the end.
export const USER_TOOL_NAMES = [
  "user_get_identity",
  "user_get_import_schemas",
  "user_get_learning_overview", "user_get_exam_progress", "user_get_learning_stats",
  "user_start_practice", "user_submit_practice_answer", "user_complete_practice", "user_set_learning_progress",
  "user_list_attempts", "user_get_attempt", "user_get_recent_attempts",
  "user_get_wrong_questions", "user_get_bookmarked_questions", "user_get_unattempted_questions",
  "user_search_questions", "user_get_question", "user_present_question", "user_list_exams", "user_get_exam", "user_list_question_tags",
  "user_get_recommended_questions", "user_get_questions_for_review", "user_get_practice_candidates",
  "user_list_annotations", "user_get_annotations_for_question",
  "user_list_knowledge_points", "user_search_knowledge_points", "user_get_knowledge_point",
  "user_get_knowledge_points_for_question", "user_list_knowledge_point_groups", "user_list_knowledge_point_tags",
  "user_create_knowledge_point", "user_update_knowledge_point", "user_delete_knowledge_point",
  "user_link_knowledge_point_question", "user_unlink_knowledge_point_question",
  "user_create_knowledge_point_group", "user_rename_knowledge_point_group", "user_delete_knowledge_point_group",
  "user_create_knowledge_point_tag", "user_rename_knowledge_point_tag", "user_delete_knowledge_point_tag",
  "user_unlink_knowledge_point_tag", "user_reorder_knowledge_points",
];

// implementation — expected Admin MCP catalog, in registration order.
export const ADMIN_TOOL_NAMES = [
  "admin_get_identity", "admin_get_import_schemas", "admin_export_questions", "admin_search_questions", "admin_get_question", "admin_list_exams", "admin_get_exam",
  "admin_get_exam_statistics", "admin_find_duplicate_questions", "admin_find_questions_missing_explanations",
  "admin_find_questions_with_invalid_answer_references", "admin_find_questions_missing_metadata",
  "admin_get_question_bank_statistics", "admin_get_recent_content_changes", "admin_list_tags",
  "admin_preview_component_question", "admin_validate_question_payload", "admin_create_question", "admin_update_question", "admin_delete_question",
  "admin_archive_question", "admin_unarchive_question",
  "admin_batch_create_questions", "admin_batch_update_questions",
  // implementation
  "admin_create_exam", "admin_update_exam", "admin_archive_exam",
  "admin_validate_import", "admin_preview_import", "admin_execute_import", "admin_get_import_status",
  "admin_create_tag", "admin_update_tag", "admin_merge_tags",
];

export async function payload(response) {
  const body = await response.text();
  if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    return JSON.parse(body.split("\n").find((line) => line.startsWith("data: ")).slice(6));
  }
  return JSON.parse(body);
}

// implementation — seeds two exams' worth of questions (one archived exam) with
// deliberate quality issues, then exercises every read/quality-control tool
// through the real worker over the real MCP wire format.
// implementation — tags no longer live in a tags_json column; every fixture
// that used to inline a JSON tag array into its INSERT now seeds the
// catalog + join table directly instead. Register-if-missing, same
// case-insensitive identity rule the app itself uses (normalized_name).
export function seedQuestionTags(sqlite, questionId, tagNames) {
  const now = new Date().toISOString();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    const normalized = name.toLowerCase();
    let tag = sqlite.prepare("SELECT id FROM question_bank_tags WHERE normalized_name = ?").get(normalized);
    if (!tag) {
      const id = crypto.randomUUID();
      sqlite.prepare(
        "INSERT INTO question_bank_tags (id, name, normalized_name, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      ).run(id, name, normalized, now, now);
      tag = { id };
    }
    sqlite.prepare("INSERT OR IGNORE INTO question_tag_links (question_id, tag_id) VALUES (?, ?)").run(questionId, tag.id);
  }
}

export function getQuestionTags(sqlite, questionId) {
  return sqlite.prepare(
    `SELECT t.name FROM question_tag_links l JOIN question_bank_tags t ON t.id = l.tag_id
     WHERE l.question_id = ? ORDER BY t.name`,
  ).all(questionId).map((r) => r.name);
}

export async function questionBankFixture(t) {
  const f = await fixture(t);
  const now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)")
    .run("examA", "exam-a", "Exam A", now);
  f.sqlite.prepare("INSERT INTO exams (id, slug, name, created_at, archived_at) VALUES (?, ?, ?, ?, ?)")
    .run("examB", "exam-b", "Exam B", now, now);

  const insertQuestion = f.sqlite.prepare(`INSERT INTO questions
    (id, exam_id, external_id, sequence_number, type, stem, options_json, correct_answers_json,
     explanation, difficulty, points, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  const q = (overrides) => ({
    externalId: null, options: null, explanation: null, difficulty: null, tags: [],
    createdAt: now, ...overrides,
  });
  const questions = [
    q({ id: "q1", examId: "examA", seq: 1, type: "single_choice", stem: "What is 2+2?",
      options: [{ id: "a", text: "3" }, { id: "b", text: "4" }], correctAnswers: ["b"],
      explanation: "Because 2+2=4.", difficulty: "easy", tags: ["math"], updatedAt: "2026-01-02T00:00:00.000Z" }),
    q({ id: "q2", examId: "examA", seq: 2, type: "single_choice", stem: "what   is 2+2?",
      options: [{ id: "a", text: "3" }, { id: "b", text: "4" }], correctAnswers: ["b"],
      updatedAt: "2026-01-03T00:00:00.000Z" }), // duplicate stem, missing explanation + metadata
    q({ id: "q3", examId: "examA", seq: 3, type: "true_false", stem: "The sky is blue.",
      options: [{ id: "maybe", text: "Maybe" }, { id: "no", text: "No" }], correctAnswers: ["maybe"],
      explanation: "It scatters blue light.", difficulty: "medium", tags: ["science"],
      updatedAt: "2026-01-04T00:00:00.000Z" }), // invalid answer reference (no true/false ids)
    q({ id: "q4", examId: "examA", seq: 4, type: "fill_blank", stem: "Fill in ___.", correctAnswers: ["answer"],
      explanation: "exp", difficulty: "hard", tags: ["fill"], updatedAt: "2026-01-01T00:00:00.000Z" }),
    q({ id: "q5", examId: "examB", seq: 1, type: "single_choice", stem: "Exam B question",
      options: [{ id: "x", text: "X" }, { id: "y", text: "Y" }], correctAnswers: ["y"],
      explanation: "exp5", difficulty: "easy", tags: ["math", "examB"], updatedAt: "2026-01-02T12:00:00.000Z" }),
  ];
  for (const row of questions) {
    insertQuestion.run(row.id, row.examId, row.externalId, row.seq, row.type, row.stem,
      row.options ? JSON.stringify(row.options) : null, JSON.stringify(row.correctAnswers),
      row.explanation, row.difficulty, row.createdAt, row.updatedAt);
    seedQuestionTags(f.sqlite, row.id, row.tags);
  }

  f.sqlite.prepare(`INSERT INTO attempts (id, user_id, exam_id, mode, started_at, completed_at)
    VALUES (?, 'alice', 'examA', 'practice', ?, ?)`).run("attempt1", now, now);
  f.sqlite.prepare(`INSERT INTO attempts (id, user_id, exam_id, mode, started_at, completed_at)
    VALUES (?, 'alice', 'examA', 'practice', ?, NULL)`).run("attempt2", now);

  f.questionRowCount = f.sqlite.prepare("SELECT COUNT(*) c FROM questions").get().c;
  return f;
}

export async function callAdminTool(f, name, args = {}) {
  const result = (await payload(await rpc(f.env, "admin", f.admin.token, "tools/call", { name, arguments: args }))).result;
  assert.equal(result.isError, undefined, `${name} unexpectedly failed: ${JSON.stringify(result)}`);
  return result.structuredContent.data;
}

export async function callAdminToolExpectingError(f, name, args = {}) {
  const result = (await payload(await rpc(f.env, "admin", f.admin.token, "tools/call", { name, arguments: args }))).result;
  assert.equal(result.isError, true, `${name} unexpectedly succeeded`);
  return result.structuredContent.error;
}

export function importFile(questions, overrides = {}) {
  return { schemaVersion: "1.0", exam: { id: "examA", name: "Exam A" }, questions, ...overrides };
}

// Decode the published Analytics Engine v1 schema, not transport/private data.
export function metric(point) {
  const [schema, event, audience, method, tool, outcome, error, auth, stage, kind, mode, transport] = point.blobs;
  const [count, durationMs, httpStatus, slow, created, updated, skipped, failed, conflict, replayed, omittedTools] = point.doubles;
  return { schema, event, audience, method, tool, outcome, error, auth, stage, kind, mode, transport,
    count, durationMs, httpStatus, slow, created, updated, skipped, failed, conflict, replayed, omittedTools };
}

export function lastMetric(f, event = "request") {
  return f.metrics.map(metric).filter((point) => point.event === event).at(-1);
}
