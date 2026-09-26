// Shared exam-read service logic reused by both the Admin UI's REST routes
// (routes/exams.ts) and Admin MCP's read-only tools (mcp/adapter.ts), per
// implementation's "share management logic with the future Admin MCP" and implementation's
// "reuse existing admin/service-layer query logic where practical".

import type { Exam, ExamPassRule, OfficialMockFormat } from "@prepdeck/shared";

export interface ExamRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  subject: string | null;
  language: string | null;
  created_at: string;
  archived_at: string | null;
  pass_mark_pct: number | null;
  official_question_count: number | null;
  official_time_limit_minutes: number | null;
  official_pass_correct_count: number | null;
  badge_icon_url: string | null;
  question_count: number;
  providers_json: string;
}

export interface ExamWithQuestionCount extends Exam {
  questionCount: number;
}

type OfficialFormatColumns = Pick<ExamRow, "official_question_count" | "official_time_limit_minutes" | "official_pass_correct_count">;

// The three columns are written together (updateExamStatement), so one NULL
// means the format is unset.
export function toOfficialFormat(row: OfficialFormatColumns): OfficialMockFormat | null {
  if (row.official_question_count == null || row.official_time_limit_minutes == null || row.official_pass_correct_count == null) return null;
  return {
    questionCount: row.official_question_count,
    timeLimitMinutes: row.official_time_limit_minutes,
    passCorrectCount: row.official_pass_correct_count,
  };
}

/** The columns a mock's pass/fail and the Statistics pass line are computed from. */
export async function loadExamPassRule(db: D1Database, examId: string): Promise<ExamPassRule | null> {
  const row = await db.prepare(
    "SELECT pass_mark_pct, official_question_count, official_time_limit_minutes, official_pass_correct_count FROM exams WHERE id = ?",
  ).bind(examId).first<OfficialFormatColumns & { pass_mark_pct: number | null }>();
  return row ? { passMarkPct: row.pass_mark_pct, officialFormat: toOfficialFormat(row) } : null;
}

export function toExam(row: ExamRow): ExamWithQuestionCount {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    subject: row.subject,
    language: row.language,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    passMarkPct: row.pass_mark_pct,
    officialFormat: toOfficialFormat(row),
    badgeIconUrl: row.badge_icon_url,
    questionCount: row.question_count,
    providers: JSON.parse(row.providers_json || "[]"),
  };
}

export const EXAM_SELECT = `SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count,
  COALESCE((SELECT json_group_array(json_object('id', p.id, 'name', p.name, 'shortName', p.short_name, 'websiteUrl', p.website_url, 'iconUrl', p.icon_url, 'createdAt', p.created_at)) FROM providers p JOIN provider_exams pe ON pe.provider_id = p.id WHERE pe.exam_id = e.id), '[]') AS providers_json FROM exams e`;

// `limit`/`offset` are optional so the Admin UI's REST route (routes/exams.ts)
// can keep its unbounded contract, while Admin MCP's admin_list_exams tool
// (implementation) always passes them for a bounded, paginated result. `e.id` is
// a secondary sort key so pagination is stable across rows sharing a
// `created_at` timestamp.
export async function listExams(
  db: D1Database,
  opts: { includeArchived?: boolean; limit?: number; offset?: number } = {},
): Promise<ExamWithQuestionCount[]> {
  const where = opts.includeArchived ? "" : "WHERE e.archived_at IS NULL";
  const pagination = opts.limit !== undefined ? " LIMIT ? OFFSET ?" : "";
  const params = opts.limit !== undefined ? [opts.limit, opts.offset ?? 0] : [];
  const { results } = await db
    .prepare(`${EXAM_SELECT} ${where} ORDER BY e.created_at DESC, e.id${pagination}`)
    .bind(...params)
    .all<ExamRow>();
  return (results ?? []).map(toExam);
}

export async function getExam(db: D1Database, id: string): Promise<ExamWithQuestionCount | null> {
  const row = await db.prepare(`${EXAM_SELECT} WHERE e.id = ?`).bind(id).first<ExamRow>();
  return row ? toExam(row) : null;
}

export async function examExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM exams WHERE id = ?").bind(id).first<{ id: string }>();
  return row !== null;
}

export async function getExamAttemptCounts(db: D1Database, examId: string): Promise<{ total: number; completed: number }> {
  const row = await db.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed FROM attempts WHERE exam_id = ?",
  ).bind(examId).first<{ total: number; completed: number | null }>();
  return { total: row?.total ?? 0, completed: row?.completed ?? 0 };
}

// implementation — exam lifecycle mutations, extracted out of routes/exams.ts (which
// previously inlined this SQL directly) so Admin MCP's exam-lifecycle tools
// can reuse the exact same statements, batched with an audit row, instead of
// duplicating the logic. These are plain statement builders (no `.run()`
// inside), the same shape as lib/questionManagement.ts's createStatement/
// updateStatement — the caller decides whether to execute immediately (REST)
// or batch atomically with an audit statement (MCP).

export const EXAM_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface ExamCreateFields {
  slug: string;
  name: string;
  subject?: string | null;
  description?: string | null;
  language?: string | null;
  passMarkPct?: number | null;
  officialFormat?: OfficialMockFormat | null;
}

export function createExamStatement(db: D1Database, id: string, fields: ExamCreateFields, now: string): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO exams (id, slug, name, subject, description, language, pass_mark_pct,
       official_question_count, official_time_limit_minutes, official_pass_correct_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, fields.slug, fields.name, fields.subject ?? null, fields.description ?? null,
    fields.language ?? null, fields.passMarkPct ?? null,
    fields.officialFormat?.questionCount ?? null, fields.officialFormat?.timeLimitMinutes ?? null,
    fields.officialFormat?.passCorrectCount ?? null, now,
  );
}

export interface ExamMutableFields {
  slug?: string;
  name?: string;
  description?: string;
  subject?: string;
  language?: string;
  passMarkPct?: number | null;
  /** Written as its three columns together; null clears all three. */
  officialFormat?: OfficialMockFormat | null;
}

const EDITABLE_EXAM_COLUMNS: Record<Exclude<keyof ExamMutableFields, "officialFormat">, string> = {
  slug: "slug", name: "name", description: "description", subject: "subject", language: "language", passMarkPct: "pass_mark_pct",
};

// Returns null when `fields` carries no editable keys — callers must reject
// that as their own "no fields to update" input error before ever reaching
// D1 (400 for REST, invalid_input for MCP).
export function updateExamStatement(db: D1Database, id: string, fields: ExamMutableFields): D1PreparedStatement | null {
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const key of Object.keys(EDITABLE_EXAM_COLUMNS) as (keyof typeof EDITABLE_EXAM_COLUMNS)[]) {
    if (fields[key] !== undefined) {
      columns.push(`${EDITABLE_EXAM_COLUMNS[key]} = ?`);
      values.push(fields[key]);
    }
  }
  if (fields.officialFormat !== undefined) {
    const f = fields.officialFormat;
    columns.push("official_question_count = ?", "official_time_limit_minutes = ?", "official_pass_correct_count = ?");
    values.push(f?.questionCount ?? null, f?.timeLimitMinutes ?? null, f?.passCorrectCount ?? null);
  }
  if (columns.length === 0) return null;
  return db.prepare(`UPDATE exams SET ${columns.join(", ")} WHERE id = ?`).bind(...values, id);
}

// No `revision`/optimistic-concurrency column on exams (unlike questions) —
// `changes() === 0` unambiguously means "no such exam id" here, since there's
// no other WHERE condition that could make an existing row not match.
export function archiveExamStatement(db: D1Database, id: string, now: string): D1PreparedStatement {
  return db.prepare("UPDATE exams SET archived_at = ? WHERE id = ? AND archived_at IS NULL").bind(now, id);
}

export function unarchiveExamStatement(db: D1Database, id: string): D1PreparedStatement {
  return db.prepare("UPDATE exams SET archived_at = NULL WHERE id = ?").bind(id);
}
