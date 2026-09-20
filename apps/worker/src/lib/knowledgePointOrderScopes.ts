// implementation — D1 access for the knowledge_point_order_scopes counter
// (migration 0025). Kept separate from lib/knowledgePointOrdering.ts, which
// stays a pure, D1-free module so its position-math is unit testable without
// a binding; everything here touches the DB.
//
// Every statement pair below is meant to be spliced into a caller's own
// db.batch() immediately alongside the row change that affects a scope's
// membership/positions, so the counter update commits atomically with that
// change — never as a separate round trip.

const SCOPE_TABLE = "knowledge_point_order_scopes";

// Guarantees a scope's counter row exists (starting at revision 1) before a
// same-batch UPDATE tries to bump or CAS it — a scope that has never been
// touched has no row yet, and "UPDATE ... WHERE revision = 1" against a
// nonexistent row would otherwise never match.
export function ensureOrderScopeStatement(db: D1Database, userId: string, scopeKey: string, now: string): D1PreparedStatement {
  return db
    .prepare(`INSERT OR IGNORE INTO ${SCOPE_TABLE} (user_id, scope_key, revision, updated_at) VALUES (?, ?, 1, ?)`)
    .bind(userId, scopeKey, now);
}

// Monotonic bump with no caller-supplied expectation to validate — used by
// operations (create, delete, group-move) that change a scope's membership
// but have nothing for a client to have raced against; they only need to
// keep the counter honest so a *later* reorder call correctly notices the
// scope changed under it.
export function bumpOrderScopeStatement(db: D1Database, userId: string, scopeKey: string, now: string): D1PreparedStatement {
  return db
    .prepare(`UPDATE ${SCOPE_TABLE} SET revision = revision + 1, updated_at = ? WHERE user_id = ? AND scope_key = ?`)
    .bind(now, userId, scopeKey);
}

// A fresh, unpredictable value for a CAS'd revision transition — see
// casOrderScopeStatement's comment for why this must NOT be a predictable
// function of the input (like expectedRevision + 1).
export function freshRevisionToken(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! + 1; // + 1: never 0
}

// CAS bump: only applies when the scope is still at `expectedRevision`. Used
// by reordering, which does validate a client-supplied expectation. Must be
// placed as the gate (first) statement of its batch, with `newRevision` a
// value from freshRevisionToken() (not a predictable expectedRevision + 1) —
// dependent statements in the same batch key off `revision = newRevision` to
// tell whether this gate actually applied. A predictable target would make
// that check pass even when the gate did NOT apply, whenever the scope's
// untouched (stale-failure) revision already happened to equal that target —
// which happens systematically for the single most common stale-retry case,
// a caller's expectedRevision being exactly one behind the real one. A
// value drawn fresh per call can, for all practical purposes, never
// coincide with a pre-existing revision it didn't itself produce.
export function casOrderScopeStatement(
  db: D1Database,
  userId: string,
  scopeKey: string,
  expectedRevision: number,
  newRevision: number,
  now: string
): D1PreparedStatement {
  return db
    .prepare(`UPDATE ${SCOPE_TABLE} SET revision = ?, updated_at = ? WHERE user_id = ? AND scope_key = ? AND revision = ?`)
    .bind(newRevision, now, userId, scopeKey, expectedRevision);
}

// Read side: a scope with no row yet implicitly starts at revision 1 (the
// same starting value `ensureOrderScopeStatement` lazily inserts). Exposed
// as a plain SELECT string/param pair (not a helper that runs it) so a
// caller that also needs the scope's note rows — e.g.
// mcp/adapter.ts's listNotes — can batch it atomically alongside that read
// instead of issuing it as a separate, independently-racing round trip.
export const SELECT_ORDER_REVISION_SQL = `SELECT revision FROM ${SCOPE_TABLE} WHERE user_id = ? AND scope_key = ?`;
