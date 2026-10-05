// Issue #119 — per-user, per-question studied status (migrations/0046).
//
// Three kinds of write, with different precedence:
//
// - Manual (the Learning screen's toggle): always applies and moves the
//   revision, which invalidates any automatic mark still in flight.
// - Learning view: applies only while the stored revision equals the one the
//   client last saw. A visit delayed or retried past a newer reset is refused,
//   so a reset is never undone by the visit that preceded it.
// - A recorded answer (Practice, Mock draft): a new exposure, so it marks the
//   question studied even after a reset. Callers guard it on their own write
//   having happened, so a replayed or rejected answer changes nothing.
//
// Every automatic write is a no-op on a question that is already studied: it
// neither moves the revision nor rewrites the source.
import type { QuestionStudyStatus, QuestionStudyStatusEntry, StudyStatusMutationResponse } from "@prepdeck/shared";
import { examExists } from "./examManagement";
import { success, failure, type StudyMutationResult } from "./studyMutationResult";

export type StudySource = "learning" | "practice" | "mock" | "manual";

interface StatusRow {
  question_id: string;
  status: QuestionStudyStatus;
  revision: number;
  updated_at: string;
}

const STATUS_COLUMNS = "question_id, status, revision, updated_at";

function toEntry(row: StatusRow): QuestionStudyStatusEntry {
  return { questionId: row.question_id, status: row.status, revision: row.revision, updatedAt: row.updated_at };
}

const UNSTUDIED = (questionId: string): QuestionStudyStatusEntry => ({ questionId, status: "unstudied", revision: 0, updatedAt: null });

export async function getStudyStatus(db: D1Database, userId: string, questionId: string): Promise<QuestionStudyStatusEntry> {
  const row = await db.prepare(`SELECT ${STATUS_COLUMNS} FROM user_question_study_status WHERE user_id = ? AND question_id = ?`)
    .bind(userId, questionId).first<StatusRow>();
  return row ? toEntry(row) : UNSTUDIED(questionId);
}

export async function listStudyStatuses(db: D1Database, userId: string, examId: string): Promise<QuestionStudyStatusEntry[]> {
  const { results } = await db.prepare(
    `SELECT s.question_id, s.status, s.revision, s.updated_at FROM user_question_study_status s
     JOIN questions q ON q.id = s.question_id
     WHERE s.user_id = ? AND q.exam_id = ?`
  ).bind(userId, examId).all<StatusRow>();
  return (results ?? []).map(toEntry);
}

/**
 * Marks questions studied because the user recorded answers to them. One
 * statement for any number of questions, so Mock completion's single grading
 * batch grows by one statement, not one per question.
 *
 * `guard` is a SQL condition (with its binds) that must hold for the mark to
 * apply — the condition the caller's own answer write is guarded on, so the
 * mark commits in the same batch as the answer it stands for, or not at all.
 * `unchangedSince`, when given, leaves an existing unstudied entry alone if it
 * changed at or after that instant: Mock completion uses it so that a reset
 * made during the attempt outlasts reconciling the attempt's answers.
 */
export function markAnsweredStatement(
  db: D1Database, userId: string, questionIds: readonly string[], source: "practice" | "mock", now: string,
  options: { guard?: { sql: string; binds: unknown[] }; unchangedSince?: string } = {},
): D1PreparedStatement {
  const guard = options.guard ?? { sql: "1", binds: [] };
  const since = options.unchangedSince != null ? " AND updated_at < ?" : "";
  return db.prepare(
    `INSERT INTO user_question_study_status (user_id, question_id, status, source, revision, updated_at)
     SELECT ?, j.value, 'studied', ?, 1, ? FROM json_each(?) j WHERE ${guard.sql}
     ON CONFLICT(user_id, question_id) DO UPDATE SET
       status = 'studied', source = excluded.source, revision = revision + 1, updated_at = excluded.updated_at
     WHERE status = 'unstudied'${since}`
  ).bind(userId, source, now, JSON.stringify(questionIds), ...guard.binds, ...(options.unchangedSince != null ? [options.unchangedSince] : []));
}

async function questionInExam(db: D1Database, examId: string, questionId: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS ok FROM questions WHERE id = ? AND exam_id = ?").bind(questionId, examId).first());
}

async function checkTarget(db: D1Database, examId: string, questionId: string): Promise<StudyMutationResult<never> | null> {
  if (!(await examExists(db, examId))) return failure({ error: "Exam not found" }, "not_found");
  if (!(await questionInExam(db, examId, questionId))) return failure({ error: "Question not found" }, "not_found");
  return null;
}

export async function setStudyStatus(
  db: D1Database, userId: string, examId: string, questionId: string, body: { status?: unknown } | null,
): Promise<StudyMutationResult<StudyStatusMutationResponse>> {
  const missing = await checkTarget(db, examId, questionId);
  if (missing) return missing;
  if (!body || (body.status !== "studied" && body.status !== "unstudied")) {
    return failure({ error: "status must be \"studied\" or \"unstudied\"" }, "invalid_input", "invalid_study_status");
  }
  await db.prepare(
    `INSERT INTO user_question_study_status (user_id, question_id, status, source, revision, updated_at)
     VALUES (?, ?, ?, 'manual', 1, ?)
     ON CONFLICT(user_id, question_id) DO UPDATE SET
       status = excluded.status, source = 'manual', revision = revision + 1, updated_at = excluded.updated_at`
  ).bind(userId, questionId, body.status, new Date().toISOString()).run();
  return success({ applied: true, status: await getStudyStatus(db, userId, questionId) });
}

export async function recordLearningView(
  db: D1Database, userId: string, examId: string, questionId: string, body: { expectedRevision?: unknown } | null,
): Promise<StudyMutationResult<StudyStatusMutationResponse>> {
  const missing = await checkTarget(db, examId, questionId);
  if (missing) return missing;
  const expected = body?.expectedRevision;
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0) {
    return failure({ error: "expectedRevision must be a non-negative integer" }, "invalid_input", "invalid_study_status");
  }
  // Inserts only when the client expected no entry (revision 0). With an
  // existing entry the SELECT still yields its row, so the conflict branch
  // runs, and it updates only an unstudied entry still at that revision.
  const result = await db.prepare(
    `INSERT INTO user_question_study_status (user_id, question_id, status, source, revision, updated_at)
     SELECT ?, ?, 'studied', 'learning', 1, ?
     WHERE ? = 0 OR EXISTS (SELECT 1 FROM user_question_study_status WHERE user_id = ? AND question_id = ?)
     ON CONFLICT(user_id, question_id) DO UPDATE SET
       status = 'studied', source = 'learning', revision = revision + 1, updated_at = excluded.updated_at
     WHERE status = 'unstudied' AND revision = ?`
  ).bind(userId, questionId, new Date().toISOString(), expected, userId, questionId, expected).run();
  return success({ applied: result.meta.changes > 0, status: await getStudyStatus(db, userId, questionId) });
}
