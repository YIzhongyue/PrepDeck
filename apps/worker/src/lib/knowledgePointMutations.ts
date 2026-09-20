// implementation — the write side of Knowledge Points, shared by REST
// (routes/knowledgePoints.ts) and the User MCP adapter. Every function here
// scopes its own ownership checks (`WHERE id = ? AND user_id = ?`) rather
// than trusting a caller-verified id, and returns a discriminated result
// instead of throwing an HTTP- or MCP-flavored error, so each caller maps
// `reason` to its own error shape.
//
// `applyNoteUpdate` (content-only autosave) delegates to the same atomic
// content/attachment operation as MCP. `applyGroupMove` remains REST's
// separate group reassignment endpoint. MCP uses
// `applyNoteEdit`, a single atomic operation combining content, group, and
// attachment-status changes under one revision check, because sequentially
// calling REST's two separate functions cannot make the combination atomic
// (see the review notes on implementation's plan: content could commit while a
// group move fails, or an old client's group move could land after a newer
// content save).
import { countMermaidFences, stripMarkdownToExcerpt } from "./knowledgePointExcerpt";
import { reconcileImageStatuses, type KnownKnowledgePointImage } from "./knowledgePointImageReconciliation";
import { enqueueImageRetirementStatement, flushRetiredImages, type RetiredImage } from "./knowledgePointImageRetirement";
import { computeMidpointPosition, rebalancePositions, scopeKeyFor, POSITION_GAP } from "./knowledgePointOrdering";
import { ensureOrderScopeStatement, bumpOrderScopeStatement, casOrderScopeStatement, freshRevisionToken, SELECT_ORDER_REVISION_SQL } from "./knowledgePointOrderScopes";
import { normalizeTagName } from "./knowledgePointTags";
import { loadDetail } from "./knowledgePointDetail";

type Detail = NonNullable<Awaited<ReturnType<typeof loadDetail>>>;

// --- Create -----------------------------------------------------------------

export interface CreateNoteInput {
  userId: string;
  groupId?: string | null;
  title?: string;
  bodyMarkdown?: string;
  tagNames?: string[];
  linkedQuestionIds?: string[];
  maxTags?: number;
  maxLinkedQuestions?: number;
}

export type CreateNoteResult =
  | { ok: true; id: string }
  | { ok: false; reason: "group_not_found" | "question_not_found" | "invalid_tag_name" | "too_many_tags" | "too_many_questions" };

// REST's own POST / only ever supplies {userId, groupId} (today's
// blank-note behavior, preserved exactly). The optional title/bodyMarkdown/
// tagNames/linkedQuestionIds fields exist for MCP's `user_create_knowledge_point`,
// which — per implementation — must be able to create a note with its initial
// content and relationships atomically rather than forcing N follow-up
// mutation calls that could leave a caller with a half-tagged note if it
// gives up partway through.
export async function createNote(db: D1Database, input: CreateNoteInput): Promise<CreateNoteResult> {
  const { userId } = input;
  const groupId = input.groupId ?? null;
  const title = input.title ?? "";
  const bodyMarkdown = input.bodyMarkdown ?? "";
  const requestedTagNames = input.tagNames ?? [];
  const linkedQuestionIds = [...new Set(input.linkedQuestionIds ?? [])];

  if (input.maxTags != null && requestedTagNames.length > input.maxTags) return { ok: false, reason: "too_many_tags" };
  if (input.maxLinkedQuestions != null && linkedQuestionIds.length > input.maxLinkedQuestions) {
    return { ok: false, reason: "too_many_questions" };
  }

  const normalizedTagNames: string[] = [];
  for (const raw of requestedTagNames) {
    const name = normalizeTagName(raw);
    if (!name) return { ok: false, reason: "invalid_tag_name" };
    if (!normalizedTagNames.some((n) => n.toLowerCase() === name.toLowerCase())) normalizedTagNames.push(name);
  }

  // Validate everything up front, before any write — a bad field must never
  // leave a partially-created note behind.
  if (groupId != null) {
    const group = await db.prepare("SELECT id FROM knowledge_point_groups WHERE id = ? AND user_id = ?").bind(groupId, userId).first();
    if (!group) return { ok: false, reason: "group_not_found" };
  }
  if (linkedQuestionIds.length > 0) {
    // D1 parameter-budget convention: one JSON-array bind, not one bound
    // parameter per id (see mcp/adapter.ts's getLearningOverview).
    const { results } = await db
      .prepare("SELECT id FROM questions WHERE id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(linkedQuestionIds))
      .all<{ id: string }>();
    const found = new Set((results ?? []).map((r) => r.id));
    if (linkedQuestionIds.some((qid) => !found.has(qid))) return { ok: false, reason: "question_not_found" };
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const scopeKey = scopeKeyFor(groupId);
  const maxPos = await db
    .prepare("SELECT COALESCE(MAX(position), 0) AS n FROM knowledge_points WHERE user_id = ? AND group_id IS ?")
    .bind(userId, groupId)
    .first<{ n: number }>();
  const position = (maxPos?.n ?? 0) + POSITION_GAP;
  const excerpt = bodyMarkdown ? stripMarkdownToExcerpt(bodyMarkdown) : "";
  const mermaidCount = bodyMarkdown ? countMermaidFences(bodyMarkdown) : 0;

  // Resolve each requested tag name to an id: an existing tag (case
  // insensitive) is reused; a name with no match gets a freshly minted
  // candidate row inserted best-effort in the same batch as the note.
  const existingTags = normalizedTagNames.length
    ? ((
        await db
          .prepare(`SELECT id, name FROM knowledge_point_tags WHERE user_id = ? AND name COLLATE NOCASE IN (SELECT value FROM json_each(?))`)
          .bind(userId, JSON.stringify(normalizedTagNames))
          .all<{ id: string; name: string }>()
      ).results ?? [])
    : [];
  const existingByLowerName = new Map(existingTags.map((t) => [t.name.toLowerCase(), t.id]));
  const tagPlan = normalizedTagNames.map((name) => {
    const existingId = existingByLowerName.get(name.toLowerCase());
    return existingId ? { name, id: existingId, isNew: false } : { name, id: crypto.randomUUID(), isNew: true };
  });

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO knowledge_points (id, user_id, group_id, title, body_markdown, excerpt, mermaid_count, position, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .bind(id, userId, groupId, title, bodyMarkdown, excerpt, mermaidCount, position, now, now),
    ensureOrderScopeStatement(db, userId, scopeKey, now),
    bumpOrderScopeStatement(db, userId, scopeKey, now),
  ];
  for (const tag of tagPlan) {
    if (tag.isNew) {
      statements.push(
        db
          .prepare("INSERT OR IGNORE INTO knowledge_point_tags (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
          .bind(tag.id, userId, tag.name, now, now)
      );
    }
    // Resolve the winning tag id by NAME at link-insert time, inside this
    // same transaction, rather than assuming our own candidate id above (for
    // a brand-new tag) is the one that ends up existing. A concurrent create
    // can win the unique-name race between our earlier SELECT and this
    // batch — INSERT OR IGNORE does not suppress the tag_links foreign-key
    // violation that binding our (losing) candidate id would cause, so it
    // would abort and roll back this whole batch, not silently no-op. This
    // SELECT-based insert has no such failure mode: by the time it runs, the
    // tag-insert statement above (if any) has already executed in this same
    // batch, so some row with this name is guaranteed to exist, whichever
    // create actually won it.
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO knowledge_point_tag_links (knowledge_point_id, tag_id)
           SELECT ?, id FROM knowledge_point_tags WHERE user_id = ? AND name = ? COLLATE NOCASE`
        )
        .bind(id, userId, tag.name)
    );
  }
  for (const questionId of linkedQuestionIds) {
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO knowledge_point_question_links (knowledge_point_id, question_id, created_at) VALUES (?, ?, ?)")
        .bind(id, questionId, now)
    );
  }

  await db.batch(statements);
  return { ok: true, id };
}

// --- Content-only autosave (REST's PUT /:id) ----------------------------------

export type ApplyNoteUpdateResult = { ok: true; detail: Detail } | { ok: false; reason: "not_found" | "conflict" };

export async function applyNoteUpdate(
  db: D1Database,
  input: { id: string; userId: string; baseRevision: number; title: string; bodyMarkdown: string }
): Promise<ApplyNoteUpdateResult> {
  const result = await applyNoteEdit(db, input);
  if (result.ok) return result;
  return { ok: false, reason: result.reason === "group_not_found" ? "not_found" : result.reason };
}

// --- Ungated group move (REST's PATCH /:id/group — unchanged, MCP does not call this) ---

export type ApplyGroupMoveResult = { ok: true } | { ok: false; reason: "not_found" | "group_not_found" };

export async function applyGroupMove(db: D1Database, input: { id: string; userId: string; groupId: string | null }): Promise<ApplyGroupMoveResult> {
  const { id, userId, groupId } = input;
  const existing = await db.prepare("SELECT group_id FROM knowledge_points WHERE id = ? AND user_id = ?").bind(id, userId).first<{ group_id: string | null }>();
  if (!existing) return { ok: false, reason: "not_found" };
  if (groupId != null) {
    const group = await db.prepare("SELECT id FROM knowledge_point_groups WHERE id = ? AND user_id = ?").bind(groupId, userId).first();
    if (!group) return { ok: false, reason: "group_not_found" };
  }
  const maxPos = await db
    .prepare("SELECT COALESCE(MAX(position), 0) AS n FROM knowledge_points WHERE user_id = ? AND group_id IS ? AND id != ?")
    .bind(userId, groupId, id)
    .first<{ n: number }>();
  const position = (maxPos?.n ?? 0) + POSITION_GAP;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE knowledge_points SET group_id = ?, position = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(groupId, position, now, id, userId),
  ];
  // Invalidate both the source and destination scope's order revision — a
  // reader on either side who took an expectedOrderRevision before this move
  // must be rejected if they try to reorder against it afterward, even
  // though this REST endpoint itself takes no revision from its own caller.
  for (const scope of new Set([scopeKeyFor(existing.group_id), scopeKeyFor(groupId)])) {
    statements.push(ensureOrderScopeStatement(db, userId, scope, now), bumpOrderScopeStatement(db, userId, scope, now));
  }
  await db.batch(statements);
  return { ok: true };
}

// --- Atomic combined edit (MCP's user_update_knowledge_point) ---------------

export interface ApplyNoteEditInput {
  id: string;
  userId: string;
  baseRevision: number;
  title?: string;
  bodyMarkdown?: string;
  // Tri-state: key absent (=== undefined, the only possibility for an
  // omitted JSON-RPC field) means "leave the group unchanged"; null means
  // Ungrouped; a string moves the note to that group.
  groupId?: string | null;
}

export type ApplyNoteEditResult = { ok: true; detail: Detail } | { ok: false; reason: "not_found" | "group_not_found" | "conflict" };

export async function applyNoteEdit(db: D1Database, input: ApplyNoteEditInput): Promise<ApplyNoteEditResult> {
  const { id, userId, baseRevision } = input;
  const current = await db
    .prepare("SELECT title, body_markdown, group_id FROM knowledge_points WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<{ title: string; body_markdown: string; group_id: string | null }>();
  if (!current) return { ok: false, reason: "not_found" };

  const finalTitle = input.title ?? current.title;
  const finalBody = input.bodyMarkdown ?? current.body_markdown;
  const excerpt = stripMarkdownToExcerpt(finalBody);
  const mermaidCount = countMermaidFences(finalBody);
  const now = new Date().toISOString();
  // A fresh, unpredictable target — NOT baseRevision + 1 — for the same
  // reason casOrderScopeStatement's doc comment explains: a dependent
  // statement guarded by "did the gate reach revision X" must not use a
  // predictable X, or a stale gate (which leaves revision untouched) can
  // coincidentally already sit at that X whenever baseRevision happens to be
  // exactly one behind the real value — precisely the most common
  // stale-retry shape — making the "dependent" wrongly apply even though
  // the gate itself was rejected.
  const newRevision = freshRevisionToken();

  const groupChanging = input.groupId !== undefined && input.groupId !== current.group_id;
  let newGroupId = current.group_id;
  let newPosition: number | null = null;
  if (groupChanging) {
    newGroupId = input.groupId as string | null;
    if (newGroupId != null) {
      const group = await db.prepare("SELECT id FROM knowledge_point_groups WHERE id = ? AND user_id = ?").bind(newGroupId, userId).first();
      if (!group) return { ok: false, reason: "group_not_found" };
    }
    const maxPos = await db
      .prepare("SELECT COALESCE(MAX(position), 0) AS n FROM knowledge_points WHERE user_id = ? AND group_id IS ? AND id != ?")
      .bind(userId, newGroupId, id)
      .first<{ n: number }>();
    newPosition = (maxPos?.n ?? 0) + POSITION_GAP;
  }

  // Gate: content + (optionally) group/position, all in ONE statement, so
  // they can never partially apply relative to each other.
  const statements: D1PreparedStatement[] = [
    groupChanging
      ? db
          .prepare(
            `UPDATE knowledge_points SET title=?, body_markdown=?, excerpt=?, mermaid_count=?, group_id=?, position=?, revision=?, updated_at=?
             WHERE id=? AND user_id=? AND revision=?`
          )
          .bind(finalTitle, finalBody, excerpt, mermaidCount, newGroupId, newPosition, newRevision, now, id, userId, baseRevision)
      : db
          .prepare(
            `UPDATE knowledge_points SET title=?, body_markdown=?, excerpt=?, mermaid_count=?, revision=?, updated_at=?
             WHERE id=? AND user_id=? AND revision=?`
          )
          .bind(finalTitle, finalBody, excerpt, mermaidCount, newRevision, now, id, userId, baseRevision),
  ];

  // Dependents: guarded by the gate's post-write state (id/revision), so a
  // stale gate leaves these as harmless no-ops instead of applying against
  // the wrong content — see knowledgePointMutations.ts's header comment and
  // the design note in the implementation plan for why this can't just be two
  // separately-successful calls.
  const knownImages = await db.prepare("SELECT id, status FROM knowledge_point_images WHERE knowledge_point_id = ?").bind(id).all<KnownKnowledgePointImage>();
  const { toAttach, toOrphan } = reconcileImageStatuses(finalBody, knownImages.results ?? []);
  const gateGuard = `EXISTS (SELECT 1 FROM knowledge_points WHERE id = ? AND revision = ?)`;
  // D1 parameter-budget convention (see mcp/adapter.ts's getLearningOverview):
  // one JSON-array bind, not one bound parameter per image id — a note can
  // carry far more than ~95 images via REST (which has no cap), and one
  // parameter per id would otherwise blow past D1's 100-bound-parameter
  // limit for a note anywhere near that size.
  if (toAttach.length) {
    statements.push(
      db
        .prepare(`UPDATE knowledge_point_images SET status = 'attached', updated_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND ${gateGuard}`)
        .bind(now, JSON.stringify(toAttach), id, newRevision)
    );
  }
  if (toOrphan.length) {
    statements.push(
      db
        .prepare(`UPDATE knowledge_point_images SET status = 'orphaned', updated_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND ${gateGuard}`)
        .bind(now, JSON.stringify(toOrphan), id, newRevision)
    );
  }
  if (groupChanging) {
    for (const scope of new Set([scopeKeyFor(current.group_id), scopeKeyFor(newGroupId)])) {
      statements.push(ensureOrderScopeStatement(db, userId, scope, now));
      statements.push(
        db
          .prepare(`UPDATE knowledge_point_order_scopes SET revision = revision + 1, updated_at = ? WHERE user_id = ? AND scope_key = ? AND ${gateGuard}`)
          .bind(now, userId, scope, id, newRevision)
      );
    }
  }

  const results = await db.batch(statements);
  if (results[0]!.meta.changes === 0) return { ok: false, reason: "conflict" };

  const detail = await loadDetail(db, id, userId);
  return { ok: true, detail: detail! };
}

// --- Delete -------------------------------------------------------------------

export async function deleteNote(db: D1Database, bucket: R2Bucket, input: { id: string; userId: string }): Promise<boolean> {
  const { id, userId } = input;
  const existing = await db.prepare("SELECT group_id FROM knowledge_points WHERE id = ? AND user_id = ?").bind(id, userId).first<{ group_id: string | null }>();
  if (!existing) return false;

  const images = await db.prepare("SELECT id, r2_object_key FROM knowledge_point_images WHERE knowledge_point_id = ?").bind(id).all<RetiredImage>();

  const now = new Date().toISOString();
  const scopeKey = scopeKeyFor(existing.group_id);
  // Deleting a note only removes its own row (and, via DB cascade, its
  // tag_links/question_links/image rows) — never the group, tags, or linked
  // questions themselves.
  //
  // The cascade takes the image ROWS with it, so their tombstones have to be
  // enqueued in this same batch: afterwards there is nothing left to say which
  // R2 objects belonged to this note. Deleting from R2 before the batch (as
  // this used to) also meant a failure there aborted the delete outright, and
  // a failure after it stranded the objects silently.
  await db.batch([
    enqueueImageRetirementStatement(db, images.results ?? [], Date.now()),
    db.prepare("DELETE FROM knowledge_points WHERE id = ? AND user_id = ?").bind(id, userId),
    ensureOrderScopeStatement(db, userId, scopeKey, now),
    bumpOrderScopeStatement(db, userId, scopeKey, now),
  ]);
  await flushRetiredImages(db, bucket, images.results ?? []);
  return true;
}

// --- Question links -----------------------------------------------------------

export type LinkQuestionResult = { ok: true } | { ok: false; reason: "kp_not_found" | "question_not_found" | "cap_exceeded" };

export async function linkQuestion(
  db: D1Database,
  input: { id: string; userId: string; questionId: string; maxLinkedQuestions?: number }
): Promise<LinkQuestionResult> {
  const { id, userId, questionId, maxLinkedQuestions } = input;
  const kp = await db.prepare("SELECT id FROM knowledge_points WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!kp) return { ok: false, reason: "kp_not_found" };
  const question = await db.prepare("SELECT id FROM questions WHERE id = ?").bind(questionId).first();
  if (!question) return { ok: false, reason: "question_not_found" };

  // Idempotent no-op: an already-linked question always succeeds, even at
  // capacity — relinking isn't "adding a new relationship".
  const existing = await db.prepare("SELECT 1 FROM knowledge_point_question_links WHERE knowledge_point_id = ? AND question_id = ?").bind(id, questionId).first();
  if (existing) return { ok: true };

  const now = new Date().toISOString();
  if (maxLinkedQuestions == null) {
    await db
      .prepare("INSERT OR IGNORE INTO knowledge_point_question_links (knowledge_point_id, question_id, created_at) VALUES (?, ?, ?)")
      .bind(id, questionId, now)
      .run();
    return { ok: true };
  }

  // The count-check and the insert happen in one statement, closing the
  // race window a separate "COUNT(*) then INSERT" would leave open.
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO knowledge_point_question_links (knowledge_point_id, question_id, created_at)
       SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM knowledge_point_question_links WHERE knowledge_point_id = ?) < ?`
    )
    .bind(id, questionId, now, id, maxLinkedQuestions)
    .run();
  if (result.meta.changes > 0) return { ok: true };
  const after = await db.prepare("SELECT 1 FROM knowledge_point_question_links WHERE knowledge_point_id = ? AND question_id = ?").bind(id, questionId).first();
  return after ? { ok: true } : { ok: false, reason: "cap_exceeded" };
}

export type UnlinkQuestionResult = { ok: true } | { ok: false; reason: "kp_not_found" | "link_not_found" };

export async function unlinkQuestion(db: D1Database, input: { id: string; userId: string; questionId: string }): Promise<UnlinkQuestionResult> {
  const { id, userId, questionId } = input;
  const kp = await db.prepare("SELECT id FROM knowledge_points WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!kp) return { ok: false, reason: "kp_not_found" };
  const result = await db.prepare("DELETE FROM knowledge_point_question_links WHERE knowledge_point_id = ? AND question_id = ?").bind(id, questionId).run();
  return result.meta.changes > 0 ? { ok: true } : { ok: false, reason: "link_not_found" };
}

// --- Per-note tag links ---------------------------------------------------------

async function resolveOrCreateTag(db: D1Database, userId: string, name: string, now: string): Promise<string> {
  const existing = await db.prepare("SELECT id FROM knowledge_point_tags WHERE user_id = ? AND name = ? COLLATE NOCASE").bind(userId, name).first<{ id: string }>();
  if (existing) return existing.id;
  const tagId = crypto.randomUUID();
  const inserted = await db
    .prepare("INSERT INTO knowledge_point_tags (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(tagId, userId, name, now, now)
    .run()
    .then(() => true)
    .catch(() => false);
  // A concurrent create can win the unique-name race between our SELECT and
  // INSERT — that INSERT throws (unique index violation) rather than
  // silently no-op-ing, so re-resolve instead of trusting our own attempt.
  if (inserted) return tagId;
  const real = await db.prepare("SELECT id FROM knowledge_point_tags WHERE user_id = ? AND name = ? COLLATE NOCASE").bind(userId, name).first<{ id: string }>();
  return real!.id;
}

export type AttachTagResult = { ok: true; tagId: string } | { ok: false; reason: "kp_not_found" | "invalid_name" | "cap_exceeded" };

export async function attachTag(db: D1Database, input: { id: string; userId: string; name: unknown; maxTags?: number }): Promise<AttachTagResult> {
  const { id, userId, maxTags } = input;
  const kp = await db.prepare("SELECT id FROM knowledge_points WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!kp) return { ok: false, reason: "kp_not_found" };
  const name = normalizeTagName(input.name);
  if (!name) return { ok: false, reason: "invalid_name" };

  const now = new Date().toISOString();
  const tagId = await resolveOrCreateTag(db, userId, name, now);

  const existing = await db.prepare("SELECT 1 FROM knowledge_point_tag_links WHERE knowledge_point_id = ? AND tag_id = ?").bind(id, tagId).first();
  if (existing) return { ok: true, tagId };

  if (maxTags == null) {
    await db.prepare("INSERT OR IGNORE INTO knowledge_point_tag_links (knowledge_point_id, tag_id) VALUES (?, ?)").bind(id, tagId).run();
    return { ok: true, tagId };
  }

  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO knowledge_point_tag_links (knowledge_point_id, tag_id)
       SELECT ?, ? WHERE (SELECT COUNT(*) FROM knowledge_point_tag_links WHERE knowledge_point_id = ?) < ?`
    )
    .bind(id, tagId, id, maxTags)
    .run();
  if (result.meta.changes > 0) return { ok: true, tagId };
  const after = await db.prepare("SELECT 1 FROM knowledge_point_tag_links WHERE knowledge_point_id = ? AND tag_id = ?").bind(id, tagId).first();
  return after ? { ok: true, tagId } : { ok: false, reason: "cap_exceeded" };
}

export type DetachTagResult = { ok: true } | { ok: false; reason: "kp_not_found" | "link_not_found" };

// Removes only this one note's link to the tag — the tag itself, and its
// links to any other note, are untouched. (Deleting the tag catalog entry
// entirely is lib/knowledgePointTagMutations.ts's deleteTag.)
export async function detachTag(db: D1Database, input: { id: string; userId: string; tagId: string }): Promise<DetachTagResult> {
  const { id, userId, tagId } = input;
  const kp = await db.prepare("SELECT id FROM knowledge_points WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!kp) return { ok: false, reason: "kp_not_found" };
  const result = await db.prepare("DELETE FROM knowledge_point_tag_links WHERE knowledge_point_id = ? AND tag_id = ?").bind(id, tagId).run();
  return result.meta.changes > 0 ? { ok: true } : { ok: false, reason: "link_not_found" };
}

// --- Reorder (order-revision CAS'd) --------------------------------------------

interface NeighborPositions {
  prevPos: number | null;
  nextPos: number | null;
  beforeRowGroupId?: string | null;
}

async function neighborPositions(
  db: D1Database,
  userId: string,
  groupId: string | null,
  excludeId: string,
  beforeId: string | null
): Promise<NeighborPositions | null> {
  if (beforeId) {
    const beforeRow = await db.prepare("SELECT group_id, position FROM knowledge_points WHERE id = ? AND user_id = ?").bind(beforeId, userId).first<{ group_id: string | null; position: number }>();
    if (!beforeRow) return null;
    const nextPos = beforeRow.position;
    const prevRow = await db
      .prepare("SELECT position FROM knowledge_points WHERE user_id = ? AND group_id IS ? AND id != ? AND position < ? ORDER BY position DESC LIMIT 1")
      .bind(userId, groupId, excludeId, nextPos)
      .first<{ position: number }>();
    return { prevPos: prevRow?.position ?? null, nextPos, beforeRowGroupId: beforeRow.group_id };
  }
  const lastRow = await db
    .prepare("SELECT MAX(position) AS n FROM knowledge_points WHERE user_id = ? AND group_id IS ? AND id != ?")
    .bind(userId, groupId, excludeId)
    .first<{ n: number | null }>();
  return { prevPos: lastRow?.n ?? null, nextPos: null };
}

// REST's own PATCH /:id/reorder — unchanged, ungated behavior (no version
// check). MCP does not call this; it uses the CAS'd reorderNote below, which
// is the one implementation requires to reject stale/concurrent reordering.
export type ApplyReorderResult = { ok: true; position: number } | { ok: false; reason: "not_found" | "before_not_found" | "cross_group" | "exhausted" };

export async function applyReorder(db: D1Database, input: { id: string; userId: string; beforeId: string | null }): Promise<ApplyReorderResult> {
  const { id, userId, beforeId } = input;
  const moved = await db.prepare("SELECT group_id FROM knowledge_points WHERE id = ? AND user_id = ?").bind(id, userId).first<{ group_id: string | null }>();
  if (!moved) return { ok: false, reason: "not_found" };

  let neighbors = await neighborPositions(db, userId, moved.group_id, id, beforeId);
  if (!neighbors) return { ok: false, reason: "before_not_found" };
  if (beforeId && neighbors.beforeRowGroupId !== moved.group_id) return { ok: false, reason: "cross_group" };

  let newPosition = computeMidpointPosition(neighbors.prevPos, neighbors.nextPos);
  if (newPosition == null) {
    const scoped = await db
      .prepare("SELECT id, position FROM knowledge_points WHERE user_id = ? AND group_id IS ? ORDER BY position ASC, id ASC")
      .bind(userId, moved.group_id)
      .all<{ id: string; position: number }>();
    const rebalanced = rebalancePositions(scoped.results ?? []);
    await db.batch(rebalanced.map((row) => db.prepare("UPDATE knowledge_points SET position = ? WHERE id = ?").bind(row.position, row.id)));
    neighbors = await neighborPositions(db, userId, moved.group_id, id, beforeId);
    newPosition = neighbors ? computeMidpointPosition(neighbors.prevPos, neighbors.nextPos) : null;
    if (newPosition == null) return { ok: false, reason: "exhausted" };
  }

  const now = new Date().toISOString();
  const scopeKey = scopeKeyFor(moved.group_id);
  // Invalidate the scope's order revision even though this REST endpoint
  // takes no revision from its own caller — an MCP reader who took an
  // expectedOrderRevision before this REST reorder must be rejected if they
  // try to reorder against it afterward.
  await db.batch([
    db.prepare("UPDATE knowledge_points SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(newPosition, now, id, userId),
    ensureOrderScopeStatement(db, userId, scopeKey, now),
    bumpOrderScopeStatement(db, userId, scopeKey, now),
  ]);
  return { ok: true, position: newPosition };
}

export type ReorderNoteResult = { ok: true; position: number } | { ok: false; reason: "not_found" | "before_not_found" | "cross_group" | "exhausted" | "conflict" };

export async function reorderNote(
  db: D1Database,
  input: { id: string; userId: string; beforeId: string | null; expectedOrderRevision?: number }
): Promise<ReorderNoteResult> {
  const { id, userId, beforeId } = input;
  const moved = await db.prepare("SELECT group_id FROM knowledge_points WHERE id = ? AND user_id = ?").bind(id, userId).first<{ group_id: string | null }>();
  if (!moved) return { ok: false, reason: "not_found" };

  const neighbors = await neighborPositions(db, userId, moved.group_id, id, beforeId);
  if (!neighbors) return { ok: false, reason: "before_not_found" };
  if (beforeId && neighbors.beforeRowGroupId !== moved.group_id) return { ok: false, reason: "cross_group" };

  const scopeKey = scopeKeyFor(moved.group_id);
  // A caller that supplies no expectation gets the scope's CURRENT revision as
  // its own — see routes/knowledgePoints.ts for why that stays accepted for
  // one release. This keeps the CAS below structurally identical (it still
  // makes the whole batch atomic against a reorder landing during this
  // request); the only thing it cannot check is whether the caller was looking
  // at a stale rendering, which is exactly the pre-implementation guarantee.
  const expectedOrderRevision = input.expectedOrderRevision
    ?? Number((await db.prepare(SELECT_ORDER_REVISION_SQL).bind(userId, scopeKey).first<{ revision: number }>())?.revision ?? 1);
  const now = new Date().toISOString();
  let newPosition = computeMidpointPosition(neighbors.prevPos, neighbors.nextPos);

  if (newPosition != null) {
    // newRevision is a fresh, unpredictable target (see
    // casOrderScopeStatement's doc comment) — the dependent position update
    // below checks "did the scope reach exactly newRevision" to know whether
    // the gate applied, which only works if newRevision could never already
    // be sitting there from before. expectedOrderRevision + 1 would NOT be
    // safe here: a stale caller whose expectedOrderRevision is exactly one
    // behind the real value would leave the scope's untouched revision
    // coincidentally equal to that target, making the dependent wrongly
    // apply even though the CAS gate itself was rejected.
    const newRevision = freshRevisionToken();
    const results = await db.batch([
      ensureOrderScopeStatement(db, userId, scopeKey, now),
      casOrderScopeStatement(db, userId, scopeKey, expectedOrderRevision, newRevision, now),
      db
        .prepare(
          `UPDATE knowledge_points SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?
             AND EXISTS (SELECT 1 FROM knowledge_point_order_scopes WHERE user_id = ? AND scope_key = ? AND revision = ?)`
        )
        .bind(newPosition, now, id, userId, userId, scopeKey, newRevision),
    ]);
    if (results[1]!.meta.changes === 0) return { ok: false, reason: "conflict" };
    return { ok: true, position: newPosition };
  }

  // Float exhaustion: rebalance the whole scope (one CAS-gated batch), then
  // recompute the moved row's own position against the freshly spaced
  // neighbors and write it (a second, separately CAS-gated step — if
  // another request races in between, this second step's own CAS correctly
  // reports a conflict rather than silently moving against stale neighbors).
  const scoped = await db
    .prepare("SELECT id, position FROM knowledge_points WHERE user_id = ? AND group_id IS ? ORDER BY position ASC, id ASC")
    .bind(userId, moved.group_id)
    .all<{ id: string; position: number }>();
  const rebalanced = rebalancePositions(scoped.results ?? []);
  const afterRebalanceRevision = freshRevisionToken();

  const rebalanceStatements: D1PreparedStatement[] = [
    ensureOrderScopeStatement(db, userId, scopeKey, now),
    casOrderScopeStatement(db, userId, scopeKey, expectedOrderRevision, afterRebalanceRevision, now),
  ];
  for (const row of rebalanced) {
    rebalanceStatements.push(
      db
        .prepare(
          `UPDATE knowledge_points SET position = ? WHERE id = ?
             AND EXISTS (SELECT 1 FROM knowledge_point_order_scopes WHERE user_id = ? AND scope_key = ? AND revision = ?)`
        )
        .bind(row.position, row.id, userId, scopeKey, afterRebalanceRevision)
    );
  }
  const rebalanceResults = await db.batch(rebalanceStatements);
  if (rebalanceResults[1]!.meta.changes === 0) return { ok: false, reason: "conflict" };

  const rebalancedNeighbors = await neighborPositions(db, userId, moved.group_id, id, beforeId);
  newPosition = rebalancedNeighbors ? computeMidpointPosition(rebalancedNeighbors.prevPos, rebalancedNeighbors.nextPos) : null;
  if (newPosition == null) return { ok: false, reason: "exhausted" };

  const afterMoveRevision = freshRevisionToken();
  const moveResults = await db.batch([
    casOrderScopeStatement(db, userId, scopeKey, afterRebalanceRevision, afterMoveRevision, now),
    db
      .prepare(
        `UPDATE knowledge_points SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?
           AND EXISTS (SELECT 1 FROM knowledge_point_order_scopes WHERE user_id = ? AND scope_key = ? AND revision = ?)`
      )
      .bind(newPosition, now, id, userId, userId, scopeKey, afterMoveRevision),
  ]);
  if (moveResults[0]!.meta.changes === 0) return { ok: false, reason: "conflict" };
  return { ok: true, position: newPosition };
}
