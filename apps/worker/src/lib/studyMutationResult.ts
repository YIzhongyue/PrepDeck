// Business failures remain safe to translate at either the REST or MCP boundary.
export type StudyMutationReason = "invalid_input" | "not_found" | "conflict";
export type StudyMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: StudyMutationReason; error: { error: string; attemptId?: string } };

export const success = <T>(data: T): StudyMutationResult<T> => ({ ok: true, data });
export const failure = (error: { error: string; attemptId?: string }, reason: StudyMutationReason): StudyMutationResult<never> =>
  ({ ok: false, reason, error });

export const studyMutationStatus = (reason: StudyMutationReason) =>
  ({ invalid_input: 400, not_found: 404, conflict: 409 } as const)[reason];
