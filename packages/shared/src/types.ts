// Core domain types shared between apps/web and apps/worker.
// Mirrors docs/requirements/data-model-and-import-format.md (Core Entities) and docs/requirements/data-model-and-import-format.md (Question Types).

export type Role = "admin" | "user";
export type UserStatus = "invited" | "active" | "revoked";

export interface User {
  id: string;
  email: string;
  googleSub: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
  status: UserStatus;
  invitedBy: string | null;
  showSharedNotes: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Exam {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  subject: string | null;
  language: string | null;
  createdAt: string;
  archivedAt: string | null;
  passMarkPct: number | null;
  badgeIconUrl: string | null;
  providers: Provider[];
}

export interface Provider {
  id: string;
  name: string;
  shortName: string;
  websiteUrl: string | null;
  iconUrl: string | null;
  createdAt: string;
}

// Extensible per FR-10.3: new values may be added without breaking existing questions.
export type QuestionType = "single_choice" | "multiple_choice" | "true_false" | "fill_blank";

export type Difficulty = "easy" | "medium" | "hard";

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  examId: string;
  externalId: string | null;
  // FR-14.1: stable per-exam ordinal position, used to start/jump/resume
  // "question #N" in Learning Mode (docs/requirements/practice-and-learning-modes.md).
  sequenceNumber: number;
  type: QuestionType;
  stem: string;
  options: QuestionOption[] | null; // null for fill_blank
  correctAnswers: string[];
  explanation: string | null;
  difficulty: Difficulty | null;
  tags: string[];
  points: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
  answerRevision: number;
  answerRevisedAt: string | null;
}

export type AiProvider = "openai" | "anthropic";

export interface AiExplanation {
  questionId: string;
  provider: AiProvider;
  model: string;
  content: string;
  generatedAt: string;
}

export type AttemptMode = "practice" | "mock";

export interface Attempt {
  id: string;
  userId: string;
  examId: string;
  mode: AttemptMode;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  score: number | null;
  totalQuestions: number | null;
}

export interface AttemptAnswer {
  id: string;
  attemptId: string;
  questionId: string;
  selectedAnswer: string[];
  isCorrect: boolean;
  timeSpentSeconds: number | null;
  answeredAt: string | null;
}

export interface WrongQuestionEntry {
  userId: string;
  questionId: string;
  wrongCount: number;
  lastWrongAt: string;
  mastered: boolean;
}

export interface Bookmark {
  userId: string;
  questionId: string;
  createdAt: string;
}

export type AnnotationTargetType = "stem" | "option" | "ai_explanation";

export interface Annotation {
  id: string;
  userId: string;
  questionId: string;
  targetType: AnnotationTargetType;
  targetRef: string | null; // option id, when targetType === "option"
  rangeStart: number;
  rangeEnd: number;
  style: string; // e.g. 'highlight_yellow' | 'underline' | 'bold'
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NoteVisibility = "private" | "shared";

export interface Note {
  id: string;
  userId: string;
  questionId: string;
  content: string;
  visibility: NoteVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface ImportLog {
  id: string;
  examId: string;
  uploadedBy: string;
  r2ObjectKey: string;
  questionCount: number;
  createdAt: string;
}
