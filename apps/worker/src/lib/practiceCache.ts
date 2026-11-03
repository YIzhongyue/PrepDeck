// KV cache for the exam-wide question-list portion of the Practice/Mock
// catalog (routes/practice.ts) — the part that requires parsing every
// question's JSON columns, and only changes when an admin edits, deletes, or
// imports questions for the exam. The per-user parts of the catalog
// (bookmarks, wrong-book, attempted ids) are cheap and change often, so
// they're still queried fresh on every request.

import type { Env } from "../bindings";
import type { PracticeCatalogQuestion } from "@prepdeck/shared";
import { optionalCache, cacheSingleFlight } from "./optionalCache";

const TTL_SECONDS = 3600;
const states = new WeakMap<object, { generation: number; bypassUntil: number; writes: Set<Promise<void>> }>();
function state(env: Env) {
  let value = states.get(env.KV);
  if (!value) states.set(env.KV, value = { generation: 0, bypassUntil: 0, writes: new Set() });
  return value;
}

// Bumped whenever a cached question changes shape, so a deployment never
// reads an older entry into the new catalog before its TTL expires: v2 dropped
// the full inline snapshots, v3 added `needsReview` (issue #94).
const cacheKey = (examId: string) => `practice-questions:v3:${examId}`;

export async function getCachedPracticeQuestions(env: Env, examId: string): Promise<PracticeCatalogQuestion[] | null> {
  if (state(env).bypassUntil > Date.now()) return null;
  return await optionalCache(env.KV, "practice", "get", null, async () =>
    await env.KV.get(cacheKey(examId), "json") as PracticeCatalogQuestion[] | null);
}

export async function setCachedPracticeQuestions(env: Env, examId: string, questions: PracticeCatalogQuestion[]): Promise<void> {
  const payload = JSON.stringify(questions);
  // Defensive limit for unusually large text-only catalogs. Component figures
  // are excluded by the catalog query and cannot force this fallback.
  if (new TextEncoder().encode(payload).byteLength > 25 * 1024 * 1024) return;
  if (state(env).bypassUntil > Date.now()) return;
  const writes = state(env).writes;
  if (writes.size >= 256) return;
  const write = optionalCache(env.KV, "practice", "put", undefined, () => env.KV.put(cacheKey(examId), payload, { expirationTtl: TTL_SECONDS }));
  writes.add(write);
  try { await write; } finally { writes.delete(write); }
}

export async function getOrComputePracticeQuestions(env: Env, examId: string, compute: () => Promise<PracticeCatalogQuestion[]>): Promise<PracticeCatalogQuestion[]> {
  const generation = state(env).generation;
  return cacheSingleFlight(env.KV, `practice:read:${generation}:${examId}`, async () => {
    const cached = await getCachedPracticeQuestions(env, examId);
    if (cached && generation === state(env).generation) return cached;
    const questions = await compute();
    // Do not repopulate with a snapshot loaded before a local mutation.
    if (generation === state(env).generation) await setCachedPracticeQuestions(env, examId, questions);
    return questions;
  });
}

export async function invalidatePracticeQuestions(env: Env, examId: string): Promise<void> {
  state(env).generation++;
  await cacheSingleFlight(env.KV, `practice:delete:${examId}`, async () => {
    // Let same-turn mutations join, then drain writes before deleting. A
    // joining mutation can have a newer put than our first snapshot, so
    // recheck the generation after deletion and drain again if necessary.
    await Promise.resolve();
    for (let pass = 0; pass < 2; pass++) {
      const generation = state(env).generation;
      await Promise.all([...state(env).writes]);
      const succeeded = await optionalCache(env.KV, "practice", "delete", false, async () => {
        await Promise.all([
          env.KV.delete(cacheKey(examId)),
          // Also invalidate the older keys during rolling deployments.
          env.KV.delete(`practice-questions:v2:${examId}`),
          env.KV.delete(`practice-questions:${examId}`),
        ]);
        return true;
      });
      if (succeeded && generation === state(env).generation) return;
      if (!succeeded) break;
    }
    // Bounded isolate-wide state avoids retaining arbitrary exam identifiers.
    // Other isolates retain KV's existing TTL/eventual-consistency boundary.
    // Continuous concurrent mutations also degrade rather than looping forever.
    state(env).bypassUntil = Date.now() + TTL_SECONDS * 1000;
  });
}
