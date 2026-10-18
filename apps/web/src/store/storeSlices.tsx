import { createContext, useContext, useMemo, useRef, type Context, type ReactNode } from "react";
import type { MarkStyle, StudyStatusFilter, UpdateDailyEmailSettingsRequest } from "@prepdeck/shared";
import { type MockFormatId } from "@prepdeck/shared";
import { type Route } from "../lib/routes";
import { type PrefetchMode } from "../lib/questionPrefetch";
import type {
  AiExplanationEntry,
  AnnotationStyle,
  AnnotationTarget,
  Difficulty,
  KeyMode,
  Question,
  ScreenId,
  ThemeId,
} from "../types";
import type { AppState, FeedbackMode, ListMode, PracticeFilters, PracticeSource, Provider } from "./appState";
import type { LoadOptions } from "./storeHelpers";

// The store, split into slice contexts. PrepDeckProvider builds the whole
// store on every state change; StoreProviders hands each slice of state to its
// own context, and each group of actions to another, so a component renders
// again only when a slice it reads has changed. Every action is a stable
// callback, so a component that only calls actions never renders for state.
//
// The hot fields have slices of their own: the mock countdown (mLeft, every
// second), the note being typed and the text selection. pool() and
// learningPool() read the store when called: a component that calls them while
// rendering also reads the slices they filter on, so it renders when those do.

/** The whole store: what usePrepDeck() returns, for fixtures and tests. */
export interface PrepDeckStore {
  state: AppState;
  width: number;
  height: number;
  /** Practice's eligible questions; `study` overrides the study-status filter. */
  pool: (options?: { study?: StudyStatusFilter }) => Question[];
  curQ: () => Question | undefined;
  mockQ: () => Question | undefined;
  loadQuestionContent: (questionId: string, options?: LoadOptions) => void;
  loadLearningDetail: (questionId: string, options?: LoadOptions) => void;
  /**
   * Issue #106: fetches these questions in the background for the given mode;
   * nothing while the `after` question (the open one) is still loading.
   */
  prefetchQuestions: (mode: PrefetchMode, questionIds: readonly string[], options?: { after?: string }) => void;

  go: (id: ScreenId, options?: { newMock?: boolean }) => void;
  /** issue #41: moves to what a URL asks for (Back/Forward), through the same save gate as go(). */
  navigateTo: (route: Route) => Promise<boolean>;
  openMore: () => void;
  closeMore: () => void;

  setExamId: (id: string) => Promise<boolean>;
  retryWorkspace: () => void;
  dismissActionError: () => void;

  setSource: (id: PracticeSource) => void;
  setDiff: (id: Difficulty | "all") => void;
  setFeedback: (id: FeedbackMode) => void;
  toggleTag: (tag: string) => void;
  setPracticeTags: (tags: string[]) => void;
  setCount: (n: number) => void;
  setSkipReview: (skip: boolean) => void;
  setStudyFilter: (filter: StudyStatusFilter) => void;
  startPractice: () => void;
  openPracticeWithFilters: (filters: PracticeFilters) => void;

  begin: (ids: string[]) => void;
  pick: (q: Question, oid: string | string[]) => void;
  submit: () => void;
  next: () => void;
  prevQ: () => void;
  endSession: () => void;
  toggleBookmark: (questionId?: string) => void;
  checkAiCache: (q: Question) => void;
  genAi: (q: Question, force?: boolean) => void;
  showAlternateAi: (q: Question, alt: AiExplanationEntry) => void;

  learningPool: (options?: { study?: StudyStatusFilter }) => Question[];
  learningQ: () => Question | undefined;
  setLearningStartInput: (n: number) => void;
  toggleLearningTag: (tag: string) => void;
  clearLearningTags: () => void;
  setLearningDiff: (id: Difficulty | "all") => void;
  setLearningSkipReview: (skip: boolean) => void;
  setLearningStudyFilter: (filter: StudyStatusFilter) => void;
  beginLearning: (fromSequence?: number) => void;
  learningNext: () => void;
  learningPrev: () => void;
  learningGotoSequence: (seq: number) => void;
  /**
   * Issue #119: Learning has displayed this question's content. Marks it
   * studied once per visit; prefetches and failed loads never call this.
   */
  markLearningViewed: (questionId: string) => void;
  /** Issue #119: the explicit choice, e.g. "Mark as unstudied". */
  setQuestionStudied: (questionId: string, studied: boolean) => void;

  // implementation — Knowledge Points ↔ Learning Mode cross-navigation.
  goToQuestionForReview: (examId: string, questionId: string) => void;
  openKnowledgePointNote: (noteId: string) => void;
  /** Within the Knowledge Points screen: open a note, or return to the list. */
  showKnowledgePoint: (noteId: string | null) => void;

  setMockFormat: (format: MockFormatId) => void;
  setMockCount: (n: number) => void;
  setMockMinutes: (n: number) => void;
  setMockSkipReview: (skip: boolean) => void;
  beginMock: () => void;
  mockPick: (q: Question, oid: string | string[]) => void;
  mockPrev: () => void;
  mockNext: () => void;
  mockGoto: (i: number) => void;
  toggleFlag: () => void;
  askSubmit: () => void;
  cancelSubmit: () => void;
  finishMock: () => void;
  practiceWrong: () => void;

  setListMode: (m: ListMode) => void;
  removeBookmark: (id: string) => void;
  markMastered: (id: string) => void;
  practiceList: (ids: string[]) => void;

  setNoteDraft: (v: string) => void;
  setNoteVis: (v: "private" | "shared") => void;
  addNote: (qid: string) => void;
  updateNote: (id: string, content: string, visibility: "private" | "shared") => Promise<void>;
  removeNote: (id: string) => void;
  toggleShared: () => void;
  updateTimeZone: (timeZone: string) => Promise<void>;
  updateEmailSettings: (patch: UpdateDailyEmailSettingsRequest) => void;

  capture: (qid: string, target: AnnotationTarget) => void;
  apply: (style: AnnotationStyle) => void;
  setMarkNote: (id: string, note: string) => void;
  saveMarkNote: (id: string) => void;
  removeMark: (id: string) => void;
  updateMarkAlias: (style: MarkStyle, alias: string) => void;

  setProvider: (p: Provider) => void;
  setModel: (m: string) => void;
  setKeyMode: (m: KeyMode) => void;
  loadSessionApiKey: (key: string) => void;
  clearSessionApiKey: () => void;
  saveEncryptedApiKey: (apiKey: string, passphrase: string) => Promise<void>;
  unlockSessionKey: (passphrase: string) => Promise<void>;
  forgetStoredApiKey: () => Promise<void>;
  signOut: (opts: { removeSavedKey: boolean }) => Promise<void>;
  setTheme: (t: ThemeId) => void;

  // Both reject with the server's message, so Settings can show why (issue #52).
  updateDisplayName: (displayName: string) => Promise<void>;
  uploadAvatar: (blob: Blob) => Promise<void>;
  preserveForReauth: () => void;
}

type StateKeys = readonly (keyof AppState)[];
type ActionKeys = readonly (keyof PrepDeckStore)[];

// Which screen is showing, the exam and everything around it.
const WORKSPACE_STATE = [
  "screen", "more", "me", "exams", "examId", "workspaceStatus", "workspaceError", "workspaceNotice", "actionError",
  "switching", "workspaceGeneration", "activityRevision", "kpNoteId", "pendingQuestionJump", "pendingLearningSequence",
  "pendingSlugQuestionJump",
] as const satisfies StateKeys;
// The exam's questions. A question's content arriving changes this slice.
const CATALOG_STATE = ["catalog", "catalogBy", "catalogRevision", "questionContent"] as const satisfies StateKeys;
// The Wrong Question Book and bookmarks.
const REVIEW_STATE = ["bookmarks", "wrong", "mastered", "listMode"] as const satisfies StateKeys;
// Changes with every graded answer and studied mark.
const PROGRESS_STATE = ["attempted", "studyStatus", "studyStatusError"] as const satisfies StateKeys;
const PRACTICE_STATE = [
  "pStage", "source", "diff", "count", "feedback", "tags", "skipReview", "studyFilter", "queue", "idx", "sel", "done",
  "graded", "attemptId",
] as const satisfies StateKeys;
const LEARNING_STATE = [
  "lStage", "lTags", "lDiff", "lSkipReview", "lStudyFilter", "lStartInput", "lQueue", "lIdx", "lVisit", "lResume", "lDetail",
] as const satisfies StateKeys;
const MOCK_STATE = [
  "mStage", "mQueue", "mIdx", "mSel", "mFlag", "mockDeadline", "mConfirm", "mockAttemptId", "mockFormat", "mockCount",
  "mockMinutes", "mockSkipReview", "mockResult", "activeMockAttempt",
] as const satisfies StateKeys;
const AI_STATE = ["ai"] as const satisfies StateKeys;
const NOTES_STATE = ["notes", "showShared", "anns", "markAliases"] as const satisfies StateKeys;
const NOTE_DRAFT_STATE = ["noteDraft", "noteDraftQuestionId", "noteVis"] as const satisfies StateKeys;
const ACCOUNT_STATE = [
  "provider", "model", "keyMode", "hasSessionKey", "hasStoredKey", "theme", "timeZone", "emailSettings",
] as const satisfies StateKeys;
// mLeft and tsel are single fields, read with useMockClock() and useTextSelection().

const WORKSPACE_ACTIONS = [
  "go", "navigateTo", "openMore", "closeMore", "setExamId", "retryWorkspace", "dismissActionError",
  "goToQuestionForReview", "openKnowledgePointNote", "showKnowledgePoint",
] as const satisfies ActionKeys;
const CATALOG_ACTIONS = ["loadQuestionContent", "loadLearningDetail", "prefetchQuestions"] as const satisfies ActionKeys;
const REVIEW_ACTIONS = ["setListMode", "removeBookmark", "markMastered", "practiceList", "toggleBookmark"] as const satisfies ActionKeys;
const PRACTICE_ACTIONS = [
  "pool", "setSource", "setDiff", "setFeedback", "toggleTag", "setPracticeTags", "setCount", "setSkipReview",
  "setStudyFilter", "startPractice", "openPracticeWithFilters", "begin", "pick", "submit", "next", "prevQ", "endSession",
] as const satisfies ActionKeys;
const AI_ACTIONS = ["checkAiCache", "genAi", "showAlternateAi"] as const satisfies ActionKeys;
const LEARNING_ACTIONS = [
  "learningPool", "setLearningStartInput", "toggleLearningTag", "clearLearningTags", "setLearningDiff",
  "setLearningSkipReview", "setLearningStudyFilter", "beginLearning", "learningNext", "learningPrev",
  "learningGotoSequence", "markLearningViewed", "setQuestionStudied",
] as const satisfies ActionKeys;
const MOCK_ACTIONS = [
  "setMockFormat", "setMockCount", "setMockMinutes", "setMockSkipReview", "beginMock", "mockPick", "mockPrev",
  "mockNext", "mockGoto", "toggleFlag", "askSubmit", "cancelSubmit", "finishMock", "practiceWrong",
] as const satisfies ActionKeys;
const NOTES_ACTIONS = [
  "setNoteDraft", "setNoteVis", "addNote", "updateNote", "removeNote", "toggleShared", "capture", "apply",
  "setMarkNote", "saveMarkNote", "removeMark", "updateMarkAlias",
] as const satisfies ActionKeys;
const ACCOUNT_ACTIONS = [
  "updateTimeZone", "updateEmailSettings", "setProvider", "setModel", "setKeyMode", "loadSessionApiKey",
  "clearSessionApiKey", "saveEncryptedApiKey", "unlockSessionKey", "forgetStoredApiKey", "signOut", "setTheme",
  "updateDisplayName", "uploadAvatar", "preserveForReauth",
] as const satisfies ActionKeys;
const VIEWPORT = ["width", "height"] as const satisfies ActionKeys;

type Keys<T extends readonly unknown[]> = T[number];
type SlicedState = Keys<typeof WORKSPACE_STATE> | Keys<typeof CATALOG_STATE> | Keys<typeof REVIEW_STATE>
  | Keys<typeof PROGRESS_STATE> | Keys<typeof PRACTICE_STATE> | Keys<typeof LEARNING_STATE> | Keys<typeof MOCK_STATE>
  | Keys<typeof AI_STATE> | Keys<typeof NOTES_STATE> | Keys<typeof NOTE_DRAFT_STATE> | Keys<typeof ACCOUNT_STATE>
  | "mLeft" | "tsel";
type SlicedStore = Keys<typeof WORKSPACE_ACTIONS> | Keys<typeof CATALOG_ACTIONS> | Keys<typeof REVIEW_ACTIONS>
  | Keys<typeof PRACTICE_ACTIONS> | Keys<typeof AI_ACTIONS> | Keys<typeof LEARNING_ACTIONS> | Keys<typeof MOCK_ACTIONS>
  | Keys<typeof NOTES_ACTIONS> | Keys<typeof ACCOUNT_ACTIONS> | Keys<typeof VIEWPORT> | "state" | "curQ" | "mockQ" | "learningQ";
// A field or action added to the store must be given a slice.
const _everyFieldSliced: [Exclude<keyof AppState, SlicedState>] extends [never] ? true : never = true;
const _everyActionSliced: [Exclude<keyof PrepDeckStore, SlicedStore>] extends [never] ? true : never = true;

export type WorkspaceState = Pick<AppState, Keys<typeof WORKSPACE_STATE>>;
export type CatalogState = Pick<AppState, Keys<typeof CATALOG_STATE>>;
export type ReviewListsState = Pick<AppState, Keys<typeof REVIEW_STATE>>;
export type StudyProgressState = Pick<AppState, Keys<typeof PROGRESS_STATE>>;
export type PracticeState = Pick<AppState, Keys<typeof PRACTICE_STATE>> & Pick<PrepDeckStore, "curQ">;
export type LearningState = Pick<AppState, Keys<typeof LEARNING_STATE>> & Pick<PrepDeckStore, "learningQ">;
export type MockExamState = Pick<AppState, Keys<typeof MOCK_STATE>> & Pick<PrepDeckStore, "mockQ">;
export type AiState = Pick<AppState, Keys<typeof AI_STATE>>;
export type NotesState = Pick<AppState, Keys<typeof NOTES_STATE>>;
export type NoteDraftState = Pick<AppState, Keys<typeof NOTE_DRAFT_STATE>>;
export type AccountState = Pick<AppState, Keys<typeof ACCOUNT_STATE>>;
export type Viewport = Pick<PrepDeckStore, Keys<typeof VIEWPORT>>;
/**
 * Which session screen shows: each mode's stage, and whether its live
 * question exists. Lets the Shell pick a screen without reading the sessions.
 */
export interface SessionStages {
  pStage: AppState["pStage"];
  mStage: AppState["mStage"];
  lStage: AppState["lStage"];
  practiceQuestion: boolean;
  mockQuestion: boolean;
  learningQuestion: boolean;
}

export type WorkspaceActions = Pick<PrepDeckStore, Keys<typeof WORKSPACE_ACTIONS>>;
export type CatalogActions = Pick<PrepDeckStore, Keys<typeof CATALOG_ACTIONS>>;
export type ReviewListsActions = Pick<PrepDeckStore, Keys<typeof REVIEW_ACTIONS>>;
export type PracticeActions = Pick<PrepDeckStore, Keys<typeof PRACTICE_ACTIONS>>;
export type AiActions = Pick<PrepDeckStore, Keys<typeof AI_ACTIONS>>;
export type LearningActions = Pick<PrepDeckStore, Keys<typeof LEARNING_ACTIONS>>;
export type MockExamActions = Pick<PrepDeckStore, Keys<typeof MOCK_ACTIONS>>;
export type NotesActions = Pick<PrepDeckStore, Keys<typeof NOTES_ACTIONS>>;
export type AccountActions = Pick<PrepDeckStore, Keys<typeof ACCOUNT_ACTIONS>>;

// These fields of `source`, as the same object for as long as none of them
// changes. The cache is keyed by the values themselves, so a render React
// throws away leaves nothing wrong behind.
function usePicked<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const cached = useRef<Pick<T, K> | null>(null);
  const previous = cached.current;
  if (previous && keys.every((key) => previous[key] === source[key])) return previous;
  const picked = {} as Pick<T, K>;
  for (const key of keys) picked[key] = source[key];
  cached.current = picked;
  return picked;
}

function sliceContext<T>(name: string) {
  const ctx = createContext<T | null>(null);
  ctx.displayName = name;
  const use = (): T => {
    const value = useContext(ctx);
    if (value === null) throw new Error(`${name} must be read within a PrepDeckProvider`);
    return value;
  };
  return { ctx, use };
}

const store = sliceContext<PrepDeckStore>("PrepDeckStore");
const viewport = sliceContext<Viewport>("Viewport");
const stages = sliceContext<SessionStages>("SessionStages");
const workspaceState = sliceContext<WorkspaceState>("WorkspaceState");
const workspaceActions = sliceContext<WorkspaceActions>("WorkspaceActions");
const catalogState = sliceContext<CatalogState>("CatalogState");
const catalogActions = sliceContext<CatalogActions>("CatalogActions");
const reviewState = sliceContext<ReviewListsState>("ReviewListsState");
const reviewActions = sliceContext<ReviewListsActions>("ReviewListsActions");
const progressState = sliceContext<StudyProgressState>("StudyProgressState");
const practiceState = sliceContext<PracticeState>("PracticeState");
const practiceActions = sliceContext<PracticeActions>("PracticeActions");
const aiState = sliceContext<AiState>("AiState");
const aiActions = sliceContext<AiActions>("AiActions");
const learningState = sliceContext<LearningState>("LearningState");
const learningActions = sliceContext<LearningActions>("LearningActions");
const mockState = sliceContext<MockExamState>("MockExamState");
const mockClock = sliceContext<{ mLeft: number }>("MockClock");
const mockActions = sliceContext<MockExamActions>("MockExamActions");
const notesState = sliceContext<NotesState>("NotesState");
const noteDraftState = sliceContext<NoteDraftState>("NoteDraftState");
const textSelection = sliceContext<{ tsel: AppState["tsel"] }>("TextSelection");
const notesActions = sliceContext<NotesActions>("NotesActions");
const accountState = sliceContext<AccountState>("AccountState");
const accountActions = sliceContext<AccountActions>("AccountActions");

/** The whole store; renders on every change. For fixtures and tests. */
export const useStore = store.use;
export const useViewport = viewport.use;
export const useSessionStages = stages.use;
export const useWorkspaceState = workspaceState.use;
export const useWorkspaceActions = workspaceActions.use;
export const useCatalogState = catalogState.use;
export const useCatalogActions = catalogActions.use;
export const useReviewListsState = reviewState.use;
export const useReviewListsActions = reviewActions.use;
export const useStudyProgressState = progressState.use;
export const usePracticeState = practiceState.use;
export const usePracticeActions = practiceActions.use;
export const useAiState = aiState.use;
export const useAiActions = aiActions.use;
export const useLearningState = learningState.use;
export const useLearningActions = learningActions.use;
export const useMockExamState = mockState.use;
/** The mock countdown's seconds left; changes every second of a live mock. */
export const useMockClock = (): number => mockClock.use().mLeft;
export const useMockExamActions = mockActions.use;
export const useNotesState = notesState.use;
/** The note being written; changes on every keystroke. */
export const useNoteDraftState = noteDraftState.use;
/** The text selected for a mark; changes with every selection. */
export const useTextSelection = (): AppState["tsel"] => textSelection.use().tsel;
export const useNotesActions = notesActions.use;
export const useAccountState = accountState.use;
export const useAccountActions = accountActions.use;

function provide<T>(ctx: Context<T | null>, value: T) {
  return (inner: ReactNode) => <ctx.Provider value={value}>{inner}</ctx.Provider>;
}

/** Splits a whole store (PrepDeckProvider's, or a fixture's) into the slice contexts. */
export function StoreProviders({ store: whole, children }: { store: PrepDeckStore; children: ReactNode }) {
  const { state, curQ, mockQ, learningQ } = whole;
  const practiceFields = usePicked(state, PRACTICE_STATE);
  const learningFields = usePicked(state, LEARNING_STATE);
  const mockFields = usePicked(state, MOCK_STATE);
  const practice = useMemo(() => ({ ...practiceFields, curQ }), [practiceFields, curQ]);
  const learning = useMemo(() => ({ ...learningFields, learningQ }), [learningFields, learningQ]);
  const mock = useMemo(() => ({ ...mockFields, mockQ }), [mockFields, mockQ]);
  const sessionStages = usePicked({
    pStage: state.pStage, mStage: state.mStage, lStage: state.lStage,
    practiceQuestion: !!curQ(), mockQuestion: !!mockQ(), learningQuestion: !!learningQ(),
  }, ["pStage", "mStage", "lStage", "practiceQuestion", "mockQuestion", "learningQuestion"]);
  const clock = usePicked(state, ["mLeft"]);
  const selection = usePicked(state, ["tsel"]);

  const layers = [
    provide(store.ctx, whole),
    provide(viewport.ctx, usePicked(whole, VIEWPORT)),
    provide(stages.ctx, sessionStages),
    provide(workspaceState.ctx, usePicked(state, WORKSPACE_STATE)),
    provide(workspaceActions.ctx, usePicked(whole, WORKSPACE_ACTIONS)),
    provide(catalogState.ctx, usePicked(state, CATALOG_STATE)),
    provide(catalogActions.ctx, usePicked(whole, CATALOG_ACTIONS)),
    provide(reviewState.ctx, usePicked(state, REVIEW_STATE)),
    provide(reviewActions.ctx, usePicked(whole, REVIEW_ACTIONS)),
    provide(progressState.ctx, usePicked(state, PROGRESS_STATE)),
    provide(practiceState.ctx, practice),
    provide(practiceActions.ctx, usePicked(whole, PRACTICE_ACTIONS)),
    provide(aiState.ctx, usePicked(state, AI_STATE)),
    provide(aiActions.ctx, usePicked(whole, AI_ACTIONS)),
    provide(learningState.ctx, learning),
    provide(learningActions.ctx, usePicked(whole, LEARNING_ACTIONS)),
    provide(mockState.ctx, mock),
    provide(mockClock.ctx, clock),
    provide(mockActions.ctx, usePicked(whole, MOCK_ACTIONS)),
    provide(notesState.ctx, usePicked(state, NOTES_STATE)),
    provide(noteDraftState.ctx, usePicked(state, NOTE_DRAFT_STATE)),
    provide(textSelection.ctx, selection),
    provide(notesActions.ctx, usePicked(whole, NOTES_ACTIONS)),
    provide(accountState.ctx, usePicked(state, ACCOUNT_STATE)),
    provide(accountActions.ctx, usePicked(whole, ACCOUNT_ACTIONS)),
  ];
  return <>{layers.reduceRight<ReactNode>((inner, layer) => layer(inner), children)}</>;
}
