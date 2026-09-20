-- implementation (review round 2) — durable per-item outcome ledger for Admin MCP
-- import execution, keyed by (import_id, item_index). Recorded ONLY when an
-- item's mutation actually committed (a create, or an update whose
-- optimistic-concurrency WHERE clause actually matched a row), atomically
-- alongside that mutation and its audit row.
--
-- Without this, resuming a crashed/stale execute attempt re-classifies every
-- row against *current* DB state: an already-committed create/update now
-- looks identical to its incoming payload and reclassifies as a plain
-- "skip", so the resumed attempt's own outcome tally silently loses track of
-- work a prior attempt already committed — undercounting created/updated in
-- the final result and skipping cache invalidation for exams that did
-- change. Reading this table back before reclassifying lets a resume
-- recover the full accumulated outcome across every attempt of one importId.
CREATE TABLE admin_mcp_import_committed_items (
  import_id TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  external_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'updated')),
  committed_at INTEGER NOT NULL,
  PRIMARY KEY (import_id, item_index)
);

CREATE INDEX idx_admin_mcp_import_committed_items_import ON admin_mcp_import_committed_items(import_id);
