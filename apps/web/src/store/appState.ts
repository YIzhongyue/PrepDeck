import type {
  ActiveAttemptResponse,
  CompleteAttemptResponse,
  DailyEmailSettingsResponse,
  MarkStyle,
  QuestionStudyStatusEntry,
  StudyStatusFilter,
  UserProfile,
} from "@prepdeck/shared";
import { CURATED_MODELS, DEFAULT_MARK_ALIASES, type MockFormatId } from "@prepdeck/shared";
import { parseRoute, type RouteIntent } from "../lib/routes";
import { DEFAULT_THEME, getStoredTheme } from "../lib/themeStorage";
import type {
  AiRecord,
  Annotation,
  Difficulty,
  ExamSummary,
  GradedAnswer,
  KeyMode,
  LearningDetail,
  Note,
  Question,
  ScreenId,
  ThemeId,
  TextSelection,
  WrongEntry,
} from "../types";

// The store's state shape, its initial value and the patch type every
// action writes with. Re-exported from PrepDeckContext for screens.

export type PracticeStage = "setup" | "live";

export type MockStage = "setup" | "live" | "results";

export type PracticeSource = "all" | "new" | "wrong" | "bm" | "focus";

// implementation — an explicit, complete practice filter set. Every field the
// Practice setup screen reads is named here, so opening Practice from
// somewhere else (the Statistics screen's "Practice weak tags" and per-tag
// actions) states the whole intent instead of toggling one field and
// inheriting whatever the previous session left in the other three.
export interface PracticeFilters {
  source: PracticeSource;
  tags: string[];
  diff: Difficulty | "all";
  study: StudyStatusFilter;
  count: number;
}

export type FeedbackMode = "immediate" | "end";

export type ListMode = "wrong" | "bm";

export type Provider = "anthropic" | "openai";

// A sensible per-exam mock default (FR-4.1): roughly the AWS professional-exam
// question density, capped to however many questions the bank actually has.
export function defaultMockCount(total: number): number {
  return Math.max(1, Math.min(65, total));
}

export function defaultMockMinutes(count: number): number {
  return Math.max(30, Math.round(count * 1.8));
}

export interface AppState {
  screen: ScreenId;
  more: boolean;

  me: UserProfile | null;

  exams: ExamSummary[];
  examId: string | null;
  catalog: Question[];
  catalogBy: Record<string, Question>;
  catalogRevision: number;
  questionContent: Record<string, { status: "loading" | "error"; error?: string }>;
  workspaceStatus: "loading" | "ready" | "error" | "empty";
  workspaceError: string | null;
  workspaceNotice: string | null;
  actionError: string | null;
  switching: boolean;
  workspaceGeneration: number;
  activityRevision: number;

  pStage: PracticeStage;
  source: PracticeSource;
  diff: Difficulty | "all";
  count: number;
  feedback: FeedbackMode;
  tags: string[];
  // Issue #94: leave questions still under review out of the session. Each
  // setup screen keeps its own choice, like its other filters (lib/underReview.ts).
  skipReview: boolean;
  // Issue #119: Any status / Unstudied only / Studied only.
  studyFilter: StudyStatusFilter;
  queue: string[];
  idx: number;
  sel: Record<string, string[]>;
  done: Record<string, "ok" | "no">;
  graded: Record<string, GradedAnswer>;
  attemptId: string | null;

  // docs/requirements/practice-and-learning-modes.md — Learning Mode: a sequential read-through, not an attempt
  // (FR-14.7 — no attemptId here, unlike Practice/Mock). lQueue holds this
  // session's filtered, sequence-ordered question ids; lStartInput is the
  // "start from question #N" value on the Setup screen; lResume is the
  // server-remembered position (FR-14.9), independent of any filter.
  lStage: PracticeStage;
  lTags: string[];
  lDiff: Difficulty | "all";
  lSkipReview: boolean;
  lStudyFilter: StudyStatusFilter;
  lStartInput: number;
  lQueue: string[];
  lIdx: number;
  // Issue #119: counts Learning's moves to a question (start, Next, Back, a
  // jump). Each visit marks its question studied at most once, so neither a
  // rerender nor a refreshed detail undoes a reset made while it is shown.
  lVisit: number;
  lResume: number | null;
  lDetail: Record<string, LearningDetail>;

  // implementation — cross-screen navigation intent: "jump to this question in
  // Learning Mode for pure review" (from a Knowledge Point's linked-questions
  // card). Consumed and cleared by the effect that handles it.
  pendingQuestionJump: { examId: string; questionId: string } | null;
  // issue #41: a Learning position asked for by the URL (a link, a reload,
  // Back/Forward), resolved once the exam's catalog is ready.
  pendingLearningSequence: number | null;
  // The Knowledge Point open in the editor (/knowledge-points/:id); null for
  // the list. Knowledge Points belong to the account, so an exam switch
  // leaves it alone.
  kpNoteId: string | null;
  // Daily review email deep link (/learning/exam?exam=<slug>&question_id=<id>)
  // — the exam is only known by slug at that point, so this is resolved to
  // an examId (once state.exams has loaded) into pendingQuestionJump above.
  pendingSlugQuestionJump: { examSlug: string; questionId: string } | null;

  mStage: MockStage;
  mQueue: string[];
  mIdx: number;
  mSel: Record<string, string[]>;
  mFlag: Record<string, boolean>;
  mLeft: number;
  mockDeadline: number | null;
  mConfirm: boolean;
  mockAttemptId: string | null;
  /** Selected Mock setup format; mockCount/mockMinutes hold the custom values. */
  mockFormat: MockFormatId;
  mockCount: number;
  mockMinutes: number;
  mockSkipReview: boolean;
  mockResult: CompleteAttemptResponse | null;
  activeMockAttempt: ActiveAttemptResponse | null;

  listMode: ListMode;
  bookmarks: Record<string, boolean>;
  wrong: Record<string, WrongEntry>;
  attempted: Record<string, boolean>;
  mastered: Record<string, boolean>;
  // Issue #119: this exam's recorded studied statuses, by question id. A
  // question with no entry is unstudied. Distinct from `attempted`: a question
  // seen only in Learning is studied but unattempted.
  studyStatus: Record<string, QuestionStudyStatusEntry>;
  // The statuses could not be loaded. The exam stays usable; the setup screens
  // say their study-status counts may be incomplete.
  studyStatusError: boolean;
  ai: Record<string, AiRecord>;
  anns: Annotation[];
  markAliases: Record<MarkStyle, string>;
  notes: Note[];
  noteDraft: string;
  noteDraftQuestionId: string | null;
  noteVis: "private" | "shared";
  showShared: boolean;
  // issue #47: the account's IANA time zone, which statistics count days in
  // and the daily email is sent in. Null until loaded or chosen.
  timeZone: string | null;
  // implementation — null until the load-once GET below resolves (server-default
  // shape, never persisted, so no offline placeholder is meaningful yet).
  emailSettings: DailyEmailSettingsResponse | null;

  provider: Provider;
  model: string;
  keyMode: KeyMode;
  hasSessionKey: boolean;
  hasStoredKey: boolean;
  theme: ThemeId | null;

  tsel: TextSelection | null;
}

export const initialState: AppState = {
  screen: "dash", more: false,

  me: null,

  exams: [], examId: null, catalog: [], catalogBy: {}, catalogRevision: 0, questionContent: {},
  workspaceStatus: "loading", workspaceError: null, workspaceNotice: null,
  actionError: null, switching: false, workspaceGeneration: 0, activityRevision: 0,

  pStage: "setup", source: "all", diff: "all", count: 10, feedback: "immediate",
  tags: [], skipReview: false, studyFilter: "all", queue: [], idx: 0, sel: {}, done: {}, graded: {}, attemptId: null,

  lStage: "setup", lTags: [], lDiff: "all", lSkipReview: false, lStudyFilter: "all", lStartInput: 1, lQueue: [], lIdx: 0, lVisit: 0, lResume: null, lDetail: {},
  pendingQuestionJump: null, pendingLearningSequence: null, kpNoteId: null, pendingSlugQuestionJump: null,

  mStage: "setup", mQueue: [], mIdx: 0, mSel: {}, mFlag: {}, mLeft: 0, mockDeadline: null, mConfirm: false,
  mockAttemptId: null, mockFormat: "custom", mockCount: 10, mockMinutes: 30, mockSkipReview: false, mockResult: null, activeMockAttempt: null,

  listMode: "wrong",
  bookmarks: {}, wrong: {}, attempted: {}, mastered: {}, studyStatus: {}, studyStatusError: false, ai: {}, anns: [], markAliases: { ...DEFAULT_MARK_ALIASES }, notes: [],
  noteDraft: "", noteDraftQuestionId: null, noteVis: "private", showShared: true, timeZone: null, emailSettings: null,
  provider: "anthropic", model: CURATED_MODELS.anthropic[0]!.id,
  // Both are per account (issue #46), so they are read once the account is known.
  keyMode: "memory", hasSessionKey: false, hasStoredKey: false,
  theme: getStoredTheme() ?? DEFAULT_THEME,
  tsel: null
};

export type Patch = Partial<AppState> | ((s: AppState) => Partial<AppState>);

// issue #41: the screen a URL asks for is the first one shown. Its exam is
// chosen when the exam list arrives (below), and a Learning position once that
// exam's catalog has loaded.
export function initialRouteIntent(): RouteIntent | null {
  return typeof window === "undefined" ? null : parseRoute(window.location.pathname, window.location.search);
}

export function stateForInitialRoute(route: RouteIntent | null): AppState {
  if (!route) return initialState;
  return {
    ...initialState,
    screen: route.screen,
    listMode: route.screen === "bookmarks" ? "bm" : route.screen === "wrong" ? "wrong" : initialState.listMode,
    source: route.source ?? initialState.source,
    kpNoteId: route.knowledgePointId,
    pendingLearningSequence: route.learningSequence,
    pendingSlugQuestionJump: route.examSlug && route.questionId ? { examSlug: route.examSlug, questionId: route.questionId } : null,
  };
}
