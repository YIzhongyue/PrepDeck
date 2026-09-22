import type { QuestionContentModel } from "@prepdeck/shared";
export type QuestionType = "single_choice" | "multiple_choice" | "true_false" | "fill_blank" | "ordering" | "matching";
export type Difficulty = "easy" | "medium" | "hard";

export interface QuestionOption {
  id: string;
  text: string;
}

// A question as handed out before it's been answered: no answer key. See
// GradedAnswer for what a question looks like once it has been.
export interface Question {
  id: string;
  externalId: string | null;
  // FR-14.1: stable per-exam ordinal position, used by Learning Mode to
  // sort/jump/resume "question #N".
  sequenceNumber: number;
  type: QuestionType;
  chooseCount: number | null;
  tags: string[];
  diff: Difficulty | null;
  stem: string;
  content?: QuestionContentModel;
  options: QuestionOption[] | null;
}

export interface GradedAnswer {
  answerRevision?: number;
  answerRevisedAt?: string | null;
  isCorrect: boolean;
  correctAnswers: string[];
  explanation: string | null;
}

export interface ExamSummary {
  id: string;
  slug: string;
  name: string;
  badgeIconUrl: string | null;
  providers: { id: string; name: string; shortName: string; websiteUrl: string | null; iconUrl: string | null; createdAt: string }[];
}

export type AnnotationTarget = "stem" | "ai" | `opt:${string}`;
export type AnnotationStyle = "hl1" | "hl2" | "hl3" | "underline" | "bold";

export interface AnnotationSeed {
  id: string;
  qid: string;
  target: AnnotationTarget;
  quote: string;
  style: AnnotationStyle;
  note: string;
}

export interface Annotation {
  id: string;
  qid: string;
  target: AnnotationTarget;
  start: number;
  end: number;
  style: AnnotationStyle;
  note: string;
}

export interface Note {
  id: string;
  qid: string;
  authorId: string;
  author: string;
  avatarUrl: string | null;
  me: boolean;
  vis: "private" | "shared";
  text: string;
}

export type ScreenId =
  | "dash"
  | "practice"
  | "mock"
  | "learning"
  | "wrong"
  | "bookmarks"
  | "notes"
  | "knowledgePoints"
  | "settings"
  | "admin";

export type ThemeId = "light" | "cream" | "sage" | "clay" | "dusk";

export type KeyMode = "memory" | "encrypted";

export interface ThemeOption {
  id: ThemeId;
  name: string;
  hint: string;
  bg: string;
  accent: string;
  accent2: string;
  line: string;
}

export interface TextSegment {
  key: string;
  off: number;
  text: string;
  bg: string;
  color: string;
  pad: string;
  br: string;
  weight: string;
  deco: string;
  title: string;
  /** Marks covering this segment, plus any marks whose range ends here. */
  annotationIds?: string[];
  endingAnnotationIds?: string[];
  // Set only by markdown-derived segments (lib/markdown.ts + MarkdownHighlightedText) —
  // plain-text targets (stem/options) never set these.
  italic?: boolean;
  code?: boolean;
}

// docs/requirements/ai-explanations.md AI explanations render as (a constrained subset of) Markdown —
// see lib/markdown.ts. Deliberately a flat plainText + offset-range model,
// not an AST/HTML string, so the existing character-offset annotation
// system (docs/requirements/review-notes-and-annotations.md, FR-8.1) keeps working unchanged against `plainText`.
export type MdBlockType = "p" | "h1" | "h2" | "h3" | "li" | "oli" | "hr" | "code";

export interface MdBlock {
  type: MdBlockType;
  start: number; // offset into ParsedMarkdown.plainText
  end: number;
}

export type MdInlineKind = "bold" | "italic" | "code";

export interface MdInlineRange {
  start: number; // offset into ParsedMarkdown.plainText
  end: number;
  kind: MdInlineKind;
}

export interface ParsedMarkdown {
  sourceOffsets?: number[];
  plainText: string;
  blocks: MdBlock[];
  inline: MdInlineRange[];
}

export interface TextSelection {
  qid: string;
  target: AnnotationTarget;
  start: number;
  end: number;
  x: number;
  y: number;
}

export interface WrongEntry {
  c: number;
  at: string;
}

export interface AiExplanationEntry {
  provider: "anthropic" | "openai";
  model: string;
  content: string;
  generatedAt: string;
  canManage: boolean;
}

export interface AiRecord {
  // "checking": GET cache-check in flight (FR-7.2). "idle": checked, no
  // cached explanation yet for the selected provider/model. "generating":
  // POST /api/ai/generate in flight. "ready": content to show, cached or
  // freshly generated. "error": last attempt failed.
  status: "checking" | "idle" | "generating" | "ready" | "error";
  cached?: boolean;
  content?: string;
  provider?: "anthropic" | "openai";
  model?: string;
  canManage?: boolean;
  // FR-7.3: cached explanations under a different provider/model, offered
  // (clearly labeled) before generating a fresh one.
  alternates?: AiExplanationEntry[];
  error?: string;
}

// docs/requirements/practice-and-learning-modes.md — Learning Mode. Unlike GradedAnswer (only ever set once
// Practice/Mock grades an answer), this is fetched as soon as a question is
// viewed in Learning Mode, since the answer key is shown with no reveal step
// (FR-14.3) alongside the user's own answer history (FR-14.4).
export interface LearningHistoryRow {
  answerRevision: number | null;
  gradedAnswers: string[] | null;
  attemptId: string;
  mode: "practice" | "mock";
  selectedAnswer: string[];
  isCorrect: boolean;
  answeredAt: string;
}

export interface LearningDetail {
  answerRevision?: number;
  answerRevisedAt?: string | null;
  status: "loading" | "ready" | "error";
  correctAnswers?: string[];
  explanation?: string | null;
  history?: LearningHistoryRow[];
  error?: string;
}
