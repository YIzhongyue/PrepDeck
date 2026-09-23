import { normalizeTagKey, UNCLASSIFIED_QUESTION_VALUE, type QuestionClassification, type QuestionClassificationCatalog, type QuestionClassificationProfile } from "@prepdeck/shared";
import profiles from "../config/question-classifications.json";

export class QuestionClassificationError extends Error {
  constructor(readonly status: 400 | 404, message: string) { super(message); }
}

export function resolveQuestionClassifications(exam: { id: string; slug: string; tagKeys: string[] }, configuration: QuestionClassificationProfile[] = profiles): QuestionClassification[] {
  const tags = new Set(exam.tagKeys.map(normalizeTagKey)), dimensions = new Map<string, QuestionClassification>();
  for (const profile of configuration) {
    if (!profile.examIds?.includes(exam.id) && !profile.examSlugs?.includes(exam.slug)
      && !profile.examTags?.some(tag => tags.has(normalizeTagKey(tag)))) continue;
    // Earlier profiles can specialize a dimension for an exact exam ID.
    for (const dimension of profile.dimensions) if (!dimensions.has(dimension.id)) dimensions.set(dimension.id, dimension);
  }
  return [...dimensions.values()];
}

async function definitions(db: D1Database, examId: string) {
  const exam = await db.prepare("SELECT id, slug FROM exams WHERE id = ?").bind(examId).first<{ id: string; slug: string }>();
  if (!exam) throw new QuestionClassificationError(404, "Exam not found");
  const tags = await db.prepare(`SELECT DISTINCT t.normalized_name FROM question_bank_tags t
    JOIN question_tag_links l ON l.tag_id = t.id JOIN questions q ON q.id = l.question_id WHERE q.exam_id = ?`).bind(examId).all<{ normalized_name: string }>();
  return resolveQuestionClassifications({ ...exam, tagKeys: tags.results.map(t => t.normalized_name) });
}

// A question belongs to a value only when exactly one configured value matches.
// Multiple aliases for that value still count once. Missing/ambiguous metadata
// stays accessible, without guessing from question text or rewriting tags.
function classificationExpression(dimension: QuestionClassification) {
  return {
    sql: `(SELECT CASE WHEN COUNT(DISTINCT json_extract(mapping.value, '$.id')) = 1
      THEN MAX(json_extract(mapping.value, '$.id')) ELSE '${UNCLASSIFIED_QUESTION_VALUE}' END
      FROM json_each(?) mapping JOIN json_each(json_extract(mapping.value, '$.tags')) alias
      JOIN question_bank_tags t ON t.normalized_name = alias.value
      JOIN question_tag_links l ON l.tag_id = t.id WHERE l.question_id = questions.id)`,
    values: JSON.stringify(dimension.values.map(value => ({ id: value.id, tags: value.tags.map(normalizeTagKey) }))),
  };
}

export async function questionClassificationCatalog(db: D1Database, examId: string): Promise<QuestionClassificationCatalog> {
  const dimensions = await definitions(db, examId);
  return { dimensions: await Promise.all(dimensions.map(async dimension => {
    const expression = classificationExpression(dimension);
    const { results } = await db.prepare(`SELECT ${expression.sql} AS value, COUNT(*) AS count
      FROM questions WHERE exam_id = ? GROUP BY value`).bind(expression.values, examId).all<{ value: string; count: number }>();
    const counts = new Map(results.map(row => [row.value, row.count]));
    return { id: dimension.id, label: dimension.label, allLabel: dimension.allLabel,
      values: dimension.values.map(value => ({ id: value.id, label: value.label, count: counts.get(value.id) ?? 0 })),
      unclassifiedCount: counts.get(UNCLASSIFIED_QUESTION_VALUE) ?? 0 };
  })) };
}

export async function questionClassificationConditions(db: D1Database, examId: string, raw?: string) {
  const conditions: string[] = [], params: string[] = [];
  if (!raw) return { conditions, params };
  let selected: unknown;
  try { if (raw.length > 2000) throw new Error(); selected = JSON.parse(raw); } catch { throw new QuestionClassificationError(400, "Invalid classification filters"); }
  if (!selected || typeof selected !== "object" || Array.isArray(selected) || Object.keys(selected).length > 10) throw new QuestionClassificationError(400, "Invalid classification filters");
  const entries = Object.entries(selected);
  if (!entries.length) return { conditions, params };
  const available = await definitions(db, examId);
  for (const [id, value] of entries) {
    const dimension = available.find(d => d.id === id);
    if (!dimension || typeof value !== "string" || value !== UNCLASSIFIED_QUESTION_VALUE && !dimension.values.some(v => v.id === value)) {
      throw new QuestionClassificationError(400, "Unknown classification or value for this exam");
    }
    const expression = classificationExpression(dimension);
    conditions.push(`${expression.sql} = ?`); params.push(expression.values, value);
  }
  return { conditions, params };
}
