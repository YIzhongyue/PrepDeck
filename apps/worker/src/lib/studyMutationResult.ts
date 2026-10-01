// Business failures remain safe to translate at either the REST or MCP boundary.
export type StudyMutationReason = "invalid_input" | "not_found" | "conflict";
// A fixed vocabulary, not caller input or raw exception text. Transports may
// use it to give actionable guidance without disclosing SQL or private data.
export type StudyMutationDetail =
  | "attempt_not_practice" | "attempt_completed" | "question_not_in_attempt"
  | "invalid_answer" | "empty_answer" | "questions_not_in_exam" | "questions_archived"
  | "attempt_too_large" | "invalid_time_spent" | "invalid_sequence_number";
export type StudyMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: StudyMutationReason; detail?: StudyMutationDetail; error: { error: string; attemptId?: string } };

export const success = <T>(data: T): StudyMutationResult<T> => ({ ok: true, data });
export const failure = (error: { error: string; attemptId?: string }, reason: StudyMutationReason, detail?: StudyMutationDetail): StudyMutationResult<never> =>
  ({ ok: false, reason, error, ...(detail ? { detail } : {}) });

export const studyMutationStatus = (reason: StudyMutationReason) =>
  ({ invalid_input: 400, not_found: 404, conflict: 409 } as const)[reason];
