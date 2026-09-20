// implementation — the one way a Knowledge Point image leaves the system.
//
// Three paths retire an image: the daily expiry sweep
// (scheduled/cleanupKnowledgePointImages.ts), an explicit delete
// (routes/kpImages.ts), and a note deletion's cascade (deleteNote). All three
// used to delete from R2 first and D1 second on a best-effort basis, so a
// failed R2 delete left an object nothing remembered — unreachable, unbilled
// to any note, and never retried.
//
// They now all enqueue a tombstone in the SAME transaction that drops the D1
// row, then drain it. Draining is what may fail; the tombstone is what makes
// that failure recoverable on the next sweep.

export interface RetiredImage {
  id: string;
  r2_object_key: string;
}

// Give up on a key after this many failed drains. The row is left behind (an
// operator can still see what was never deleted) but stops being selected, so
// one permanently failing object cannot stand in front of the whole queue.
export const MAX_DELETE_ATTEMPTS = 5;

// One JSON-array bind rather than two bound parameters per image: a note can
// carry far more than ~50 attachments, which is where per-image binds would
// run into D1's 100-bound-parameter ceiling. Same convention as
// lib/knowledgePointMutations.ts's image reconciliation.
export function enqueueImageRetirementStatement(
  db: D1Database,
  images: readonly RetiredImage[],
  queuedAt: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO knowledge_point_image_deletions (id, r2_object_key, queued_at)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.key'), ? FROM json_each(?)`
    )
    .bind(queuedAt, JSON.stringify(images.map((image) => ({ id: image.id, key: image.r2_object_key }))));
}

// Deletes the given tombstones' objects from R2 and, only once R2 has
// confirmed, the tombstones themselves.
//
// R2's delete takes the whole key list in ONE call (up to 1,000), and the
// tombstone removal is a single statement. The obvious shape — await a delete
// and a DELETE per row — costs two subrequests per image, which for a full
// 200-row sweep is 400 against a Workers invocation's subrequest ceiling, for
// work that compresses into two.
export async function flushRetiredImages(
  db: D1Database,
  bucket: R2Bucket,
  images: readonly RetiredImage[],
): Promise<{ deleted: number }> {
  if (!images.length) return { deleted: 0 };
  const ids = JSON.stringify(images.map((image) => image.id));
  try {
    await bucket.delete(images.map((image) => image.r2_object_key));
  } catch {
    // Charge the whole page an attempt. Coarser than per-key attribution, but
    // a bulk delete does not report per-key failure anyway, and the only thing
    // the count has to guarantee is that retries are finite.
    await db
      .prepare("UPDATE knowledge_point_image_deletions SET attempts = attempts + 1 WHERE id IN (SELECT value FROM json_each(?))")
      .bind(ids)
      .run();
    return { deleted: 0 };
  }
  await db
    .prepare("DELETE FROM knowledge_point_image_deletions WHERE id IN (SELECT value FROM json_each(?))")
    .bind(ids)
    .run();
  return { deleted: images.length };
}
