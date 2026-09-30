import type { LearningProgressResponse, SetLearningProgressRequest } from "@prepdeck/shared";
import { success, failure, type StudyMutationResult } from "./studyMutationResult";

// Learning Mode stores a resume position, never an attempt or a graded answer.
export async function setLearningProgress(
  db: D1Database, userId: string, examId: string, body: SetLearningProgressRequest | null,
): Promise<StudyMutationResult<{ progress: LearningProgressResponse }>> {
  const exam = await db.prepare("SELECT id FROM exams WHERE id = ?").bind(examId).first();
  if (!exam) return failure({ error: "Exam not found" }, "not_found");
  if (!body || !Number.isInteger(body.sequenceNumber) || body.sequenceNumber < 1) {
    return failure({ error: "sequenceNumber must be a positive integer" }, "invalid_input");
  }

  await db.prepare(
    `INSERT INTO learning_progress (user_id, exam_id, last_sequence_number, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, exam_id) DO UPDATE SET last_sequence_number = excluded.last_sequence_number, updated_at = excluded.updated_at`
  ).bind(userId, examId, body.sequenceNumber, new Date().toISOString()).run();

  return success({ progress: { examId, lastSequenceNumber: body.sequenceNumber } });
}
