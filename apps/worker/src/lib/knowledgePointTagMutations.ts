// implementation — Knowledge Point tag catalog CRUD, shared by REST
// (routes/knowledgePointTags.ts) and the User MCP adapter. Renaming updates
// every note that carries the tag for free (links reference tag_id, not the
// tag text); deleting removes only the tag and its links, never the notes
// themselves. Attaching/detaching one tag to/from one specific note is
// lib/knowledgePointMutations.ts's attachTag/detachTag — this file only owns
// the tag catalog (list/create-by-rename/delete), matching REST's existing
// module boundary.
import { normalizeTagName } from "./knowledgePointTags";

export interface TagRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  note_count: number;
}

export function toTag(row: TagRow) {
  return { id: row.id, name: row.name, noteCount: row.note_count, createdAt: row.created_at, updatedAt: row.updated_at };
}

const TAG_SELECT = `SELECT t.*, (SELECT COUNT(*) FROM knowledge_point_tag_links l WHERE l.tag_id = t.id) AS note_count FROM knowledge_point_tags t`;

export async function listTags(db: D1Database, userId: string, page: { limit: number; offset: number }) {
  const [{ results }, total] = await Promise.all([
    db
      .prepare(`${TAG_SELECT} WHERE t.user_id = ? ORDER BY t.name COLLATE NOCASE ASC, t.id ASC LIMIT ? OFFSET ?`)
      .bind(userId, page.limit, page.offset)
      .all<TagRow>(),
    db.prepare("SELECT COUNT(*) AS n FROM knowledge_point_tags WHERE user_id = ?").bind(userId).first<{ n: number }>(),
  ]);
  return { tags: (results ?? []).map(toTag), total: total?.n ?? 0 };
}

export type RenameTagResult = { ok: true; tag: ReturnType<typeof toTag> } | { ok: false; reason: "not_found" | "invalid_name" | "duplicate" };

export async function renameTag(db: D1Database, input: { id: string; userId: string; name: unknown }): Promise<RenameTagResult> {
  const existing = await db.prepare("SELECT id FROM knowledge_point_tags WHERE id = ? AND user_id = ?").bind(input.id, input.userId).first();
  if (!existing) return { ok: false, reason: "not_found" };
  const name = normalizeTagName(input.name);
  if (!name) return { ok: false, reason: "invalid_name" };

  const now = new Date().toISOString();
  try {
    await db.prepare("UPDATE knowledge_point_tags SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(name, now, input.id, input.userId).run();
  } catch {
    return { ok: false, reason: "duplicate" };
  }
  const row = await db.prepare(`${TAG_SELECT} WHERE t.id = ?`).bind(input.id).first<TagRow>();
  return { ok: true, tag: toTag(row!) };
}

export async function deleteTag(db: D1Database, input: { id: string; userId: string }): Promise<boolean> {
  const result = await db.prepare("DELETE FROM knowledge_point_tags WHERE id = ? AND user_id = ?").bind(input.id, input.userId).run();
  return result.meta.changes > 0;
}
