-- implementation — a persisted per-scope ordering revision for Knowledge Points,
-- so `user_reorder_knowledge_points` (User MCP) can reject stale/concurrent
-- reordering instead of silently applying a move computed against a list the
-- caller no longer has an accurate picture of. A note's own `revision`
-- column (migration 0014) only protects that note's own content — it says
-- nothing about "the relative order of everyone in this group" — so a
-- separate, scope-level counter is needed.
--
-- `scope_key` (not a nullable `group_id` column) sidesteps SQLite's
-- NULL-is-never-equal-to-NULL uniqueness pitfall: a real group's id, or the
-- literal sentinel '__ungrouped__' for the virtual "Ungrouped" scope
-- (group_id IS NULL), which — like every other Knowledge Points table —
-- never has a real row of its own.
CREATE TABLE knowledge_point_order_scopes (
  user_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, scope_key)
);
