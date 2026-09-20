// implementation — Knowledge Point group catalog CRUD, shared by REST
// (routes/knowledgePointGroups.ts) and the User MCP adapter. "Ungrouped" is
// virtual (knowledge_points.group_id IS NULL) — never a real row here, so it
// can't be renamed/deleted through either surface. Deleting a group relies
// on the schema's ON DELETE SET NULL to fall member notes back to Ungrouped
// "for free" — no extra bookkeeping needed here.
import { normalizeGroupName } from "./knowledgePointTags";
import { scopeKeyFor } from "./knowledgePointOrdering";
import { ensureOrderScopeStatement, bumpOrderScopeStatement } from "./knowledgePointOrderScopes";

export interface GroupRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  note_count: number;
}

export function toGroup(row: GroupRow) {
  return { id: row.id, name: row.name, noteCount: row.note_count, createdAt: row.created_at, updatedAt: row.updated_at };
}

const GROUP_SELECT = `SELECT g.*, (SELECT COUNT(*) FROM knowledge_points kp WHERE kp.group_id = g.id) AS note_count FROM knowledge_point_groups g`;

export async function listGroups(db: D1Database, userId: string, page: { limit: number; offset: number }) {
  const [{ results }, total, ungrouped] = await Promise.all([
    db
      .prepare(`${GROUP_SELECT} WHERE g.user_id = ? ORDER BY g.name COLLATE NOCASE ASC, g.id ASC LIMIT ? OFFSET ?`)
      .bind(userId, page.limit, page.offset)
      .all<GroupRow>(),
    db.prepare("SELECT COUNT(*) AS n FROM knowledge_point_groups WHERE user_id = ?").bind(userId).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM knowledge_points WHERE user_id = ? AND group_id IS NULL").bind(userId).first<{ n: number }>(),
  ]);
  return { groups: (results ?? []).map(toGroup), total: total?.n ?? 0, ungroupedCount: ungrouped?.n ?? 0 };
}

export type CreateGroupResult = { ok: true; group: ReturnType<typeof toGroup> } | { ok: false; reason: "invalid_name" | "duplicate" };

export async function createGroup(db: D1Database, input: { userId: string; name: unknown }): Promise<CreateGroupResult> {
  const name = normalizeGroupName(input.name);
  if (!name) return { ok: false, reason: "invalid_name" };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.prepare("INSERT INTO knowledge_point_groups (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, input.userId, name, now, now).run();
  } catch {
    return { ok: false, reason: "duplicate" };
  }
  return { ok: true, group: toGroup({ id, name, created_at: now, updated_at: now, note_count: 0 }) };
}

export type RenameGroupResult = { ok: true; group: ReturnType<typeof toGroup> } | { ok: false; reason: "not_found" | "invalid_name" | "duplicate" };

export async function renameGroup(db: D1Database, input: { id: string; userId: string; name: unknown }): Promise<RenameGroupResult> {
  const existing = await db.prepare("SELECT id FROM knowledge_point_groups WHERE id = ? AND user_id = ?").bind(input.id, input.userId).first();
  if (!existing) return { ok: false, reason: "not_found" };
  const name = normalizeGroupName(input.name);
  if (!name) return { ok: false, reason: "invalid_name" };

  const now = new Date().toISOString();
  try {
    await db.prepare("UPDATE knowledge_point_groups SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(name, now, input.id, input.userId).run();
  } catch {
    return { ok: false, reason: "duplicate" };
  }
  const row = await db.prepare(`${GROUP_SELECT} WHERE g.id = ?`).bind(input.id).first<GroupRow>();
  return { ok: true, group: toGroup(row!) };
}

export async function deleteGroup(db: D1Database, input: { id: string; userId: string }): Promise<boolean> {
  const now = new Date().toISOString();
  const ungroupedScope = scopeKeyFor(null);
  // ON DELETE SET NULL falls every member note back to Ungrouped — that
  // scope's order revision must be invalidated too (unconditionally; the
  // group may or may not have had members, and bumping when it didn't is a
  // harmless no-op, unlike missing a real invalidation would be).
  const results = await db.batch([
    db.prepare("DELETE FROM knowledge_point_groups WHERE id = ? AND user_id = ?").bind(input.id, input.userId),
    ensureOrderScopeStatement(db, input.userId, ungroupedScope, now),
    bumpOrderScopeStatement(db, input.userId, ungroupedScope, now),
  ]);
  return results[0]!.meta.changes > 0;
}
