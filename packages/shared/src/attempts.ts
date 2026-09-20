// DTOs for the Practice (3.3) / Mock Exam (3.4) API, shared between the
// Worker's responses and the web client's fetch calls.

import type { AttemptMode, Difficulty, QuestionOption, QuestionType } from "./types";

// A question as handed to a user who hasn't answered it yet: no correctAnswers,
// no explanation. `chooseCount` (safe to reveal — it's a count, not which ids
// are correct) lets multi-select UIs say "choose 3" before grading.
export interface PracticeCatalogQuestion {
  id: string;
  externalId: string | null;
  // FR-14.1: lets the client sort/jump within Learning Mode's sequential
  // order without a separate catalog endpoint.
  sequenceNumber: number;
  type: QuestionType;
  stem: string;
  options: QuestionOption[] | null;
  chooseCount: number | null;
  tags: string[];
  difficulty: Difficulty | null;
  points: number;
}

// FR-5.1: the running "times wrong" counter and "last wrong at" timestamp,
// per question, for this user's active (not yet mastered) Wrong Question Book.
export interface WrongBookEntry {
  questionId: string;
  wrongCount: number;
  lastWrongAt: string;
}

export interface PracticeCatalogResponse {
  questions: PracticeCatalogQuestion[];
  bookmarkedIds: string[];
  wrongEntries: WrongBookEntry[];
  attemptedIds: string[];
}

// POST /attempts/:id/complete grades a whole attempt in ONE D1 batch (2N+1
// statements) because its answers, wrong-book entries and the attempt's own
// final row have to commit together. The attempt's size is therefore what
// bounds that batch, so it is capped when the attempt is created. Shared so
// the Mock setup screen never offers a size the API will reject.
export const MAX_ATTEMPT_QUESTIONS = 200;

// FR-4.3: the mock deadline is `started_at + time_limit_seconds`, enforced by
// the server — a countdown the client alone polices is not a time limit, since
// a slept tab, a skewed clock or a direct API call all walk straight past it.
//
// Draft writes are refused after the deadline plus this grace window; it exists
// because the client flushes queued draft writes immediately BEFORE submitting
// (persistMockDraft), so a strict boundary would reject answers that were
// genuinely made in time. Submission itself is never refused — an attempt that
// could not be submitted would be worse than one graded a few seconds late —
// it simply grades the draft, which by then can only contain in-time answers.
export const MOCK_SUBMIT_GRACE_SECONDS = 30;

// Null when the attempt has no limit (every practice attempt, and a mock
// started without one). Both inputs are immutable once the attempt row exists,
// which is why callers can safely derive this from a row they have already
// read: there is no read-then-write race to lose.
export function attemptDeadlineMs(startedAt: string, timeLimitSeconds: number | null): number | null {
  if (timeLimitSeconds == null) return null;
  return new Date(startedAt).getTime() + timeLimitSeconds * 1000;
}

export interface StartAttemptRequest {
  mode: AttemptMode;
  questionIds: string[];
  timeLimitSeconds?: number;
}

export interface StartAttemptResponse {
  attemptId: string;
  mode: AttemptMode;
  startedAt: string;
  timeLimitSeconds: number | null;
}

export interface SubmitPracticeAnswerRequest {
  questionId: string;
  selectedAnswer: string[];
  timeSpentSeconds?: number;
}

export interface SubmitPracticeAnswerResponse {
  answerRevision: number;
  answerRevisedAt: string | null;
  isCorrect: boolean;
  correctAnswers: string[];
  explanation: string | null;
}

export interface SaveDraftAnswerRequest {
  selectedAnswer: string[];
}

export interface SaveFlagRequest {
  flagged: boolean;
}

export interface ActiveAttemptResponse {
  attemptId: string;
  mode: AttemptMode;
  examId: string;
  questionIds: string[];
  selectedAnswers: Record<string, string[]>;
  flagged: Record<string, boolean>;
  startedAt: string;
  timeLimitSeconds: number | null;
}

export interface AttemptBreakdownRow {
  gradedAnswers: string[] | null;
  answerRevision: number | null;
  currentAnswerRevision: number;
  answerRevisedAt: string | null;
  questionId: string;
  selectedAnswer: string[];
  correctAnswers: string[];
  isCorrect: boolean;
}

export interface CompleteAttemptResponse {
  attemptId: string;
  mode: AttemptMode;
  score: number;
  passed: boolean | null;
  totalQuestions: number;
  correctCount: number;
  durationSeconds: number;
  breakdown: AttemptBreakdownRow[];
}
