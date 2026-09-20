// implementation — daily sweep for abandoned Knowledge Point image uploads
// (pasted/uploaded but never attached to a saved note, or removed from a
// note's body and never re-referenced). Deferred from implementation's original plan;
// before it, explicit per-image delete (routes/kpImages.ts DELETE) and
// cascade-on-note-delete were the only cleanup paths, which is fine for
// active use but leaves truly abandoned uploads (e.g. a draft never saved)
// sitting in R2/D1 indefinitely.
//
// The grace-window decision this depends on,
// lib/knowledgePointCleanup.ts::isEligibleForCleanup, is unit-tested; the
// claim/drain behaviour here is covered end-to-end against real SQLite in
// scripts/knowledge-point-consistency.test.mjs.

import type { Env } from "../bindings";
import { CLEANUP_GRACE_MS } from "../lib/knowledgePointCleanup";
import { flushRetiredImages, MAX_DELETE_ATTEMPTS, type RetiredImage } from "../lib/knowledgePointImageRetirement";

const BATCH_LIMIT = 200;

export async function runKnowledgePointImageCleanup(
  env: Env,
  now: () => number = Date.now
): Promise<{ deleted: number }> {
  const nowMs = now();
  const cutoff = new Date(nowMs - CLEANUP_GRACE_MS).toISOString();
  // Claim expired, unreferenced images atomically with removing their live
  // rows. A concurrent autosave commits its content and image status in one
  // batch too, so a stale cleanup scan cannot delete its saved attachments.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO knowledge_point_image_deletions (id, r2_object_key, queued_at)
       SELECT i.id, i.r2_object_key, ? FROM knowledge_point_images i
       JOIN knowledge_points kp ON kp.id = i.knowledge_point_id
       WHERE i.status IN ('pending', 'orphaned') AND i.updated_at < ?
         AND instr(kp.body_markdown, '/api/kp-images/' || i.id) = 0
       LIMIT ?`
    ).bind(nowMs, cutoff, BATCH_LIMIT),
    env.DB.prepare("DELETE FROM knowledge_point_images WHERE id IN (SELECT id FROM knowledge_point_image_deletions)"),
  ]);
  // Oldest first, and skipping keys that have already failed their retry
  // budget, so a newly queued object is never stuck behind a permanently
  // failing one. Drains tombstones from every retirement path, not just this
  // sweep's own claims — an explicit delete whose R2 call failed is retried
  // here too.
  const { results } = await env.DB.prepare(
    `SELECT id, r2_object_key FROM knowledge_point_image_deletions
     WHERE attempts < ? ORDER BY queued_at, id LIMIT ?`
  ).bind(MAX_DELETE_ATTEMPTS, BATCH_LIMIT).all<RetiredImage>();
  return flushRetiredImages(env.DB, env.BUCKET, results ?? []);
}
