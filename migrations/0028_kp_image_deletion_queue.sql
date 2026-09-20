-- Keep cleanup retries durable after retiring an expired attachment from D1.
--
-- Every path that retires an image (the expiry sweep, an explicit delete, and
-- a note deletion's cascade) enqueues here in the same transaction that drops
-- the D1 row, then deletes from R2. A failed R2 delete therefore leaves a
-- tombstone to retry instead of an object nothing remembers.
--
-- queued_at orders the drain so a newly queued object cannot sit behind older
-- ones forever, and attempts bounds retries so an object whose delete keeps
-- failing is skipped rather than wedging the queue ahead of everything else.
CREATE TABLE knowledge_point_image_deletions (
  id TEXT PRIMARY KEY,
  r2_object_key TEXT NOT NULL,
  queued_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_kp_image_deletions_drain ON knowledge_point_image_deletions(attempts, queued_at);
