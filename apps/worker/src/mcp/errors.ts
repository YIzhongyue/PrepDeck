import type { StudyMutationDetail } from "../lib/studyMutationResult";

// All guidance is curated. Never forward a service's error string or input.
const STUDY_ERROR_MESSAGES: Record<StudyMutationDetail, string> = {
  attempt_not_practice: "This attempt is not a practice session. Use a practice attempt ID; these tools cannot submit mock exams.",
  attempt_completed: "This attempt is already completed. Read user_get_attempt for its saved results; do not retry submitting an answer to it.",
  question_not_in_attempt: "This question is not part of the attempt. Read user_get_attempt and use one of its questionIds.",
  invalid_answer: "The answer is not valid for this question. Fetch user_get_question, check its interaction and use its exact case-sensitive option IDs or answer values.",
  empty_answer: "No answer was supplied. Skip the question without submitting it; submit only after the learner provides an answer.",
  questions_not_in_exam: "One or more question IDs do not belong to the exam. Fetch the exam's questions and correct the selection before starting.",
  attempt_too_large: "Too many questions were selected. Reduce the selection to the tool's questionIds limit.",
  invalid_time_spent: "timeSpentSeconds must be a whole number within the tool's bounds. Omit it if the duration is unknown.",
  invalid_sequence_number: "sequenceNumber must be a positive integer identifying the Learning Mode resume position.",
};

export const MCP_ERRORS = {
  unauthenticated: { status: 401, message: "A valid credential for this MCP server is required." },
  unauthorized: { status: 403, message: "This operation is not authorized." },
  invalid_input: { status: 400, message: "Invalid request input." },
  not_found: { status: 404, message: "The requested resource was not found." },
  conflict: { status: 409, message: "This operation conflicts with the current state (a stale revision, modified proposal, or existing dependency). Refresh and retry." },
  export_requires_external_id: { status: 409, message: "Assign a unique external ID to every question before exporting; questions without one cannot be safely re-imported into their source exam." },
  rate_limited: { status: 429, message: "Too many requests for this operation. Wait and retry." },
  // implementation — distinct from "internal": this operation's own rate-limit
  // gate (or another dependency it needs) was unreachable, as opposed to an
  // unexpected application failure. Only meaningful for tool-level errors —
  // pre-dispatch HTTP gates (circuit breaker, IP limiter, account quota in
  // mcp/routes.ts) build their own { ok:false, error:{code:"unavailable"} }
  // envelope directly with a real 503 status and Retry-After header; this
  // entry's `status` is unused for those since a tool result is always
  // returned as HTTP 200 with isError:true (see catalog.ts's defineMcpTool)
  // — kept for consistency with the rest of this table, not because
  // anything reads it for a tool-level error.
  unavailable: { status: 503, message: "This operation is temporarily unavailable. Wait and retry." },
  internal: { status: 500, message: "An internal error occurred." },
} as const;

export type McpErrorCode = keyof typeof MCP_ERRORS;

// Never attach arbitrary messages, causes, SQL errors, or validation input.
// retryAfter (seconds) is optional structured guidance for rate_limited/
// unavailable — never a free-form message — surfaced to the caller via
// errorEnvelope() below.
export class McpApplicationError extends Error {
  readonly code: McpErrorCode;
  readonly retryAfter?: number;
  readonly studyReason?: StudyMutationDetail;
  constructor(code: McpErrorCode, options?: { retryAfter?: number; studyReason?: StudyMutationDetail }) {
    super(MCP_ERRORS[code].message);
    this.code = code;
    if (options?.retryAfter !== undefined) this.retryAfter = Math.max(1, Math.ceil(options.retryAfter));
    if (options?.studyReason && Object.hasOwn(STUDY_ERROR_MESSAGES, options.studyReason)) this.studyReason = options.studyReason;
  }
}

export function errorEnvelope(error: unknown) {
  const code = error instanceof McpApplicationError ? error.code : "internal";
  const retryAfter = error instanceof McpApplicationError ? error.retryAfter : undefined;
  const reason = error instanceof McpApplicationError ? error.studyReason : undefined;
  return {
    ok: false as const,
    error: {
      code, message: reason ? STUDY_ERROR_MESSAGES[reason] : MCP_ERRORS[code].message,
      ...(reason ? { reason } : {}), ...(retryAfter !== undefined ? { retryAfter } : {}),
    },
  };
}

export function httpError(error: unknown): Response {
  const body = errorEnvelope(error);
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (body.error.code === "unauthenticated") headers["WWW-Authenticate"] = 'Bearer realm="PrepDeck MCP"';
  return Response.json(body, { status: MCP_ERRORS[body.error.code].status, headers });
}
