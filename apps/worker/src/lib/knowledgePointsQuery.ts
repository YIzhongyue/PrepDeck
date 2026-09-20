// implementation — filtering/sorting/searching for GET /api/knowledge-points.
// Extracted as a pure function (mirrors lib/annotationsQuery.ts) so the
// WHERE/ORDER BY construction — including tag AND-semantics and sort-mode
// mapping — is unit testable without a D1 binding. The caller wraps the
// returned `where`/`binds` into both a page query (SELECT ... LIMIT/OFFSET)
// and a COUNT(*) query sharing the same filter.

import type { KnowledgePointSort } from "@prepdeck/shared";

const SORTS: readonly KnowledgePointSort[] = ["updated", "title", "created", "custom"];

// implementation — every mode appends `kp.id` as a deterministic tiebreaker.
// Without one, rows sharing an updated_at/title/created_at/position value
// (routine for notes created or bulk-imported together) sort in whatever
// order SQLite happens to return them, which can differ between the paged
// query and the identically-filtered COUNT(*) query, or between two calls to
// the paged query itself — silently duplicating or skipping rows across
// pages.
const ORDER_BY: Record<KnowledgePointSort, string> = {
  updated: "kp.updated_at DESC, kp.id ASC",
  title: "kp.title COLLATE NOCASE ASC, kp.id ASC",
  created: "kp.created_at DESC, kp.id ASC",
  custom: "kp.position ASC, kp.id ASC",
};

export interface KnowledgePointsListParams {
  groupId?: string | null;
  ungrouped?: boolean;
  tagIds?: string[];
  q?: string | null;
  sort?: string | null;
  // implementation — the Learning Mode "related knowledge points" card: notes
  // linked to one specific question, regardless of group/tag/search filters.
  linkedQuestionId?: string | null;
  // implementation — "Related to this exam" view: filters by the exam(s) of a
  // note's linked questions via the existing question_id -> exam_id
  // relationship. Notes with no linked questions never match this filter;
  // they remain reachable only from the unfiltered "All personal
  // knowledge points" view. Additive/query-only — no new KP<->exam
  // association model, and omitting it preserves today's default (all
  // personal notes across exams).
  examId?: string | null;
}

export interface KnowledgePointsListQuery {
  where: string;
  binds: unknown[];
  orderBy: string;
}

// Returns null when `sort` is present but not one of the known values — the
// caller should respond 400. `groupId` is ignored when `ungrouped` is true
// (an explicit "Ungrouped" view takes precedence over a stray groupId).
export function buildKnowledgePointsListQuery(
  userId: string,
  params: KnowledgePointsListParams
): KnowledgePointsListQuery | null {
  const conditions = ["kp.user_id = ?"];
  const binds: unknown[] = [userId];

  if (params.ungrouped) {
    conditions.push("kp.group_id IS NULL");
  } else if (params.groupId) {
    conditions.push("kp.group_id = ?");
    binds.push(params.groupId);
  }

  const tagIds = (params.tagIds ?? []).map((t) => t.trim()).filter(Boolean);
  for (const tagId of tagIds) {
    conditions.push("kp.id IN (SELECT knowledge_point_id FROM knowledge_point_tag_links WHERE tag_id = ?)");
    binds.push(tagId);
  }

  const q = params.q?.trim();
  if (q) {
    conditions.push("(kp.title LIKE ? OR kp.body_markdown LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`);
  }

  if (params.linkedQuestionId) {
    conditions.push("kp.id IN (SELECT knowledge_point_id FROM knowledge_point_question_links WHERE question_id = ?)");
    binds.push(params.linkedQuestionId);
  }

  if (params.examId) {
    conditions.push(
      "kp.id IN (SELECT ql.knowledge_point_id FROM knowledge_point_question_links ql JOIN questions q ON q.id = ql.question_id WHERE q.exam_id = ?)"
    );
    binds.push(params.examId);
  }

  let sort: KnowledgePointSort = "updated";
  if (params.sort != null && params.sort !== "") {
    if (!(SORTS as readonly string[]).includes(params.sort)) return null;
    sort = params.sort as KnowledgePointSort;
  }

  return { where: conditions.join(" AND "), binds, orderBy: ORDER_BY[sort] };
}
