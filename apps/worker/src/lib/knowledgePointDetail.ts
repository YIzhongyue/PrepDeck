// implementation — shared read path for one knowledge point (REST's
// GET /api/knowledge-points/:id autosave-detail shape) and for one page of
// the list (REST's GET /api/knowledge-points). Extracted out of
// routes/knowledgePoints.ts so both REST and the User MCP adapter read a
// note through the exact same query/shape — never two parallel
// implementations of "what a knowledge point looks like".

export interface KnowledgePointRow {
  id: string;
  user_id: string;
  group_id: string | null;
  group_name: string | null;
  title: string;
  body_markdown: string;
  excerpt: string;
  mermaid_count: number;
  position: number;
  revision: number;
  created_at: string;
  updated_at: string;
  tags_json?: string;
  linked_question_count?: number;
  image_count?: number;
}

export interface TagRef {
  id: string;
  name: string;
}

function parseTags(tagsJson: string | undefined): TagRef[] {
  if (!tagsJson) return [];
  try {
    return JSON.parse(tagsJson) as TagRef[];
  } catch {
    return [];
  }
}

export function toSummary(row: KnowledgePointRow) {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    groupId: row.group_id,
    groupName: row.group_name,
    tags: parseTags(row.tags_json),
    linkedQuestionCount: row.linked_question_count ?? 0,
    imageCount: row.image_count ?? 0,
    diagramCount: row.mermaid_count,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ImageRow {
  id: string;
  status: "pending" | "attached" | "orphaned";
}

interface LinkedQuestionRow {
  question_id: string;
  q_id: string | null;
  exam_id: string | null;
  exam_slug: string | null;
  external_id: string | null;
  stem: string | null;
}

function excerptOf(stem: string, max = 140): string {
  const flat = stem.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

// implementation — REST never capped how many tags/images/linked questions a
// single note may carry, so a note assembled entirely through REST (which
// still has no such cap) could be arbitrarily large. These bound a single
// detail read regardless of how the underlying rows were created, with a
// `*Truncated` flag when more exist than shown. Ordinary notes are far under
// these caps and see no behavior change; REST benefits from the same bound
// since it shares this function.
export const MAX_TAGS_IN_DETAIL = 100;
export const MAX_IMAGES_IN_DETAIL = 100;
export const MAX_LINKED_QUESTIONS_IN_DETAIL = 200;

export async function loadDetail(db: D1Database, id: string, userId: string) {
  const row = await db
    .prepare(
      `SELECT kp.*, g.name AS group_name
       FROM knowledge_points kp
       LEFT JOIN knowledge_point_groups g ON g.id = kp.group_id
       WHERE kp.id = ? AND kp.user_id = ?`
    )
    .bind(id, userId)
    .first<KnowledgePointRow>();
  if (!row) return null;

  const [tags, images, links] = await Promise.all([
    db
      .prepare(
        `SELECT t.id, t.name FROM knowledge_point_tag_links l JOIN knowledge_point_tags t ON t.id = l.tag_id
         WHERE l.knowledge_point_id = ? ORDER BY t.name COLLATE NOCASE ASC, t.id ASC LIMIT ?`
      )
      .bind(id, MAX_TAGS_IN_DETAIL + 1)
      .all<TagRef>(),
    db
      .prepare(`SELECT id, status FROM knowledge_point_images WHERE knowledge_point_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`)
      .bind(id, MAX_IMAGES_IN_DETAIL + 1)
      .all<ImageRow>(),
    db
      .prepare(
        `SELECT ql.question_id AS question_id, q.id AS q_id, q.exam_id AS exam_id, e.slug AS exam_slug,
                q.external_id AS external_id, q.stem AS stem
         FROM knowledge_point_question_links ql
         LEFT JOIN questions q ON q.id = ql.question_id
         LEFT JOIN exams e ON e.id = q.exam_id
         WHERE ql.knowledge_point_id = ? ORDER BY ql.created_at ASC, ql.question_id ASC LIMIT ?`
      )
      .bind(id, MAX_LINKED_QUESTIONS_IN_DETAIL + 1)
      .all<LinkedQuestionRow>(),
  ]);

  const tagRows = tags.results ?? [];
  const imageRows = images.results ?? [];
  const linkRows = links.results ?? [];

  return {
    id: row.id,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    groupId: row.group_id,
    groupName: row.group_name,
    tags: tagRows.slice(0, MAX_TAGS_IN_DETAIL),
    tagsTruncated: tagRows.length > MAX_TAGS_IN_DETAIL,
    images: imageRows.slice(0, MAX_IMAGES_IN_DETAIL).map((im) => ({ id: im.id, url: `/api/kp-images/${im.id}`, status: im.status })),
    imagesTruncated: imageRows.length > MAX_IMAGES_IN_DETAIL,
    linkedQuestions: linkRows.slice(0, MAX_LINKED_QUESTIONS_IN_DETAIL).map((l) => ({
      questionId: l.question_id,
      accessible: l.q_id != null,
      examId: l.exam_id ?? undefined,
      examSlug: l.exam_slug ?? undefined,
      externalId: l.external_id ?? undefined,
      stemExcerpt: l.stem ? excerptOf(l.stem) : undefined,
    })),
    linkedQuestionsTruncated: linkRows.length > MAX_LINKED_QUESTIONS_IN_DETAIL,
    position: row.position,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const LIST_SELECT = `
  SELECT kp.*, g.name AS group_name,
    COALESCE((SELECT json_group_array(json_object('id', t.id, 'name', t.name))
               FROM knowledge_point_tag_links l JOIN knowledge_point_tags t ON t.id = l.tag_id
               WHERE l.knowledge_point_id = kp.id), '[]') AS tags_json,
    (SELECT COUNT(*) FROM knowledge_point_question_links ql WHERE ql.knowledge_point_id = kp.id) AS linked_question_count,
    (SELECT COUNT(*) FROM knowledge_point_images im WHERE im.knowledge_point_id = kp.id AND im.status != 'orphaned') AS image_count
  FROM knowledge_points kp
  LEFT JOIN knowledge_point_groups g ON g.id = kp.group_id
`;
