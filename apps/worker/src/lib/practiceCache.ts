// KV cache for the exam-wide question-list portion of the Practice/Mock
// catalog (routes/practice.ts) — the part that requires parsing every
// question's JSON columns, and only changes when an admin edits, deletes, or
// imports questions for the exam. The per-user parts of the catalog
// (bookmarks, wrong-book, attempted ids) are cheap and change often, so
// they're still queried fresh on every request.

import type { Env } from "../bindings";
import type { PracticeCatalogQuestion } from "@prepdeck/shared";

const TTL_SECONDS = 3600;

const cacheKey = (examId: string) => `practice-questions:${examId}`;

export async function getCachedPracticeQuestions(env: Env, examId: string): Promise<PracticeCatalogQuestion[] | null> {
  return (await env.KV.get(cacheKey(examId), "json")) as PracticeCatalogQuestion[] | null;
}

export async function setCachedPracticeQuestions(env: Env, examId: string, questions: PracticeCatalogQuestion[]): Promise<void> {
  const payload = JSON.stringify(questions);
  // Inline figures may make a catalog exceed the KV value limit. The caller
  // still returns the authoritative D1 result when this cache is bypassed.
  if (new TextEncoder().encode(payload).byteLength > 25 * 1024 * 1024) return;
  await env.KV.put(cacheKey(examId), payload, { expirationTtl: TTL_SECONDS });
}

export async function invalidatePracticeQuestions(env: Env, examId: string): Promise<void> {
  await env.KV.delete(cacheKey(examId));
}
