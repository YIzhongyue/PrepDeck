// implementation — admin-managed question-bank taxonomy: question_bank_tags is
// the canonical catalog (a stable id + display name + a normalized identity
// column used for all matching) and question_tag_links is the ID-based
// many-to-many association with `questions`, replacing the old
// questions.tags_json name-array as live storage. Deliberately kept separate
// from lib/knowledgePointTagMutations.ts's per-user Knowledge Point tags
// (implementation) — this catalog is admin-global, that one is private per user; implementation
// only touches the question-bank side.
//
// Tool inputs at the MCP/REST boundary stay name-addressed (see
// mcp/adapter.ts) — everything in here resolves a name to a catalog id
// before doing anything else, so a rename/merge only ever has to touch the
// catalog + join rows, never any question's own content.
import { normalizeTagKey, normalizeTagName } from "@prepdeck/shared";
export { normalizeTagKey, normalizeTagName } from "@prepdeck/shared";

const D1_IN_CLAUSE_CHUNK = 90;
const D1_BATCH_STATEMENT_CHUNK = 50;

export interface TagCatalogEntry {
  id: string;
  name: string;
  normalizedName: string;
  revision: number;
}

interface TagCatalogRow {
  id: string;
  name: string;
  normalized_name: string;
  revision: number;
}

function toTagCatalogEntry(row: TagCatalogRow): TagCatalogEntry {
  return { id: row.id, name: row.name, normalizedName: row.normalized_name, revision: row.revision };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

export async function findTagCatalogRowByName(db: D1Database, name: string): Promise<TagCatalogEntry | null> {
  const row = await db.prepare(`SELECT id, name, normalized_name, revision FROM question_bank_tags WHERE normalized_name = ?`)
    .bind(normalizeTagKey(name)).first<TagCatalogRow>();
  return row ? toTagCatalogEntry(row) : null;
}

export async function findTagCatalogRowById(db: D1Database, id: string): Promise<TagCatalogEntry | null> {
  const row = await db.prepare(`SELECT id, name, normalized_name, revision FROM question_bank_tags WHERE id = ?`)
    .bind(id).first<TagCatalogRow>();
  return row ? toTagCatalogEntry(row) : null;
}

// implementation review — a read-only snapshot of how every distinct tag name
// in an import file currently resolves against the catalog: an existing
// tag's id, or `null` for a name with no current match (would be newly
// created on commit). Never mutates the catalog (unlike resolveOrCreateTags)
// — this exists purely so admin_preview_import/admin_execute_import
// (mcp/adapter.ts) can bind "what these names would resolve to" into the
// same fileToken that already binds the reviewed file content, so a
// taxonomy change between preview and execute (a rename or merge that
// changes what an unchanged name would now resolve to) invalidates the
// approved resolution instead of silently committing a different tag
// identity than what was previewed. Keyed by normalized identity (not raw
// spelling) and returned with sorted keys so the snapshot hashes
// deterministically regardless of input order or duplicate spellings.
export async function tagResolutionSnapshot(db: D1Database, names: string[]): Promise<Record<string, string | null>> {
  const keys = [...new Set(names.map((n) => normalizeTagName(n)).filter((n): n is string => !!n).map(normalizeTagKey))].sort();
  const found = new Map<string, string>();
  for (const group of chunk(keys, D1_IN_CLAUSE_CHUNK)) {
    const placeholders = group.map(() => "?").join(",");
    const { results } = await db.prepare(
      `SELECT id, normalized_name FROM question_bank_tags WHERE normalized_name IN (${placeholders})`,
    ).bind(...group).all<{ id: string; normalized_name: string }>();
    for (const row of results ?? []) found.set(row.normalized_name, row.id);
  }
  const snapshot: Record<string, string | null> = {};
  for (const key of keys) snapshot[key] = found.get(key) ?? null;
  return snapshot;
}

export async function listTagCatalogNames(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(`SELECT name FROM question_bank_tags ORDER BY name`).all<{ name: string }>();
  return (results ?? []).map((r) => r.name);
}

// Resolves each name to its catalog identity, registering a brand-new
// catalog row for any name that isn't one yet — the same "typing a new tag
// on a question registers it" behavior implementation had, just id-based now. Dedupes
// by normalized key up front (so "AWS" and "aws" in the same call resolve
// to one row, first-seen spelling wins for a newly-created row) and returns
// one entry per distinct input name, in first-seen order.
//
// Never called from a preview/validate path (only from an actual
// create/update/import-execute commit) — resolving a name that doesn't
// exist yet always creates it, so previewing this would create tags nobody
// committed to yet.
export async function resolveOrCreateTags(db: D1Database, names: string[], now: string): Promise<TagCatalogEntry[]> {
  const byKey = new Map<string, string>();
  for (const raw of names) {
    const normalized = normalizeTagName(raw);
    if (!normalized) continue;
    const key = normalizeTagKey(normalized);
    if (!byKey.has(key)) byKey.set(key, normalized);
  }
  if (byKey.size === 0) return [];
  const keys = [...byKey.keys()];

  const found = new Map<string, TagCatalogEntry>();
  for (const group of chunk(keys, D1_IN_CLAUSE_CHUNK)) {
    const placeholders = group.map(() => "?").join(",");
    const { results } = await db.prepare(
      `SELECT id, name, normalized_name, revision FROM question_bank_tags WHERE normalized_name IN (${placeholders})`,
    ).bind(...group).all<TagCatalogRow>();
    for (const row of results ?? []) found.set(row.normalized_name, toTagCatalogEntry(row));
  }

  const missing = keys.filter((key) => !found.has(key));
  if (missing.length > 0) {
    for (const group of chunk(missing, D1_BATCH_STATEMENT_CHUNK)) {
      const statements = group.map((key) =>
        db.prepare(
          `INSERT OR IGNORE INTO question_bank_tags (id, name, normalized_name, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
        ).bind(crypto.randomUUID(), byKey.get(key)!, key, now, now),
      );
      await db.batch(statements);
    }
    // OR IGNORE means a concurrent registration of the same normalized name
    // (a race, not an error) silently no-ops our insert instead of throwing —
    // re-select so the winner's row (whichever request created it) is what
    // every caller resolves to, never a phantom id nothing else can see.
    for (const group of chunk(missing, D1_IN_CLAUSE_CHUNK)) {
      const placeholders = group.map(() => "?").join(",");
      const { results } = await db.prepare(
        `SELECT id, name, normalized_name, revision FROM question_bank_tags WHERE normalized_name IN (${placeholders})`,
      ).bind(...group).all<TagCatalogRow>();
      for (const row of results ?? []) found.set(row.normalized_name, toTagCatalogEntry(row));
    }
  }

  return keys.map((key) => found.get(key)!).filter(Boolean);
}

// Resolves every distinct tag name across a whole batch (many questions —
// admin_batch_create_questions/admin_batch_update_questions, imports) in one
// bulk pass, returning a pure, synchronous per-question resolver closure so
// the caller never issues another DB round trip while looping over items —
// implementation's "avoid per-question N+1 queries", applied to name-to-id
// resolution the same way tagsJsonExpr() applies it to reads.
export async function buildTagNameResolver(
  db: D1Database, allNames: string[], now: string,
): Promise<(names: string[] | undefined) => string[]> {
  const resolved = await resolveOrCreateTags(db, allNames, now);
  const idByKey = new Map(resolved.map((t) => [t.normalizedName, t.id]));
  return (names) => {
    const ids = new Set<string>();
    for (const raw of names ?? []) {
      const normalized = normalizeTagName(raw);
      if (!normalized) continue;
      const id = idByKey.get(normalizeTagKey(normalized));
      if (id) ids.add(id);
    }
    return [...ids];
  };
}

export async function fetchTagIdsForQuestion(db: D1Database, questionId: string): Promise<string[]> {
  const { results } = await db.prepare(`SELECT tag_id FROM question_tag_links WHERE question_id = ?`)
    .bind(questionId).all<{ tag_id: string }>();
  return (results ?? []).map((r) => r.tag_id);
}

// Batched variant for callers hydrating many questions at once (avoids one
// round trip per question — see questionManagement.ts's read paths, which
// mostly use the tagsJsonExpr() SQL projection instead and never need this,
// but the import/proposal-token identity comparisons in importConflicts.ts
// do need real ids for a batch of rows already loaded in memory).
export async function fetchTagIdsForQuestions(db: D1Database, questionIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (questionIds.length === 0) return map;
  for (const group of chunk(questionIds, D1_IN_CLAUSE_CHUNK)) {
    const placeholders = group.map(() => "?").join(",");
    const { results } = await db.prepare(
      `SELECT question_id, tag_id FROM question_tag_links WHERE question_id IN (${placeholders})`,
    ).bind(...group).all<{ question_id: string; tag_id: string }>();
    for (const row of results ?? []) {
      const list = map.get(row.question_id);
      if (list) list.push(row.tag_id);
      else map.set(row.question_id, [row.tag_id]);
    }
  }
  return map;
}

// Builds the INSERT/DELETE statements turning `currentIds` into `desiredIds`
// for one question. When `guard` is given, every statement is conditioned on
// the question row matching BOTH the exact post-write `revision` AND the
// exact `updatedAt` timestamp the write bound — used wherever the row
// mutation and this diff travel in the same db.batch() (every call site
// does, as of implementation's review) so a stale-revision write that changed zero
// question rows can never still apply a tag-link change alongside it.
//
// `revision` alone is NOT sufficient: it is a small, shared, monotonically-
// incrementing counter, so a *different* concurrent writer landing the row
// on exactly revision+1 (its own legitimate edit, racing in right after
// ours is rejected) would satisfy an revision-only guard too, misattributing
// THEIR write as evidence ours succeeded. `updatedAt` is a value only this
// call's own write statement ever binds (a fresh, effectively-unique
// millisecond-precision timestamp minted immediately before building these
// statements) — pairing both means the guard can only pass if the row is
// simultaneously at the exact post-write revision, so a race is still
// detected even in the (astronomically unlikely) event two independent
// requests mint the identical timestamp.
//
// A fresh create has no meaningful revision race (the id is new) and passes
// no guard.
export function buildTagLinkStatements(
  db: D1Database,
  questionId: string,
  desiredIds: string[],
  currentIds: string[],
  guard?: { questionId: string; revision: number; updatedAt: string },
): D1PreparedStatement[] {
  const current = new Set(currentIds);
  const desired = new Set(desiredIds);
  const toAdd = desiredIds.filter((id) => !current.has(id));
  const toRemove = currentIds.filter((id) => !desired.has(id));
  const existsGuard = guard ? `EXISTS (SELECT 1 FROM questions WHERE id = ? AND revision = ? AND updated_at = ?)` : "";
  const guardArgs = guard ? [guard.questionId, guard.revision, guard.updatedAt] : [];
  const statements: D1PreparedStatement[] = [];
  for (const tagId of toAdd) {
    statements.push(
      db.prepare(`INSERT OR IGNORE INTO question_tag_links (question_id, tag_id) SELECT ?, ?${existsGuard ? ` WHERE ${existsGuard}` : ""}`)
        .bind(questionId, tagId, ...guardArgs),
    );
  }
  for (const tagId of toRemove) {
    statements.push(
      db.prepare(`DELETE FROM question_tag_links WHERE question_id = ? AND tag_id = ?${existsGuard ? ` AND ${existsGuard}` : ""}`)
        .bind(questionId, tagId, ...guardArgs),
    );
  }
  return statements;
}

// Convenience for the simple, single-question call sites (REST create/update,
// MCP createQuestion/updateQuestion): resolves the desired names, diffs
// against the question's current links, and applies the diff in its own
// batch. Callers on an UPDATE path must only call this after confirming the
// row mutation itself actually committed (changes() > 0) — see
// routes/questions.ts and mcp/adapter.ts's updateQuestion for why a stale
// write must never reach this at all. This intentionally runs as a second,
// separate statement/batch from the question row write rather than one
// bigger atomic transaction with it: the row write's own success is checked
// first, so a rejected write never triggers a tag-link change, but a crash
// between the two (vanishingly rare on Workers/D1) could in principle leave
// them briefly out of sync — the same tradeoff this codebase already makes
// for best-effort cache invalidation after a write.
export async function syncQuestionTagLinks(db: D1Database, questionId: string, tagNames: string[], now: string): Promise<void> {
  const resolved = await resolveOrCreateTags(db, tagNames, now);
  const desiredIds = resolved.map((t) => t.id);
  const currentIds = await fetchTagIdsForQuestion(db, questionId);
  const statements = buildTagLinkStatements(db, questionId, desiredIds, currentIds);
  if (statements.length > 0) await db.batch(statements);
}

// --- Catalog rename/merge (implementation) --------------------------------------
// Both operations are now PURE catalog + join-table changes: a rename only
// ever updates the one question_bank_tags row (its id, and therefore every
// question_tag_links row pointing at it, never changes), and a merge only
// ever reassigns/removes join rows and deletes the source catalog rows.
// Neither touches a single `questions` row, so — unlike implementation's original
// per-row tags_json rewrite — there is no question count this could fail
// against, no chunking, and no per-row conflict/retry bookkeeping: the whole
// operation is one small, fixed-size, atomic db.batch() regardless of how
// many thousands of questions carry the tag.

// 2 statements per source tag (reassign its links, then delete its catalog
// row) + 1 touch-target + 1 audit row, capped comfortably under D1's
// 50-statement batch limit.
export const MAX_MERGE_SOURCE_TAGS = 20;

export function renameTagCatalogStatement(
  db: D1Database, id: string, expectedRevision: number, newName: string, now: string,
): D1PreparedStatement {
  return db.prepare(
    `UPDATE question_bank_tags SET name = ?, normalized_name = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`,
  ).bind(newName, normalizeTagKey(newName), now, id, expectedRevision);
}

// implementation review — merge must detect a concurrent edit to any SOURCE catalog
// row too, not just the target: if another admin renames/merges a source
// between mergeTags' read of it and this batch committing, the merge must
// not still delete that row (destroying an identity someone just gave a new
// name/meaning to) or reassign its links out from under that edit. Folded
// into the TARGET's own guard (rather than each source statement having its
// own independent guard) so a drifted source aborts the WHOLE merge —
// target untouched, no source reassigned/deleted — instead of silently
// completing for the sources that didn't drift while skipping the one that
// did.
//
// implementation follow-up review — a source that a CONCURRENT merge deletes entirely
// (rather than just renaming) must also count as drift. The original
// `(id = ? AND revision <> ?)` OR-chain, wrapped by callers in `NOT EXISTS
// (SELECT 1 FROM question_bank_tags WHERE <condition>)`, only matches rows
// that still exist with a changed revision — a deleted source has no row at
// all to match, so it contributed nothing and the merge proceeded as if
// that source were untouched. Returns a self-contained boolean expression
// (TRUE means "at least one source drifted or vanished") instead: for each
// expected (id, revision) pair, prove a row still exists at exactly that
// revision; a dropped source fails its own existence check the same as a
// renamed one does. Callers compose it as `AND NOT (<condition>)` rather
// than nesting it inside another `WHERE` clause against question_bank_tags.
export function sourceDriftCondition(sources: { id: string; revision: number }[]): { condition: string; args: unknown[] } {
  if (sources.length === 0) return { condition: "0", args: [] };
  const expected = sources.map(() => `SELECT ? AS id, ? AS revision`).join(" UNION ALL ");
  return {
    condition: `EXISTS (SELECT 1 FROM (${expected}) AS expected_source
      WHERE NOT EXISTS (SELECT 1 FROM question_bank_tags t WHERE t.id = expected_source.id AND t.revision = expected_source.revision))`,
    args: sources.flatMap((s) => [s.id, s.revision]),
  };
}

// Bumps the target's revision (detecting a concurrent rename/merge of the
// target itself between read and write) without changing its name.
// `sourceDriftGuard` (sourceDriftCondition, above) additionally requires
// every source to still be at its expected revision — if either check
// fails, this statement's own WHERE fails (changes() = 0), the caller's
// `if (!changed) throw conflict` catches it, and every per-source
// reassign/delete statement below (guarded on THIS row landing at
// `expectedRevision + 1`) correctly no-ops too, since that never happens.
export function touchTagCatalogStatement(
  db: D1Database, id: string, expectedRevision: number, now: string, sourceDriftGuard?: { condition: string; args: unknown[] },
): D1PreparedStatement {
  const extra = sourceDriftGuard ? ` AND NOT (${sourceDriftGuard.condition})` : "";
  return db.prepare(`UPDATE question_bank_tags SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?${extra}`)
    .bind(now, id, expectedRevision, ...(sourceDriftGuard?.args ?? []));
}

// UPDATE OR IGNORE: for a question that already carries the target tag too,
// reassigning its source link would collide with the target link already
// occupying that (question_id, tag_id) primary key — IGNORE leaves that one
// row pointed at the source, which the source's DELETE (with its FK's ON
// DELETE CASCADE) then removes, correctly deduping down to a single
// target-tagged link instead of erroring or leaving a duplicate.
//
// `guard`, when given, conditions the statement on the target row still
// being at exactly that (post-touch) revision AND updated_at — so if
// touchTagCatalogStatement's own compare-and-swap lost a concurrent race
// earlier in the SAME batch, this (and deleteTagCatalogByIdStatement's
// matching guard) become no-ops instead of still partially applying the
// merge alongside a rejected touch. Revision alone is not sufficient here
// either (same reasoning as buildTagLinkStatements' guard): a fully
// independent, already-committed concurrent rename/merge of the SAME
// target — racing between mergeTags' read and this batch starting, so it
// commits entirely before this transaction even begins — could coincidentally
// bump the target from the exact same "before" revision to the exact same
// "after" value this merge expects, which a revision-only check couldn't
// tell apart from THIS merge's own touch having actually succeeded.
// Pairing it with `updatedAt` (the timestamp only THIS call's touch
// statement ever binds) removes that ambiguity.
export function reassignTagLinksStatement(
  db: D1Database, sourceId: string, targetId: string, guard?: { tagId: string; revision: number; updatedAt: string },
): D1PreparedStatement {
  if (!guard) return db.prepare(`UPDATE OR IGNORE question_tag_links SET tag_id = ? WHERE tag_id = ?`).bind(targetId, sourceId);
  return db.prepare(
    `UPDATE OR IGNORE question_tag_links SET tag_id = ? WHERE tag_id = ? AND EXISTS (SELECT 1 FROM question_bank_tags WHERE id = ? AND revision = ? AND updated_at = ?)`,
  ).bind(targetId, sourceId, guard.tagId, guard.revision, guard.updatedAt);
}

export function deleteTagCatalogByIdStatement(
  db: D1Database, id: string, guard?: { tagId: string; revision: number; updatedAt: string },
): D1PreparedStatement {
  if (!guard) return db.prepare(`DELETE FROM question_bank_tags WHERE id = ?`).bind(id);
  return db.prepare(
    `DELETE FROM question_bank_tags WHERE id = ? AND EXISTS (SELECT 1 FROM question_bank_tags WHERE id = ? AND revision = ? AND updated_at = ?)`,
  ).bind(id, guard.tagId, guard.revision, guard.updatedAt);
}

// `sourceDriftGuard`, when given (mergeTags registering a brand-new
// target), makes the INSERT itself conditional on the same "no source has
// drifted" check touchTagCatalogStatement enforces for an EXISTING target —
// a fresh target has no revision of its own to race on, but the merge must
// still abort as a whole if a source changed underneath it.
export function registerTagCatalogStatement(
  db: D1Database, id: string, name: string, now: string, sourceDriftGuard?: { condition: string; args: unknown[] },
): D1PreparedStatement {
  if (!sourceDriftGuard) {
    return db.prepare(
      `INSERT INTO question_bank_tags (id, name, normalized_name, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    ).bind(id, name, normalizeTagKey(name), now, now);
  }
  return db.prepare(
    `INSERT INTO question_bank_tags (id, name, normalized_name, revision, created_at, updated_at)
     SELECT ?, ?, ?, 1, ?, ? WHERE NOT (${sourceDriftGuard.condition})`,
  ).bind(id, name, normalizeTagKey(name), now, now, ...sourceDriftGuard.args);
}

export async function countQuestionsForTag(db: D1Database, tagId: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM question_tag_links WHERE tag_id = ?`).bind(tagId).first<{ n: number }>();
  return row?.n ?? 0;
}

// Informational only (never used to gate anything): the distinct question
// count across every source tag being merged, for the response's
// affectedQuestionCount — a question carrying two of the merged-away names
// counts once.
export async function countQuestionsForAnyTag(db: D1Database, tagIds: string[]): Promise<number> {
  if (tagIds.length === 0) return 0;
  const placeholders = tagIds.map(() => "?").join(",");
  const row = await db.prepare(
    `SELECT COUNT(DISTINCT question_id) AS n FROM question_tag_links WHERE tag_id IN (${placeholders})`,
  ).bind(...tagIds).first<{ n: number }>();
  return row?.n ?? 0;
}

// A rename/merge never touches a question row, so it never goes through
// updateStatement's own cache invalidation — but it DOES change what
// routes/practice.ts's per-exam cached catalog displays (that cache embeds
// each question's current tag names). Every exam with at least one question
// carrying any of `tagIds` needs its cache invalidated so a stale display
// name doesn't linger behind an unrelated question revision.
export async function distinctExamIdsForTags(db: D1Database, tagIds: string[]): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const placeholders = tagIds.map(() => "?").join(",");
  const { results } = await db.prepare(
    `SELECT DISTINCT q.exam_id AS exam_id FROM question_tag_links l JOIN questions q ON q.id = l.question_id WHERE l.tag_id IN (${placeholders})`,
  ).bind(...tagIds).all<{ exam_id: string }>();
  return (results ?? []).map((r) => r.exam_id);
}
