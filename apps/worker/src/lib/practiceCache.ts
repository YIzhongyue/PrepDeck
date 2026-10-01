// KV cache for the exam-wide question-list portion of the Practice/Mock
// catalog (routes/practice.ts) — the part that requires parsing every
// question's JSON columns, and only changes when an admin edits, deletes, or
// imports questions for the exam. The per-user parts of the catalog
// (bookmarks, wrong-book, attempted ids) are cheap and change often, so
// they're still queried fresh on every request.

import type { Env } from "../bindings";
import type { PracticeCatalogQuestion } from "@prepdeck/shared";

const TTL_SECONDS = 3600;

// Bumped whenever a cached question changes shape, so a deployment never
// reads an older entry into the new catalog before its TTL expires: v2 dropped
// the full inline snapshots, v3 added `needsReview` (issue #94).
const cacheKey = (examId: string) => `practice-questions:v3:${examId}`;

export async function getCachedPracticeQuestions(env: Env, examId: string): Promise<PracticeCatalogQuestion[] | null> {
  return (await env.KV.get(cacheKey(examId), "json")) as PracticeCatalogQuestion[] | null;
}

export async function setCachedPracticeQuestions(env: Env, examId: string, questions: PracticeCatalogQuestion[]): Promise<void> {
  const payload = JSON.stringify(questions);
  // Defensive limit for unusually large text-only catalogs. Component figures
  // are excluded by the catalog query and cannot force this fallback.
  if (new TextEncoder().encode(payload).byteLength > 25 * 1024 * 1024) return;
  await env.KV.put(cacheKey(examId), payload, { expirationTtl: TTL_SECONDS });
}

export async function invalidatePracticeQuestions(env: Env, examId: string): Promise<void> {
  await Promise.all([
    env.KV.delete(cacheKey(examId)),
    // Also invalidate the older keys during rolling deployments.
    env.KV.delete(`practice-questions:v2:${examId}`),
    env.KV.delete(`practice-questions:${examId}`),
  ]);
}
