import { validateQuestionRow, type Question, type QuestionImportFile, type ValidationIssue } from "@prepdeck/shared";
import { normalizeTagKey } from "./questionBankTags";
import { questionClassificationConditions } from "./questionClassifications";

export interface QuestionRow {
  id: string; exam_id: string; external_id: string | null; sequence_number: number;
  content_json?: string | null;
  type: Question["type"]; stem: string; options_json: string | null; correct_answers_json: string;
  explanation: string | null; difficulty: Question["difficulty"];
  // Not a physical column (see migrations/0027_drop_questions_tags_json.sql)
  // — every SELECT below projects it via tagsJsonExpr()'s correlated
  // subquery over question_tag_links/question_bank_tags, so it always comes
  // back as a JSON array string exactly like the old tags_json column did.
  // Keeping the same shape here means toQuestion/payloadOf/canonical/
  // answerKey below, and every caller of them, never had to change.
  tags_json: string | null;
  // 0 / 1 — the dedicated review-workflow flag that replaced the legacy
  // `needs_review` question-bank tag (issue #15).
  needs_review: number;
  points: number; created_at: string; updated_at: string;
  revision: number; answer_revision: number; answer_revised_at: string | null; import_baseline_json: string | null;
  // Sorted catalog tag ids linked to this question when import_baseline_json
  // was last written (see lib/importConflicts.ts) — a separate, id-based
  // snapshot so a pure catalog rename of a shared tag can't manufacture a
  // false "locally_edited" conflict on every question carrying it.
  import_baseline_tag_ids_json: string | null;
}
export type QuestionPayload = QuestionImportFile["questions"][number];
export const editableFields = ["externalId", "type", "stem", "options", "correctAnswers", "explanation", "difficulty", "tags", "needsReview", "points", "content"] as const;

// One column list shared by every `questions` read below, plus a correlated
// subquery projected AS tags_json — same shape the old physical column had,
// sorted by name so tag *order* alone (independent of which catalog rename
// or link-sync order produced it) never causes a spurious payload diff (see
// payloadOf below and lib/importConflicts.ts). `tableRef` lets each call
// site qualify it for whatever alias that query already uses.
export function tagsJsonExpr(tableRef: string): string {
  return `(SELECT COALESCE(json_group_array(name), '[]') FROM (
    SELECT t.name AS name FROM question_tag_links l JOIN question_bank_tags t ON t.id = l.tag_id
    WHERE l.question_id = ${tableRef}.id ORDER BY t.name
  ))`;
}
const QUESTION_COLUMNS = [
  "id", "exam_id", "external_id", "sequence_number", "type", "stem", "options_json", "correct_answers_json",
  "explanation", "difficulty", "needs_review", "points", "created_at", "updated_at", "revision", "answer_revision",
  "answer_revised_at", "import_baseline_json", "import_baseline_tag_ids_json", "content_json",
];
export function questionSelectColumns(tableRef = "questions"): string {
  const prefix = tableRef ? `${tableRef}.` : "";
  return `${QUESTION_COLUMNS.map((c) => `${prefix}${c}`).join(", ")}, ${tagsJsonExpr(tableRef)} AS tags_json`;
}

export function toQuestion(row: QuestionRow): Question {
  return { id: row.id, examId: row.exam_id, externalId: row.external_id, sequenceNumber: row.sequence_number,
    ...(row.content_json ? { content: JSON.parse(row.content_json) } : {}),
    type: row.type, stem: row.stem, options: row.options_json ? JSON.parse(row.options_json) : null,
    correctAnswers: JSON.parse(row.correct_answers_json), explanation: row.explanation, difficulty: row.difficulty,
    tags: row.tags_json ? JSON.parse(row.tags_json) : [], needsReview: row.needs_review !== 0, points: row.points, createdAt: row.created_at,
    updatedAt: row.updated_at, revision: row.revision, answerRevision: row.answer_revision, answerRevisedAt: row.answer_revised_at };
}

// tags is always sorted here so every canonical()/diffPayload()/importConflict()
// comparison is independent of input ordering (a DB-sourced Question's tags
// already come back sorted via tagsJsonExpr; an incoming import/proposal
// payload's tags may not) — see implementation's "compare tag sets independently
// of input ordering".
export function payloadOf(q: Question | QuestionPayload): QuestionPayload {
  return { ...(q.content ? { content: q.content } : {}), externalId: q.externalId ?? undefined, type: q.type, stem: q.stem,
    options: q.options ?? undefined, correctAnswers: q.correctAnswers, explanation: q.explanation ?? null,
    difficulty: q.difficulty ?? null, tags: [...(q.tags ?? [])].sort((a, b) => a.localeCompare(b)),
    needsReview: q.needsReview ?? false, points: q.points ?? 1 };
}
export function canonical(q: Question | QuestionPayload): string { return JSON.stringify(payloadOf(q)); }
export function answerKey(q: QuestionPayload): string {
  const answers = q.correctAnswers.map(a => q.type === "fill_blank" ? a.trim().toLowerCase() : a);
  return JSON.stringify([q.type, q.type === "ordering" ? answers : [...new Set(answers)].sort()]);
}
export function validatePayload(input: unknown, current?: Question): { payload: QuestionPayload; issues: ValidationIssue[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { payload: input as QuestionPayload, issues: [{ path: "$", message: "must be an object" }] };
  }
  const data = input as Record<string, unknown>;
  const merged: Record<string, unknown> = current ? { ...payloadOf(current) } : {};
  for (const field of editableFields) if (Object.hasOwn(data, field)) merged[field] = data[field];
  // Explicit null clears an optional external ID. Omission in PATCH preserves it.
  if (merged.externalId === null) delete merged.externalId;
  if (merged.type === "fill_blank" && !Object.hasOwn(data, "options")) delete merged.options;
  return { payload: merged as unknown as QuestionPayload, issues: validateQuestionRow(merged, "$") };
}
export function getQuestion(db: D1Database, examId: string, id: string) {
  return db.prepare(`SELECT ${questionSelectColumns()} FROM questions WHERE id = ? AND exam_id = ?`).bind(id, examId).first<QuestionRow>();
}

// Neither statement writes tag content directly (there is no tags_json
// column to write to anymore) — a caller whose payload carries `tags` must
// separately resolve/link them via lib/questionBankTags.ts's
// syncQuestionTagLinks (or the lower-level resolveOrCreateTags +
// buildTagLinkStatements, for callers batching many rows) AFTER confirming
// this statement's own write actually committed. `tagIdsForBaseline`, when
// `imported` is true, is the resolved catalog id set the caller is about to
// link this question to — recorded alongside import_baseline_json so a
// later re-import's conflict/reason classification can compare tag
// *identity* instead of display-name text (see lib/importConflicts.ts).
export function createStatement(
  db: D1Database, examId: string, id: string, q: QuestionPayload, now: string,
  imported = false, tagIdsForBaseline: string[] = [],
) {
  return db.prepare(`INSERT INTO questions (id, exam_id, external_id, sequence_number, type, stem, options_json,
    correct_answers_json, explanation, difficulty, needs_review, points, created_at, updated_at, import_baseline_json, import_baseline_tag_ids_json, content_json)
    SELECT ?, ?, ?, COALESCE(MAX(sequence_number), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM questions WHERE exam_id = ?`)
    .bind(id, examId, q.externalId ?? null, q.type, q.stem, q.options ? JSON.stringify(q.options) : null,
      JSON.stringify(q.correctAnswers), q.explanation ?? null, q.difficulty ?? null, q.needsReview ? 1 : 0,
      q.points ?? 1, now, now, imported ? canonical(q) : null,
      imported ? JSON.stringify([...tagIdsForBaseline].sort()) : null, q.content ? JSON.stringify(q.content) : null, examId);
}
export function updateStatement(
  db: D1Database, row: QuestionRow, q: QuestionPayload, now: string,
  imported = false, tagIdsForBaseline: string[] = [],
) {
  const revised = answerKey(payloadOf(toQuestion(row))) !== answerKey(q);
  // A catalog merge can remap the baseline without changing row.revision.
  // Ordinary saves must preserve that current value, not the earlier snapshot.
  return db.prepare(`UPDATE questions SET external_id = ?, type = ?, stem = ?, options_json = ?, correct_answers_json = ?,
    explanation = ?, difficulty = ?, needs_review = ?, points = ?, content_json = ?, updated_at = ?, revision = revision + 1,
    answer_revision = answer_revision + ?, answer_revised_at = ?${imported ? ", import_baseline_json = ?, import_baseline_tag_ids_json = ?" : ""}
    WHERE id = ? AND exam_id = ? AND revision = ?`)
    .bind(q.externalId ?? null, q.type, q.stem, q.options ? JSON.stringify(q.options) : null, JSON.stringify(q.correctAnswers),
      q.explanation ?? null, q.difficulty ?? null, q.needsReview ? 1 : 0, q.points ?? 1, q.content ? JSON.stringify(q.content) : null, now,
      revised ? 1 : 0, revised ? now : row.answer_revised_at,
      ...(imported ? [canonical(q), JSON.stringify([...tagIdsForBaseline].sort())] : []),
      row.id, row.exam_id, row.revision);
}

// A plain interface (not Record<string, ...>) so both Hono's c.req.query()
// (Record<string, string>, used by routes/questions.ts) and a parsed MCP
// tool input object (a concrete zod-inferred type, used by mcp/adapter.ts)
// are structurally assignable without a cast.
export interface SearchQuestionsQuery {
  classifications?: string;
  limit?: string | number;
  offset?: string | number;
  type?: string;
  difficulty?: string;
  tag?: string;
  // "true"/"false" over the query string, a real boolean from an MCP tool
  // input. Anything else (including an empty select in the admin filter bar)
  // means "no review-state filter", not "needsReview = false".
  needsReview?: string | number | boolean;
  q?: string;
}

// Shared by the REST filter and admin_search_questions so both spell the
// filter the same way — and so `?needsReview=` (what the admin filter bar's
// "Any review state" option sends) never narrows the result set.
export function parseNeedsReviewFilter(value: SearchQuestionsQuery["needsReview"]): 0 | 1 | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1") return 1;
  if (text === "false" || text === "0") return 0;
  return null;
}

export async function searchQuestions(db: D1Database, examId: string, query: SearchQuestionsQuery) {
  const bounded = (v: string | number | undefined, fallback: number, max: number) => {
    const n = Number(v ?? fallback); return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.floor(n))) : fallback;
  };
  const limit = Math.max(1, bounded(query.limit, 50, 200)), offset = bounded(query.offset, 0, Number.MAX_SAFE_INTEGER);
  const conditions = ["exam_id = ?"], params: unknown[] = [examId];
  const classifications = await questionClassificationConditions(db, examId, query.classifications);
  conditions.push(...classifications.conditions); params.push(...classifications.params);
  for (const field of ["difficulty", "type"] as const) if (query[field]) { conditions.push(`${field} = ?`); params.push(query[field]); }
  const needsReview = parseNeedsReviewFilter(query.needsReview);
  if (needsReview !== null) { conditions.push("needs_review = ?"); params.push(needsReview); }
  // Matches by normalized identity (case-insensitive, trimmed — the same
  // key the catalog itself is keyed on), not a raw string compare against
  // whatever casing/whitespace a question happens to be tagged with — issue
  // implementation's "question search compares JSON values directly" fix.
  if (query.tag) {
    conditions.push(`EXISTS (SELECT 1 FROM question_tag_links l JOIN question_bank_tags t ON t.id = l.tag_id WHERE l.question_id = questions.id AND t.normalized_name = ?)`);
    params.push(normalizeTagKey(query.tag));
  }
  if (query.q) { conditions.push("(stem LIKE ? OR id = ? OR external_id = ?)"); params.push(`%${query.q}%`, query.q, query.q); }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT ${questionSelectColumns()} FROM questions ${where} ORDER BY sequence_number, id LIMIT ? OFFSET ?`).bind(...params, limit, offset).all<QuestionRow>(),
    db.prepare(`SELECT COUNT(*) AS n FROM questions ${where}`).bind(...params).first<{ n: number }>()]);
  return { questions: rows.results.map(toQuestion), total: count?.n ?? 0, limit, offset };
}

// Bounds for the unpaginated scans below (2x IMPORT_LIMITS.maxQuestions for
// a single exam; a generous bank-wide cap for the global statistics tool).
// Exported so callers can pass the same bound to
// questionQuality.ts's buildQuestionSetStatistics for its `truncated` flag.
export const EXAM_QUESTION_SCAN_LIMIT = 2000;
export const BANK_QUESTION_SCAN_LIMIT = 5000;

// Admin MCP batch mutation tools (implementation) cap items per call at this
// bound, matching the chunk size routes/imports.ts already uses for
// db.batch() — one call maps to exactly one atomic D1 batch.
export const MAX_BATCH_MUTATION_ITEMS = 50;

// Unpaginated bulk read for Admin MCP's quality-control and statistics
// tools (implementation), which need every row in scope to compute deterministic
// checks (duplicates, missing explanations/metadata, answer-reference
// integrity) rather than a single page. Bounded by `limit` so a very large
// exam or bank-wide scan cannot exhaust Worker memory; callers report the
// bound via buildQuestionSetStatistics's `truncated` flag.
export async function listQuestions(db: D1Database, opts: { examId?: string; limit: number }): Promise<QuestionRow[]> {
  const where = opts.examId ? "WHERE exam_id = ?" : "";
  const params = opts.examId ? [opts.examId] : [];
  const { results } = await db.prepare(`SELECT ${questionSelectColumns()} FROM questions ${where} ORDER BY sequence_number, id LIMIT ?`)
    .bind(...params, opts.limit).all<QuestionRow>();
  return results ?? [];
}

// Queries `limit + 1` rows so callers can pass the result straight to
// conventions.ts's pageResult() to detect whether another page exists.
export async function listRecentContentChanges(
  db: D1Database,
  opts: { examId?: string; sinceMs?: number; limit: number; offset: number },
): Promise<QuestionRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.examId) { conditions.push("exam_id = ?"); params.push(opts.examId); }
  if (opts.sinceMs !== undefined) { conditions.push("updated_at >= ?"); params.push(new Date(opts.sinceMs).toISOString()); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { results } = await db.prepare(`SELECT ${questionSelectColumns()} FROM questions ${where} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`)
    .bind(...params, opts.limit + 1, opts.offset).all<QuestionRow>();
  return results ?? [];
}

export interface QuestionTagCount {
  tag: string;
  questionCount: number;
}

// Derived from question_tag_links/question_bank_tags (implementation) — counts
// actual associations, one row per catalog tag with at least one link in
// scope. A catalog tag with zero current links never appears here (that's
// exactly the "registered but unused" case mcp/adapter.ts's listTags
// annotates separately via listTagCatalogNames).
export async function listQuestionTags(
  db: D1Database,
  opts: { examId?: string; limit: number; offset: number },
): Promise<QuestionTagCount[]> {
  const where = opts.examId ? "WHERE q.exam_id = ?" : "";
  const params = opts.examId ? [opts.examId] : [];
  const { results } = await db.prepare(
    `SELECT t.name AS tag, COUNT(DISTINCT l.question_id) AS questionCount
     FROM question_tag_links l
     JOIN question_bank_tags t ON t.id = l.tag_id
     JOIN questions q ON q.id = l.question_id
     ${where}
     GROUP BY l.tag_id
     ORDER BY t.name LIMIT ? OFFSET ?`,
  ).bind(...params, opts.limit + 1, opts.offset).all<QuestionTagCount>();
  return results ?? [];
}
