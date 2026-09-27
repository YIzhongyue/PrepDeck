// KV cache for the per-exam stats dashboard (routes/stats.ts), which
// recomputes JOIN/GROUP BY queries from scratch on every visit even though the
// result only changes when the user studies.
//
// Freshness (issue #40): a practice answer counts in the statistics the moment
// it is graded, so an entry cached before it would be stale until its TTL ran
// out. Deleting the entry on every checked answer would spend a KV write per
// answer (Workers KV's free tier caps writes and deletes per day). Instead each
// entry is stored with an activity marker (how many graded answers exist and
// when a session last closed) and a read recomputes when a cheap marker query
// no longer matches. An entry is rewritten at most once per visit after study,
// never per answer. POST /complete still deletes the entry eagerly; the TTL
// remains a safety net for changes the marker does not see (a bank edit or a
// new pass rule).
//
// Days and windows are counted in the account's time zone (issue #47), so the
// zone is part of the key: changing it reads a different entry, and one zone's
// buckets are never served for another.

import type { Env } from "../bindings";
import type { ExamStatsResponse } from "@prepdeck/shared";
import { STATS_SCHEMA_VERSION, zonedDateKey } from "@prepdeck/shared";
import { computeExamStats, GRADED_ANSWER_SQL } from "./learningStats";
import { loadUserTimeZone } from "./userTimeZone";

const TTL_SECONDS = 3600;

interface CachedExamStats {
  marker: string;
  // The local day it was computed on: the comparison windows end today.
  today: string;
  stats: ExamStatsResponse;
}

// The key carries the payload's schema version (implementation), so a deployment
// that adds fields to ExamStatsResponse reads a fresh key rather than serving
// a previously cached payload that is missing them. Old keys are left to
// expire on their own TTL; there is nothing to migrate.
const cacheKey = (userId: string, examId: string, timeZone: string) =>
  `stats:v${STATS_SCHEMA_VERSION}:${userId}:${examId}:${timeZone}`;

/** What the cached statistics were computed from; any study changes it. */
export async function examActivityMarker(db: D1Database, userId: string, examId: string): Promise<string> {
  const row = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
             WHERE a.user_id = ? AND a.exam_id = ? AND ${GRADED_ANSWER_SQL}) AS answers,
            (SELECT MAX(completed_at) FROM attempts WHERE user_id = ? AND exam_id = ?) AS closed`
  )
    .bind(userId, examId, userId, examId)
    .first<{ answers: number; closed: string | null }>();
  return `${row?.answers ?? 0}|${row?.closed ?? ""}`;
}

async function getCachedExamStats(env: Env, key: string, timeZone: string): Promise<CachedExamStats | null> {
  const cached = (await env.KV.get(key, "json")) as CachedExamStats | null;
  // Belt and braces alongside the versioned key: a payload written by a
  // deployment that shares this key but not this schema is discarded rather
  // than handed to a dashboard that would read `undefined` off it.
  if (!cached || typeof cached.marker !== "string" || cached.stats?.schemaVersion !== STATS_SCHEMA_VERSION) return null;
  if (cached.stats.timeZone !== timeZone) return null;
  return cached;
}

export async function invalidateExamStats(env: Env, userId: string, examId: string): Promise<void> {
  await env.KV.delete(cacheKey(userId, examId, await loadUserTimeZone(env.DB, userId)));
}

// Shared cache-check/compute/cache-set path for both the REST stats dashboard
// (routes/stats.ts) and the User MCP's get_learning_stats tool, so they never
// diverge and a cache write from one is immediately visible to the other.
// Returns null if the exam doesn't exist (never cached, so a since-deleted
// exam id doesn't leave a stale cache entry).
export async function getOrComputeExamStats(env: Env, userId: string, examId: string): Promise<ExamStatsResponse | null> {
  const timeZone = await loadUserTimeZone(env.DB, userId);
  const key = cacheKey(userId, examId, timeZone);
  const [cached, marker] = await Promise.all([getCachedExamStats(env, key, timeZone), examActivityMarker(env.DB, userId, examId)]);
  // An entry is only good for the local day it was computed on: the
  // comparison windows end today, so midnight moves them without any study.
  const now = new Date();
  const today = zonedDateKey(now, timeZone);
  if (cached && cached.marker === marker && cached.today === today) return cached.stats;
  const computed = await computeExamStats(env.DB, userId, examId, now, timeZone);
  if (!computed) return null;
  const entry: CachedExamStats = { marker, today, stats: computed };
  await env.KV.put(key, JSON.stringify(entry), { expirationTtl: TTL_SECONDS });
  return computed;
}
