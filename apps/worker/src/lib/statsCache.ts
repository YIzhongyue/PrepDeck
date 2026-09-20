// KV cache for the per-exam stats dashboard (routes/stats.ts), which
// recomputes five JOIN/GROUP BY queries from scratch on every visit even
// though the result only changes when an attempt completes. Invalidated
// eagerly from routes/attempts.ts right after an attempt's completed_at is
// set, so the dashboard never shows stale numbers right after finishing a
// session — the TTL below is only a safety net for any invalidation path
// this misses.

import type { Env } from "../bindings";
import type { ExamStatsResponse } from "@prepdeck/shared";
import { STATS_SCHEMA_VERSION } from "@prepdeck/shared";
import { computeExamStats } from "./learningStats";

const TTL_SECONDS = 3600;

// The key carries the payload's schema version (implementation), so a deployment
// that adds fields to ExamStatsResponse reads a fresh key rather than serving
// a previously cached payload that is missing them. Old keys are left to
// expire on their own TTL; there is nothing to migrate.
const cacheKey = (userId: string, examId: string) => `stats:v${STATS_SCHEMA_VERSION}:${userId}:${examId}`;

export async function getCachedExamStats(env: Env, userId: string, examId: string): Promise<ExamStatsResponse | null> {
  const cached = (await env.KV.get(cacheKey(userId, examId), "json")) as ExamStatsResponse | null;
  // Belt and braces alongside the versioned key: a payload written by a
  // deployment that shares this key but not this schema is discarded rather
  // than handed to a dashboard that would read `undefined` off it.
  if (cached && cached.schemaVersion !== STATS_SCHEMA_VERSION) return null;
  return cached;
}

export async function setCachedExamStats(env: Env, userId: string, examId: string, stats: ExamStatsResponse): Promise<void> {
  await env.KV.put(cacheKey(userId, examId), JSON.stringify(stats), { expirationTtl: TTL_SECONDS });
}

export async function invalidateExamStats(env: Env, userId: string, examId: string): Promise<void> {
  await env.KV.delete(cacheKey(userId, examId));
}

// Shared cache-check/compute/cache-set path for both the REST stats dashboard
// (routes/stats.ts) and the User MCP's get_learning_stats tool, so they never
// diverge and a cache write from one is immediately visible to the other.
// Returns null if the exam doesn't exist (never cached, so a since-deleted
// exam id doesn't leave a stale cache entry).
export async function getOrComputeExamStats(env: Env, userId: string, examId: string): Promise<ExamStatsResponse | null> {
  const cached = await getCachedExamStats(env, userId, examId);
  if (cached) return cached;
  const computed = await computeExamStats(env.DB, userId, examId);
  if (!computed) return null;
  await setCachedExamStats(env, userId, examId, computed);
  return computed;
}
