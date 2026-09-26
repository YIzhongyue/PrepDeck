// Daily close of practice sessions nobody ended (issue #40); see
// lib/practiceSessions.ts. Starting a new practice session already closes the
// same user's idle sessions for that exam; this catches everyone who does not
// come back. One bounded UPDATE: it touches only open practice attempts, idle
// for a day or more.

import type { Env } from "../bindings";
import { closeStalePracticeAttempts, PRACTICE_IDLE_SWEEP_SECONDS } from "../lib/practiceSessions";

export async function runStalePracticeClose(env: Env, now: () => number = Date.now): Promise<{ closed: number }> {
  const closed = await closeStalePracticeAttempts(env.DB, { idleSeconds: PRACTICE_IDLE_SWEEP_SECONDS, now: new Date(now()) });
  return { closed };
}
