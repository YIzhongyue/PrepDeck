// Closing practice sessions nobody ended (issue #40).
//
// A practice attempt is completed only by End session, Finish or an exam
// switch; a reload, a closed tab or an expired session left it open forever.
// Its answers count in the statistics from the moment they were graded either
// way (lib/learningStats.ts). What an open attempt cannot contribute is a
// session: a closing time and a duration for Study time and the activity
// counts. This closes such attempts the way POST /complete would, but dated
// by their last answer rather than by now, so a session abandoned on Monday
// is not counted as Wednesday's study, and its duration runs from its start
// to its last answer rather than across the time it sat unused.

/** On starting a new practice session: the old one had no answer for this long. */
export const PRACTICE_IDLE_ON_START_SECONDS = 60 * 60;
/** In the daily sweep: any practice session idle for this long. */
export const PRACTICE_IDLE_SWEEP_SECONDS = 24 * 60 * 60;

const LAST_ANSWER = "(SELECT MAX(answered_at) FROM attempt_answers WHERE attempt_id = attempts.id)";
const ANSWER_COUNT = "(SELECT COUNT(*) FROM attempt_answers WHERE attempt_id = attempts.id)";

/**
 * Completes open practice attempts whose last activity (last answer, or the
 * start when there is none) is older than `idleSeconds`, optionally only for
 * one user and exam. Returns how many were closed.
 */
export async function closeStalePracticeAttempts(
  db: D1Database,
  opts: { idleSeconds: number; userId?: string; examId?: string; now?: Date },
): Promise<number> {
  const cutoff = new Date((opts.now ?? new Date()).getTime() - opts.idleSeconds * 1000).toISOString();
  const userId = opts.userId ?? null;
  const examId = opts.examId ?? null;
  const result = await db.prepare(
    `UPDATE attempts SET
       completed_at = COALESCE(${LAST_ANSWER}, started_at),
       duration_seconds = MAX(0, CAST(ROUND((julianday(COALESCE(${LAST_ANSWER}, started_at)) - julianday(started_at)) * 86400) AS INTEGER)),
       total_questions = ${ANSWER_COUNT},
       score = COALESCE(ROUND(100.0 * (SELECT SUM(is_correct) FROM attempt_answers WHERE attempt_id = attempts.id) / NULLIF(${ANSWER_COUNT}, 0)), 0)
     WHERE mode = 'practice' AND completed_at IS NULL
       AND (? IS NULL OR user_id = ?) AND (? IS NULL OR exam_id = ?)
       AND COALESCE(${LAST_ANSWER}, started_at) < ?`
  )
    .bind(userId, userId, examId, examId, cutoff)
    .run();
  return result.meta.changes ?? 0;
}
