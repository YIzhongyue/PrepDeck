// docs/requirements/practice-and-learning-modes.md — Learning Mode (学习模式): DTOs for the read-through study
// mode. Unlike the Practice/Mock catalog (attempts.ts's PracticeCatalogQuestion),
// a Learning Mode question detail always includes the answer key (FR-14.3)
// and this user's own answer history (FR-14.4) — it is only ever requested
// for a question the user is actively viewing in a review-like context.

import type { AttemptMode, Question } from "./types";

// FR-14.4: one past attempt_answer referencing this question, from Practice
// or Mock (Learning Mode itself never creates these — see FR-14.7).
export interface LearningHistoryEntry {
  attemptId: string;
  mode: AttemptMode;
  selectedAnswer: string[];
  isCorrect: boolean;
  answeredAt: string;
  answerRevision: number | null;
  gradedAnswers: string[] | null;
}

export interface LearningQuestionDetailResponse {
  question: Question;
  history: LearningHistoryEntry[];
}

// FR-14.9: per-user, per-exam resume position.
export interface LearningProgressResponse {
  examId: string;
  lastSequenceNumber: number | null;
}

export interface SetLearningProgressRequest {
  sequenceNumber: number;
}
