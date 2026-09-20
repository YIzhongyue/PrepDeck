// implementation — filtering/sorting for GET /api/annotations ("My
// Annotations"). Extracted as pure functions so the query-construction
// logic (which mark types are valid, how sort maps to SQL) is unit
// testable without a D1 binding, and (implementation) so the User MCP's
// list_annotations/get_annotations_for_question tools can reuse the exact
// same row shape/mapping as the REST route instead of duplicating it.

import { MARK_STYLES } from "@prepdeck/shared";
import type { Annotation, AnnotationTargetType } from "@prepdeck/shared";

export interface AnnotationRow {
  id: string;
  user_id: string;
  question_id: string;
  target_type: string;
  target_ref: string | null;
  range_start: number;
  range_end: number;
  style: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function toAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    userId: row.user_id,
    questionId: row.question_id,
    targetType: row.target_type as AnnotationTargetType,
    targetRef: row.target_ref,
    rangeStart: row.range_start,
    rangeEnd: row.range_end,
    style: row.style,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AnnotationsListQuery {
  sql: string;
  binds: unknown[];
}

// Returns null when markTypeParam/sortParam are present but invalid — the
// caller should respond 400/invalid_input. Omitted/empty params reproduce
// today's unfiltered, created_at ASC behavior exactly. `page`, when given,
// appends `LIMIT ? OFFSET ?`, querying `limit + 1` rows so the result can be
// passed straight to conventions.ts's pageResult() (same convention as
// lib/questionManagement.ts's listRecentContentChanges/listQuestionTags) —
// omitting it (as routes/annotations.ts does) keeps the REST route's
// existing unpaginated contract unchanged.
//
// Secondary sort key `id` so pagination is stable when multiple annotations
// share the same created_at timestamp (this was previously ORDER BY
// created_at alone).
export function buildAnnotationsListQuery(
  userId: string,
  markTypeParam: string | null | undefined,
  sortParam: string | null | undefined,
  examId?: string,
  page?: { limit: number; offset: number },
): AnnotationsListQuery | null {
  let sql = "SELECT * FROM annotations WHERE user_id = ?";
  const binds: unknown[] = [userId];
  if (examId !== undefined) {
    sql += " AND question_id IN (SELECT id FROM questions WHERE exam_id = ?)";
    binds.push(examId);
  }

  if (markTypeParam) {
    const types = markTypeParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (types.length) {
      if (!types.every((t) => (MARK_STYLES as readonly string[]).includes(t))) return null;
      sql += ` AND style IN (${types.map(() => "?").join(",")})`;
      binds.push(...types);
    }
  }

  let order = "ASC";
  if (sortParam != null && sortParam !== "") {
    if (sortParam !== "asc" && sortParam !== "desc") return null;
    order = sortParam === "desc" ? "DESC" : "ASC";
  }
  sql += ` ORDER BY created_at ${order}, id ASC`;
  if (page) {
    sql += " LIMIT ? OFFSET ?";
    binds.push(page.limit + 1, page.offset);
  }
  return { sql, binds };
}

export async function listAnnotationsForQuestion(
  db: D1Database,
  userId: string,
  questionId: string,
  page: { limit: number; offset: number },
): Promise<AnnotationRow[]> {
  const { results } = await db.prepare(
    "SELECT * FROM annotations WHERE user_id = ? AND question_id = ? ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?",
  ).bind(userId, questionId, page.limit + 1, page.offset).all<AnnotationRow>();
  return results ?? [];
}
