import { WorkspaceRequests, storedExam, storeExam, beforeWorkspaceNavigation } from "../lib/examWorkspace";
import { catalogQuestionIds } from "../lib/reviewLists";
import { needsFocusedPractice } from "../lib/practiceEligibility";
import { allowAuthoringNavigation } from "../lib/questionAuthoring";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type {
  ActiveAttemptResponse,
  AnnotationResponse,
  AnnotationSettingsResponse,
  AnnotationsListResponse,
  AvatarUploadResponse,
  CompleteAttemptResponse,
  DailyEmailSettingsResponse,
  LearningProgressResponse,
  LearningQuestionDetailResponse,
  MarkStyle,
  NoteResponse,
  NotesListResponse,
  PracticeCatalogResponse,
  PracticeQuestionContentResponse,
  ProfileResponse,
  StartAttemptResponse,
  SubmitPracticeAnswerResponse,
  UpdateAnnotationSettingsRequest,
  UpdateDailyEmailSettingsRequest,
  UserProfile,
  UserSettingsResponse
} from "@prepdeck/shared";
import { CURATED_MODELS, DEFAULT_MARK_ALIASES, hasAnswer, MAX_ATTEMPT_QUESTIONS } from "@prepdeck/shared";
import { apiFetch, ApiError } from "../lib/api";
import { fromSharedAnnotation, toCreateAnnotationRequest } from "../lib/annotations";
import { fromSharedNote } from "../lib/notes";
import { fetchCachedExplanations, generateExplanation } from "../lib/ai";
import {
  getSessionKey, setSessionKey, clearSessionKey, hasStoredEncryptedKey, saveEncryptedKey,
  loadEncryptedKey, clearStoredEncryptedKey
} from "../lib/keyStorage";
import { getStoredKeyMode, storeKeyMode } from "../lib/keyModeStorage";
import { DEFAULT_THEME, getStoredTheme, storeTheme } from "../lib/themeStorage";
import type {
  AiExplanationEntry, AiRecord, Annotation, AnnotationStyle, AnnotationTarget, Difficulty, ExamSummary,
  GradedAnswer, KeyMode, LearningDetail, Note, Question, ScreenId, ThemeId, TextSelection, WrongEntry
} from "../types";

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
  count: number;
}
export type FeedbackMode = "immediate" | "end";
export type ListMode = "wrong" | "bm";
export type Provider = "anthropic" | "openai";
export type { KeyMode };

// A sensible per-exam mock default (FR-4.1): roughly the AWS professional-exam
// question density, capped to however many questions the bank actually has.
function defaultMockCount(total: number): number {
  return Math.max(1, Math.min(65, total));
}
function defaultMockMinutes(count: number): number {
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
  lStartInput: number;
  lQueue: string[];
  lIdx: number;
  lResume: number | null;
  lDetail: Record<string, LearningDetail>;

  // implementation — cross-screen navigation intents: "jump to this question in
  // Learning Mode for pure review" (from a Knowledge Point's linked-
  // questions card) and "open this Knowledge Point note" (from a question's
  // related-notes card). Each is consumed and cleared by the screen/effect
  // that handles it.
  pendingQuestionJump: { examId: string; questionId: string } | null;
  pendingKnowledgePointId: string | null;
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
  mockCount: number;
  mockMinutes: number;
  mockResult: CompleteAttemptResponse | null;
  activeMockAttempt: ActiveAttemptResponse | null;

  listMode: ListMode;
  bookmarks: Record<string, boolean>;
  wrong: Record<string, WrongEntry>;
  attempted: Record<string, boolean>;
  mastered: Record<string, boolean>;
  ai: Record<string, AiRecord>;
  anns: Annotation[];
  markAliases: Record<MarkStyle, string>;
  notes: Note[];
  noteDraft: string;
  noteDraftQuestionId: string | null;
  noteVis: "private" | "shared";
  showShared: boolean;
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

const initialState: AppState = {
  screen: "dash", more: false,

  me: null,

  exams: [], examId: null, catalog: [], catalogBy: {}, catalogRevision: 0, questionContent: {},
  workspaceStatus: "loading", workspaceError: null, workspaceNotice: null,
  actionError: null, switching: false, workspaceGeneration: 0, activityRevision: 0,

  pStage: "setup", source: "all", diff: "all", count: 10, feedback: "immediate",
  tags: [], queue: [], idx: 0, sel: {}, done: {}, graded: {}, attemptId: null,

  lStage: "setup", lTags: [], lDiff: "all", lStartInput: 1, lQueue: [], lIdx: 0, lResume: null, lDetail: {},
  pendingQuestionJump: null, pendingKnowledgePointId: null, pendingSlugQuestionJump: null,

  mStage: "setup", mQueue: [], mIdx: 0, mSel: {}, mFlag: {}, mLeft: 0, mockDeadline: null, mConfirm: false,
  mockAttemptId: null, mockCount: 10, mockMinutes: 30, mockResult: null, activeMockAttempt: null,

  listMode: "wrong",
  bookmarks: {}, wrong: {}, attempted: {}, mastered: {}, ai: {}, anns: [], markAliases: { ...DEFAULT_MARK_ALIASES }, notes: [],
  noteDraft: "", noteDraftQuestionId: null, noteVis: "private", showShared: true, emailSettings: null,
  provider: "anthropic", model: CURATED_MODELS.anthropic[0]!.id,
  keyMode: getStoredKeyMode() ?? "memory", hasSessionKey: false, hasStoredKey: false,
  theme: getStoredTheme() ?? DEFAULT_THEME,
  tsel: null
};

type Patch = Partial<AppState> | ((s: AppState) => Partial<AppState>);

interface PrepDeckStore {
  state: AppState;
  width: number;
  pool: () => Question[];
  curQ: () => Question | undefined;
  mockQ: () => Question | undefined;
  loadQuestionContent: (questionId: string) => void;
  loadLearningDetail: (questionId: string) => void;

  go: (id: ScreenId, options?: { newMock?: boolean }) => void;
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
  useAlternateAi: (q: Question, alt: AiExplanationEntry) => void;

  learningPool: () => Question[];
  learningQ: () => Question | undefined;
  setLearningStartInput: (n: number) => void;
  toggleLearningTag: (tag: string) => void;
  setLearningDiff: (id: Difficulty | "all") => void;
  beginLearning: (fromSequence?: number) => void;
  learningNext: () => void;
  learningPrev: () => void;
  learningGotoSequence: (seq: number) => void;

  // implementation — Knowledge Points ↔ Learning Mode cross-navigation.
  goToQuestionForReview: (examId: string, questionId: string) => void;
  openKnowledgePointNote: (noteId: string) => void;
  clearPendingKnowledgePoint: () => void;

  setMockCount: (n: number) => void;
  setMockMinutes: (n: number) => void;
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
  setTheme: (t: ThemeId) => void;

  updateDisplayName: (displayName: string) => void;
  uploadAvatar: (blob: Blob) => void;
}

const PrepDeckCtx = createContext<PrepDeckStore | null>(null);

function base(node: Node | null): number | null {
  let el = node && node.nodeType === 3 ? (node.parentElement as HTMLElement | null) : (node as HTMLElement | null);
  while (el && el.dataset.off === undefined) el = el.parentElement;
  return el ? parseInt(el.dataset.off || "0", 10) : null;
}

// The Worker refuses draft writes once a mock is past its deadline (FR-4.3) and
// marks that refusal `expired`, which is the one 409 the client must not treat
// as retryable: telling the user "it will be retried before submitting" would
// promise a retry that can only fail again.
function isExpiredAttempt(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && (error.body as { expired?: boolean } | null)?.expired === true;
}

function remainingSeconds(active: ActiveAttemptResponse): number {
  if (active.timeLimitSeconds == null) return 0;
  const elapsed = Math.floor((Date.now() - new Date(active.startedAt).getTime()) / 1000);
  return Math.max(0, active.timeLimitSeconds - elapsed);
}

export function PrepDeckProvider({ children }: { children: React.ReactNode }) {
  const [state, setStateRaw] = useState<AppState>(initialState);
  const [width, setWidth] = useState<number>(typeof window !== "undefined" ? window.innerWidth : 1280);
  const stateRef = useRef(state);
  const requests = useRef(new WorkspaceRequests()).current;
  const dirtyAnnotations = useRef(new Map<string, string>());
  const dirtyMock = useRef(new Map<string, () => Promise<unknown>>());

  const setState = useCallback((patch: Patch) => {
    const next = { ...stateRef.current, ...(typeof patch === "function" ? patch(stateRef.current) : patch) };
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  // Capture before starting work, and check again when React state is applied.
  const scopedState = useCallback((lane?: string) => {
    const current = requests.capture(lane);
    return (patch: Patch) => { if (current()) setState(patch); };
  }, [requests, setState]);
  useEffect(() => () => requests.invalidate(), [requests]);
  const dismissActionError = useCallback(() => setState({ actionError: null }), [setState]);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [bankRevision, setBankRevision] = useState(0);
  useEffect(() => {
    const changed = () => { setBankRevision(n => n + 1); setState({ lDetail: {}, ai: {} }); };
    window.addEventListener("prepdeck:question-bank-changed", changed);
    return () => window.removeEventListener("prepdeck:question-bank-changed", changed);
  }, [setState]);

  const switchExamRef = useRef<(id: string | null) => Promise<boolean>>(async () => false);
  // Resolve identity before restoring selection: browser storage is per user.
  useEffect(() => {
    let cancelled = false;
    // /api/auth/me is a cheap re-fetch of an already-validated session (used
    // here only to key per-account exam restoration); its failure shouldn't
    // block the exam list, which the whole workspace depends on.
    Promise.allSettled([apiFetch<ProfileResponse>("/api/auth/me"), apiFetch<{ exams: ExamSummary[] }>("/api/exams")])
      .then(async ([meResult, examsResult]) => {
        if (cancelled) return;
        if (examsResult.status === "rejected") {
          setState(s => s.workspaceStatus === "ready"
            ? { actionError: "Could not refresh your exams. Your current work is retained; please retry." }
            : { workspaceStatus: "error", workspaceError: "Could not load your exams. Please retry." });
          return;
        }
        const { exams } = examsResult.value;
        const user = meResult.status === "fulfilled" ? meResult.value.user : null;
        const previous = stateRef.current.examId;
        const saved = previous ?? (user ? storedExam(user.id) : null);
        const selected = exams.some(e => e.id === saved) ? saved : exams[0]?.id ?? null;
        setState(s => ({ me: user ?? s.me, exams }));
        if (previous && selected !== previous) {
          setState({ workspaceNotice: "The selected exam is no longer available. Select an available exam to continue." });
          if (!await switchExamRef.current(selected)) setState({ actionError: "This exam is unavailable. Your work is retained; retry saving and switching to an available exam." });
        } else if (!previous) {
          requests.invalidate();
          setState(s => ({ examId: selected, workspaceStatus: selected ? "loading" : "empty",
            workspaceGeneration: s.workspaceGeneration + 1,
            workspaceNotice: saved && saved !== selected ? "Your previous exam is unavailable. An available exam has been selected." : null }));
          if (user) storeExam(user.id, selected);
        }
      });
    return () => { cancelled = true; };
  }, [setState, requests, bankRevision]);

  // implementation: this user's display aliases for the 3 mark types, loaded
  // once. initialState already holds sensible defaults, so a slow/failed
  // fetch just means the built-in defaults keep showing.
  useEffect(() => {
    apiFetch<AnnotationSettingsResponse>("/api/annotation-settings")
      .then((r) => setState({ markAliases: { hl1: r.hl1Alias, hl2: r.hl2Alias, hl3: r.hl3Alias } }))
      .catch(() => {});
  }, [setState]);

  // FR-7.9: whether an encrypted key is already sitting in IndexedDB from a
  // prior visit — read once so screens beyond Settings (Practice/Learning's
  // "Generate explanation") can offer an unlock prompt instead of just
  // pointing the user back to Settings.
  useEffect(() => {
    hasStoredEncryptedKey().then((v) => setState({ hasStoredKey: v })).catch(() => {});
  }, [setState]);

  // public/theme-init.js puts the stored scheme on <html> before React mounts,
  // so the first paint is already themed. Keep that attribute in step with the
  // live choice: overlays that React Aria portals into <body> (implementation) sit
  // outside the Shell's own [data-pd-theme] element and read their palette
  // from <html>, so a stale value there would leave them on the old scheme
  // until the next reload.
  useEffect(() => {
    document.documentElement.setAttribute("data-pd-theme", state.theme || DEFAULT_THEME);
  }, [state.theme]);

  // Themes are browser-local. In particular, do not restore the legacy
  // account-level theme on a new browser: without a local choice, Light is the
  // default for that browser.
  useEffect(() => {
    apiFetch<UserSettingsResponse>("/api/settings")
      .then(({ showSharedNotes }) => setState({ showShared: showSharedNotes }))
      .catch(() => {});
  }, [setState]);

  // implementation: this user's daily review email preferences, loaded once.
  // Stays null on a slow/failed fetch — Settings.tsx treats that as "not
  // loaded yet" rather than guessing a default.
  useEffect(() => {
    apiFetch<DailyEmailSettingsResponse>("/api/daily-email-settings")
      .then((r) => setState({ emailSettings: r }))
      .catch(() => {});
  }, [setState]);

  useEffect(() => {
    const examId = state.examId;
    if (!examId) return;
    let cancelled = false;
    const update = scopedState("catalog");
    // A background refresh of this same exam must not unmount dirty editors.
    // Actual switches already cleared the old catalog and entered loading.
    setState(s => ({ workspaceStatus: s.workspaceStatus === "ready" ? "ready" : "loading", workspaceError: null }));
    Promise.all([
      apiFetch<PracticeCatalogResponse>(`/api/exams/${examId}/practice-catalog`),
      apiFetch<{ attempt: ActiveAttemptResponse | null }>(`/api/attempts/active?examId=${examId}&mode=mock`),
      apiFetch<{ progress: LearningProgressResponse }>(`/api/exams/${examId}/learning/progress`),
      apiFetch<AnnotationsListResponse>(`/api/annotations?examId=${encodeURIComponent(examId)}`),
      apiFetch<NotesListResponse>(`/api/notes?examId=${encodeURIComponent(examId)}`)
    ]).then(([data, { attempt }, { progress }, { annotations }, { notes }]) => {
      if (cancelled) return;
      const catalog: Question[] = data.questions.map(q => ({
        id: q.id, externalId: q.externalId, sequenceNumber: q.sequenceNumber, type: q.type,
        chooseCount: q.chooseCount, tags: q.tags, diff: q.difficulty, stem: q.stem, options: q.options,
        hasContent: q.hasContent, revision: q.revision, content: q.content
      }));
      const catalogBy = Object.fromEntries(catalog.map(q => [q.id, q]));
      const count = defaultMockCount(catalog.length);
      update(s => ({ catalog, catalogBy, catalogRevision: s.catalogRevision + 1, questionContent: {}, lDetail: {}, workspaceStatus: "ready", workspaceError: null,
        bookmarks: Object.fromEntries(data.bookmarkedIds.filter(id => catalogBy[id]).map(id => [id, true])),
        wrong: Object.fromEntries(data.wrongEntries.filter(e => catalogBy[e.questionId]).map(e => [e.questionId, { c: e.wrongCount, at: e.lastWrongAt }])),
        mastered: {}, attempted: Object.fromEntries(data.attemptedIds.map(id => [id, true])),
        mockCount: count, mockMinutes: defaultMockMinutes(count), activeMockAttempt: attempt,
        lResume: progress.lastSequenceNumber, anns: annotations.map(fromSharedAnnotation), notes: notes.map(fromSharedNote)
      }));
    }).catch(() => {
      if (!cancelled) update(s => s.workspaceStatus === "ready"
        ? { actionError: "Could not refresh this exam. Your current work is retained; please retry." }
        : { workspaceStatus: "error", workspaceError: "Could not load this exam. Please retry." });
    });
    return () => { cancelled = true; };
  }, [state.examId, state.workspaceGeneration, scopedState, setState, bankRevision]);
  const retryWorkspace = useCallback(() => setBankRevision(n => n + 1), []);

  const pool = useCallback((): Question[] => {
    const s = stateRef.current;
    return s.catalog.filter((q) => {
      if (s.source === "wrong" && (!s.wrong[q.id] || s.mastered[q.id])) return false;
      if (s.source === "bm" && !s.bookmarks[q.id]) return false;
      if (s.source === "new" && s.attempted[q.id]) return false;
      if (s.source === "focus" && !needsFocusedPractice(q.id, s)) return false;
      if (s.diff !== "all" && q.diff !== s.diff) return false;
      if (s.tags.length && !q.tags.some((t) => s.tags.indexOf(t) >= 0)) return false;
      return true;
    });
  }, []);

  const curQ = useCallback((): Question | undefined => {
    const id = state.queue[state.idx];
    return id ? state.catalogBy[id] : undefined;
  }, [state.queue, state.idx, state.catalogBy]);
  const mockQ = useCallback((): Question | undefined => {
    const id = state.mQueue[state.mIdx];
    return id ? state.catalogBy[id] : undefined;
  }, [state.mQueue, state.mIdx, state.catalogBy]);

  const loadQuestionContent = useCallback((qid: string) => {
    const { examId, catalogBy, catalogRevision, questionContent } = stateRef.current;
    const requested = catalogBy[qid];
    if (!examId || !requested?.hasContent || requested.content || questionContent[qid]?.status === "loading") return;
    const update = scopedState(`questionContent:${qid}`);
    update(s => ({ questionContent: { ...s.questionContent, [qid]: { status: "loading" } } }));
    apiFetch<PracticeQuestionContentResponse>(`/api/exams/${encodeURIComponent(examId)}/practice-catalog/${encodeURIComponent(qid)}`, { cache: "no-store" })
      .then(({ content, revision }) => {
        if (!content || (requested.revision !== undefined && requested.revision !== revision)) {
          throw new Error("This question changed. Refresh the exam and try again.");
        }
        update(s => {
          // Ignore snapshots requested before a same-exam catalog refresh,
          // while allowing Learning and Practice to hydrate the same row.
          if (s.catalogRevision !== catalogRevision || !s.catalogBy[qid]) return {};
          const question = { ...requested, content };
          const pending = { ...s.questionContent }; delete pending[qid];
          return { catalog: s.catalog.map(q => q.id === qid ? question : q),
            catalogBy: { ...s.catalogBy, [qid]: question }, questionContent: pending };
        });
      }).catch(error => update(s => s.catalogRevision !== catalogRevision || !s.catalogBy[qid] ? {} : {
        questionContent: { ...s.questionContent, [qid]: { status: "error", error: error instanceof Error ? error.message : "Could not load this question. Please retry." } }
      }));
  }, [scopedState]);

  // Shared by "start a filtered practice session," "practice this list of
  // wrong/bookmarked questions," and "review a single question" — all create
  // a real attempt server-side so submit() has something to grade against.
  const begin = useCallback((requestedIds: string[]) => {
    const ids = catalogQuestionIds(requestedIds, stateRef.current.catalogBy);
    if (!ids.length || !stateRef.current.examId || stateRef.current.workspaceStatus !== "ready" || stateRef.current.switching) return;
    if (requests.has("start") || !stateRef.current.exams.some(e => e.id === stateRef.current.examId)) return;
    const update = scopedState("start");
    const examId = stateRef.current.examId;
    requests.write("start", () => apiFetch<StartAttemptResponse>(`/api/exams/${examId}/attempts`, {
      method: "POST",
      body: JSON.stringify({ mode: "practice", questionIds: ids })
    })).then(({ attemptId }) => {
      update({ screen: "practice", pStage: "live", queue: ids, idx: 0, sel: {}, done: {}, graded: {}, attemptId });
    }).catch(() => update({ actionError: "Could not start practice. Please try again." }));
  }, [scopedState, requests]);

  const pick = useCallback((q: Question, oid: string | string[]) => {
    const current = stateRef.current.catalogBy[q.id];
    if (!current || (current.hasContent && !current.content) || stateRef.current.done[q.id] || stateRef.current.switching) return;
    setState((s) => {
      const cur = (s.sel[q.id] || []).slice();
      let nx: string[];
      if (Array.isArray(oid)) nx = oid;
      else if (q.type === "multiple_choice") {
        const i = cur.indexOf(oid);
        if (i >= 0) cur.splice(i, 1);
        else if (cur.length < (q.chooseCount || 1)) cur.push(oid);
        nx = cur;
      } else nx = [oid];
      return { sel: { ...s.sel, [q.id]: nx } };
    });
  }, [setState]);

  const savePracticeAnswer = useCallback(async (qid: string, attemptId: string, chosen: string[]) => {
    const update = scopedState();
    const q = stateRef.current.catalogBy[qid];
    if (!q || !hasAnswer(q.type, chosen)) return;
    const { isCorrect, correctAnswers, explanation, answerRevision, answerRevisedAt } = await requests.write(`answer:${attemptId}:${qid}`, () =>
      apiFetch<SubmitPracticeAnswerResponse>(`/api/attempts/${attemptId}/answers`, {
        method: "POST", body: JSON.stringify({ questionId: qid, selectedAnswer: chosen })
      }));
      update((s) => {
        if (s.attemptId !== attemptId) return {};
        const wrong = { ...s.wrong };
        // Mirrors the server's wrong-book rule exactly (routes/attempts.ts), so
        // this optimistic entry survives the next catalog load unchanged.
        const answeredWrong = !isCorrect && hasAnswer(q.type, chosen);
        if (answeredWrong) {
          const prev = wrong[q.id];
          wrong[q.id] = { c: (prev ? prev.c : 0) + 1, at: new Date().toISOString() };
        }
        return {
          done: { ...s.done, [q.id]: isCorrect ? "ok" : "no" },
          graded: { ...s.graded, [q.id]: { isCorrect, correctAnswers, explanation, answerRevision, answerRevisedAt } },
          wrong,
          mastered: answeredWrong ? { ...s.mastered, [q.id]: false } : s.mastered,
          attempted: { ...s.attempted, [q.id]: true }
        };
      });
  }, [requests, scopedState]);
  const submit = useCallback(() => {
    const s = stateRef.current;
    const qid = s.queue[s.idx];
    if (!qid || !s.attemptId || s.switching || s.done[qid] || requests.has(`answer:${s.attemptId}:${qid}`)) return;
    const question = s.catalogBy[qid];
    if (question?.hasContent && !question.content) return;
    const update = scopedState();
    void savePracticeAnswer(qid, s.attemptId, s.sel[qid] ?? [])
      .catch(() => update({ actionError: "Could not save your answer. Please submit it again." }));
  }, [requests, scopedState, savePracticeAnswer]);

  const completeAttempt = useCallback(async (attemptId: string | null) => {
    if (!attemptId) return;
    await requests.drain();
    await apiFetch(`/api/attempts/${attemptId}/complete`, { method: "POST" });
  }, [requests]);
  const saveQuestionDraftRef = useRef<() => Promise<void>>(async () => {});
  const movingQuestion = useRef(false);
  const navigateQuestion = useCallback((move: () => void | Promise<void>) => {
    if (stateRef.current.switching || movingQuestion.current) return;
    movingQuestion.current = true;
    void beforeWorkspaceNavigation().then(() => saveQuestionDraftRef.current()).then(move)
      .catch(() => setState({ actionError: "Could not save your question note. Your draft is retained; retry before changing questions." }))
      .finally(() => { movingQuestion.current = false; });
  }, [setState]);
  const endSession = useCallback(() => {
    if (stateRef.current.switching) return;
    const update = scopedState();
    const attemptId = stateRef.current.attemptId;
    navigateQuestion(() => completeAttempt(attemptId).then(() => update(s => s.attemptId !== attemptId ? {} : {
      pStage: "setup", attemptId: null, activityRevision: s.activityRevision + 1
    })).catch(() => update({ actionError: "Could not finish this practice. Please retry; your session is retained." })));
  }, [scopedState, completeAttempt, navigateQuestion]);
  const next = useCallback(() => {
    const s = stateRef.current;
    if (s.switching) return;
    if (s.idx + 1 >= s.queue.length) endSession();
    else navigateQuestion(() => setState({ idx: s.idx + 1, tsel: null }));
  }, [setState, endSession, navigateQuestion]);
  const prevQ = useCallback(() => {
    navigateQuestion(() => setState((s) => ({ idx: Math.max(0, s.idx - 1), tsel: null })));
  }, [setState, navigateQuestion]);

  const writeBookmark = useCallback((id: string, next: boolean) => {
    const s = stateRef.current;
    if (s.switching || !s.catalogBy[id] || requests.has(`bookmark:${s.me?.id}:${id}`)) return;
    const update = scopedState(`bookmark:${id}`);
    const previous = !!s.bookmarks[id];
    setState(current => ({ bookmarks: { ...current.bookmarks, [id]: next } }));
    void requests.write(`bookmark:${s.me?.id}:${id}`, () => apiFetch(`/api/questions/${id}/bookmark`, { method: next ? "PUT" : "DELETE" }))
      .catch(() => update(current => ({ bookmarks: { ...current.bookmarks, [id]: previous }, actionError: "Could not save bookmark changes. Please retry." })));
  }, [requests, scopedState, setState]);

  // No id -> bookmark the question currently being answered in live practice
  // (PracticeLive's toolbar button). An explicit id lets other review
  // surfaces — mock results, wrong/bookmarks lists — bookmark any question
  // (FR-6.1: "during practice, mock review, or browsing").
  const toggleBookmark = useCallback((questionId?: string) => {
    const id = questionId ?? curQ()?.id;
    if (id) writeBookmark(id, !stateRef.current.bookmarks[id]);
  }, [curQ, writeBookmark]);

  // FR-7.2/FR-7.3: check the shared cache (any provider/model) before ever
  // asking for a key. Called once per question as its review panel opens.
  const checkAiCache = useCallback((q: Question) => {
    const setState = scopedState("checkAiCache" + q.id);
    setState((s) => ({ ai: { ...s.ai, [q.id]: { status: "checking" } } }));
    fetchCachedExplanations(q.id).then((explanations) => {
      const { provider, model } = stateRef.current;
      const exact = explanations.find((e) => e.provider === provider && e.model === model);
      const alternates = explanations.filter((e) => e !== exact);
      if (exact) {
        setState((s) => ({
          ai: {
            ...s.ai,
            [q.id]: {
              status: "ready", cached: true, content: exact.content, provider: exact.provider,
              model: exact.model, canManage: exact.canManage, alternates
            }
          }
        }));
      } else {
        setState((s) => ({ ai: { ...s.ai, [q.id]: { status: "idle", alternates } } }));
      }
    }).catch(() => {
      setState((s) => ({ ai: { ...s.ai, [q.id]: { status: "idle" } } }));
    });
  }, [scopedState]);

  // FR-7.4: on a cache miss, relay to the user's own provider/model via the
  // Worker's fixed AI-proxy endpoint, sending the key for this one request
  // only (never persisted — see lib/keyStorage.ts). FR-7.7: `force` bypasses
  // the cache to regenerate (Admin or the original requester only; the
  // Worker re-checks this server-side regardless of what the client sends).
  const genAi = useCallback((q: Question, force?: boolean) => {
    const setState = scopedState("genAi" + q.id);
    const { provider, model } = stateRef.current;
    const apiKey = getSessionKey();
    if (!apiKey) {
      setState((s) => ({
        ai: { ...s.ai, [q.id]: { ...(s.ai[q.id] ?? { status: "idle" }), status: "error", error: "Enter your API key in Settings first." } }
      }));
      return;
    }
    setState((s) => ({ ai: { ...s.ai, [q.id]: { ...(s.ai[q.id] ?? { status: "idle" }), status: "generating", error: undefined } } }));
    generateExplanation(q.id, provider, model, apiKey, force).then(({ explanation, cached }) => {
      setState((s) => ({
        ai: {
          ...s.ai,
          [q.id]: {
            status: "ready", cached, content: explanation.content, provider: explanation.provider,
            model: explanation.model, canManage: explanation.canManage, alternates: s.ai[q.id]?.alternates
          }
        }
      }));
    }).catch((err) => {
      setState((s) => ({
        ai: { ...s.ai, [q.id]: { ...(s.ai[q.id] ?? { status: "idle" }), status: "error", error: err instanceof ApiError ? err.message : "Could not generate an explanation." } }
      }));
    });
  }, [scopedState]);

  // FR-7.3: show an already-cached explanation from a different provider/
  // model, clearly labeled, instead of generating a fresh one.
  const useAlternateAi = useCallback((q: Question, alt: AiExplanationEntry) => {
    setState((s) => ({
      ai: {
        ...s.ai,
        [q.id]: { ...(s.ai[q.id] ?? { status: "idle" }), status: "ready", cached: true, content: alt.content, provider: alt.provider, model: alt.model, canManage: alt.canManage }
      }
    }));
  }, [setState]);

  // docs/requirements/practice-and-learning-modes.md — Learning Mode. FR-14.2: same tag/difficulty filters as
  // Practice, kept in their own lTags/lDiff (not shared with state.tags/diff)
  // so switching between Practice and Learning doesn't cross-contaminate
  // filter choices. Sorted by sequenceNumber (FR-14.1) — when a filter is
  // active, this sorted-and-filtered array's own order *is* the "sequence
  // order" per FR-14.2, while each question's real sequenceNumber (stable
  // across filter changes) is still what "start from #N" and resume (FR-14.9)
  // are keyed on.
  const learningPool = useCallback((): Question[] => {
    const s = stateRef.current;
    return s.catalog
      .filter((q) => {
        if (s.lDiff !== "all" && q.diff !== s.lDiff) return false;
        if (s.lTags.length && !q.tags.some((t) => s.lTags.indexOf(t) >= 0)) return false;
        return true;
      })
      .slice()
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }, []);

  const learningQ = useCallback((): Question | undefined => {
    const id = state.lQueue[state.lIdx];
    return id ? state.catalogBy[id] : undefined;
  }, [state.lQueue, state.lIdx, state.catalogBy]);

  const setLearningStartInput = useCallback((n: number) => setState({ lStartInput: n }), [setState]);
  const setLearningDiff = useCallback((id: Difficulty | "all") => setState({ lDiff: id }), [setState]);
  const toggleLearningTag = useCallback((tag: string) => {
    setState((s) => {
      const a = s.lTags.slice();
      const i = a.indexOf(tag);
      if (i >= 0) a.splice(i, 1); else a.push(tag);
      return { lTags: a };
    });
  }, [setState]);

  // FR-14.3/FR-14.4: fetches the answer-key'd question plus this user's own
  // answer history — unlike Practice's graded state, this is loaded as soon
  // as a question is viewed, with no reveal step.
  const loadLearningDetail = useCallback((qid: string) => {
    const { catalogBy, catalogRevision, lDetail } = stateRef.current;
    const requested = catalogBy[qid];
    if (!requested || lDetail[qid]?.status === "loading") return;
    const setState = scopedState("loadLearningDetail" + qid);
    setState((s) => ({ lDetail: { ...s.lDetail, [qid]: { status: "loading" } } }));
    apiFetch<LearningQuestionDetailResponse>(`/api/questions/${qid}/learning-detail`, { cache: "no-store" }).then(({ question, history }) => {
      if (requested.revision !== undefined && requested.revision !== question.revision) {
        throw new Error("This question changed. Refresh the exam and try again.");
      }
      if (requested.hasContent && !question.content) throw new Error("Could not load this question. Please retry.");
      setState((s) => {
        if (s.catalogRevision !== catalogRevision || !s.catalogBy[qid]) return {};
        const hydrated = { ...s.catalogBy[qid], content: question.content ?? s.catalogBy[qid].content };
        return {
          catalog: s.catalog.map(q => q.id === qid ? hydrated : q),
          catalogBy: { ...s.catalogBy, [qid]: hydrated },
          lDetail: {
            ...s.lDetail,
            [qid]: { status: "ready", correctAnswers: question.correctAnswers, explanation: question.explanation, history, answerRevision: question.answerRevision, answerRevisedAt: question.answerRevisedAt }
          }
        };
      });
    }).catch((err) => {
      setState((s) => s.catalogRevision !== catalogRevision || !s.catalogBy[qid] ? {} : ({
        lDetail: { ...s.lDetail, [qid]: { status: "error", error: err instanceof Error ? err.message : "Could not load this question." } }
      }));
    });
  }, [scopedState]);

  // FR-14.9: updates lResume immediately (not just on the server) so leaving
  // Learning Mode mid-session and coming back — without a full page reload —
  // still offers "resume from #N" right away, instead of only reflecting
  // whatever was last fetched when this exam was selected. The PUT itself is
  // fire-and-forget: losing one write to a race/offline blip just means
  // resume lands a question or two off on the *next* app load, not worth
  // blocking navigation for.
  const saveLearningProgress = useCallback((sequenceNumber: number) => {
    const examId = stateRef.current.examId;
    if (!examId) return;
    setState({ lResume: sequenceNumber });
    const update = scopedState();
    requests.write(`learning:${examId}`, () => apiFetch(`/api/exams/${examId}/learning/progress`, { method: "PUT", body: JSON.stringify({ sequenceNumber }) }))
      .catch(() => update({ actionError: "Could not save your learning position. Please try navigating again." }));
  }, [setState, scopedState, requests]);

  // Shared by next/prev/goto/begin: moves to a queue index, then loads that
  // question's detail (FR-14.3/FR-14.4), checks the AI cache (FR-14.5, reusing
  // the same checkAiCache as Practice/Mock), and persists the new position.
  const advanceLearningTo = useCallback((idx: number) => {
    const s = stateRef.current;
    if (!s.lQueue.length) return;
    const clamped = Math.max(0, Math.min(s.lQueue.length - 1, idx));
    const qid = s.lQueue[clamped];
    const q = qid ? s.catalogBy[qid] : undefined;
    navigateQuestion(() => {
      setState({ lIdx: clamped });
      if (q) { loadLearningDetail(q.id); checkAiCache(q); saveLearningProgress(q.sequenceNumber); }
    });
  }, [setState, loadLearningDetail, checkAiCache, saveLearningProgress, navigateQuestion]);

  // FR-14.1: starts at the first (filtered) question whose real sequence
  // number is >= the chosen start (or the resume position, FR-14.9);
  // clamps to the last question if the chosen start is past the end.
  const beginLearning = useCallback((fromSequence?: number) => {
    if (stateRef.current.workspaceStatus !== "ready" || stateRef.current.switching) return;
    const list = learningPool();
    if (!list.length) return;
    const target = fromSequence ?? stateRef.current.lStartInput ?? 1;
    let idx = list.findIndex((q) => q.sequenceNumber >= target);
    if (idx < 0) idx = list.length - 1;
    const ids = list.map((q) => q.id);
    setState({ screen: "learning", lStage: "live", lQueue: ids, lIdx: idx });
    const q = list[idx]!;
    loadLearningDetail(q.id);
    checkAiCache(q);
    saveLearningProgress(q.sequenceNumber);
  }, [learningPool, setState, loadLearningDetail, checkAiCache, saveLearningProgress]);

  const learningNext = useCallback(() => advanceLearningTo(stateRef.current.lIdx + 1), [advanceLearningTo]);
  const learningPrev = useCallback(() => advanceLearningTo(stateRef.current.lIdx - 1), [advanceLearningTo]);

  // FR-14.8: jump directly to a different sequence number, within the
  // current (possibly filtered) queue.
  const learningGotoSequence = useCallback((seq: number) => {
    const s = stateRef.current;
    let idx = s.lQueue.findIndex((id) => (s.catalogBy[id]?.sequenceNumber ?? 0) >= seq);
    if (idx < 0) idx = s.lQueue.length - 1;
    advanceLearningTo(idx);
  }, [advanceLearningTo]);

  const setMockCount = useCallback((n: number) => setState({ mockCount: n }), [setState]);
  const setMockMinutes = useCallback((n: number) => setState({ mockMinutes: n }), [setState]);

  const beginMock = useCallback(() => {
    const s = stateRef.current;
    if (s.switching || s.workspaceStatus !== "ready" || requests.has("start") || !s.exams.some(e => e.id === s.examId)) return;
    const update = scopedState("start");
    if (s.activeMockAttempt) {
      const active = s.activeMockAttempt;
      setState({
        mStage: "live", mQueue: active.questionIds, mIdx: 0,
        mSel: active.selectedAnswers, mFlag: active.flagged,
        mockAttemptId: active.attemptId, mLeft: remainingSeconds(active),
        mockDeadline: new Date(active.startedAt).getTime() + (active.timeLimitSeconds ?? 0) * 1000, mConfirm: false
      });
      return;
    }
    if (!s.examId || s.catalog.length === 0) return;
    const shuffled = s.catalog.map((q) => q.id).sort(() => Math.random() - 0.5);
    // mockCount is persisted, so it can outlive the exam it was chosen for —
    // and the API rejects an attempt over MAX_ATTEMPT_QUESTIONS outright.
    const ids = shuffled.slice(0, Math.min(s.mockCount, shuffled.length, MAX_ATTEMPT_QUESTIONS));
    const timeLimitSeconds = s.mockMinutes * 60;
    requests.write("start", () => apiFetch<StartAttemptResponse>(`/api/exams/${s.examId}/attempts`, {
      method: "POST",
      body: JSON.stringify({ mode: "mock", questionIds: ids, timeLimitSeconds })
    })).then(({ attemptId, startedAt, timeLimitSeconds: serverLimit }) => {
      update({
        mStage: "live", mQueue: ids, mIdx: 0, mSel: {}, mFlag: {},
        mockAttemptId: attemptId, mLeft: serverLimit ?? timeLimitSeconds,
        mockDeadline: new Date(startedAt).getTime() + (serverLimit ?? timeLimitSeconds) * 1000, mConfirm: false
      });
    }).catch(() => update({ actionError: "Could not start this mock exam. Please retry." }));
  }, [setState, scopedState, requests]);

  const saveMockChange = useCallback((attemptId: string, path: string, body: unknown) => {
    const operation = () => apiFetch(path, { method: "PUT", body: JSON.stringify(body) });
    dirtyMock.current.set(path, operation);
    return requests.write(`mock:${attemptId}`, operation).then(() => {
      if (dirtyMock.current.get(path) === operation) dirtyMock.current.delete(path);
    }, (error) => {
      // An expired attempt will never accept this write, so it must not stay
      // dirty — persistMockDraft would replay it on every submission attempt.
      if (isExpiredAttempt(error) && dirtyMock.current.get(path) === operation) dirtyMock.current.delete(path);
      throw error;
    });
  }, [requests]);

  const mockPick = useCallback((q: Question, oid: string | string[]) => {
    // Serialize draft writes for this attempt, retaining the latest local selection.
    const current = stateRef.current.catalogBy[q.id];
    if (!current || (current.hasContent && !current.content) || stateRef.current.switching) return;
    const update = scopedState();
    const cur = (stateRef.current.mSel[q.id] || []).slice();
    let nextSel: string[];
    if (Array.isArray(oid)) nextSel = oid;
    else if (q.type === "multiple_choice") {
      const i = cur.indexOf(oid);
      if (i >= 0) cur.splice(i, 1);
      else if (cur.length < (q.chooseCount || 1)) cur.push(oid);
      nextSel = cur;
    } else nextSel = [oid];
    setState((s) => ({ mSel: { ...s.mSel, [q.id]: nextSel } }));
    const attemptId = stateRef.current.mockAttemptId;
    if (attemptId) {
      saveMockChange(attemptId, `/api/attempts/${attemptId}/answers/${q.id}`, { selectedAnswer: nextSel }).catch((error) => {
        // The server's clock ran out while this client's did not — a slept tab,
        // a skewed clock, or a request that took too long to arrive. Submit now
        // rather than leave the user answering a paper that is no longer open.
        if (isExpiredAttempt(error)) {
          update({ actionError: "Time is up. This mock exam has been submitted with the answers saved before the deadline." });
          finishMockRef.current();
          return;
        }
        update({ actionError: "Mock answer is not saved yet. It will be retried before switching or submitting." });
      });
    }
  }, [setState, saveMockChange, scopedState]);

  const mockPrev = useCallback(() => setState((s) => ({ mIdx: Math.max(0, s.mIdx - 1) })), [setState]);
  const mockNext = useCallback(() => setState((s) => ({ mIdx: Math.min(s.mQueue.length - 1, s.mIdx + 1) })), [setState]);
  const mockGoto = useCallback((i: number) => setState({ mIdx: i }), [setState]);

  const toggleFlag = useCallback(() => {
    const q = mockQ();
    const attemptId = stateRef.current.mockAttemptId;
    if (!q || !attemptId) return;
    if (stateRef.current.switching) return;
    const update = scopedState();
    const flagged = !stateRef.current.mFlag[q.id];
    setState((s) => ({ mFlag: { ...s.mFlag, [q.id]: flagged } }));
    saveMockChange(attemptId, `/api/attempts/${attemptId}/flags/${q.id}`, { flagged }).catch(() => update({ actionError: "Mock flag is not saved yet. It will be retried before switching or submitting." }));
  }, [mockQ, setState, saveMockChange, scopedState]);

  const askSubmit = useCallback(() => setState({ mConfirm: true }), [setState]);
  const cancelSubmit = useCallback(() => setState({ mConfirm: false }), [setState]);

  const persistMockDraft = useCallback(async () => {
    await requests.drain();
    const s = stateRef.current;
    const id = s.mockAttemptId;
    if (!id || s.mStage !== "live") return;
    for (const [path, operation] of dirtyMock.current) {
      if (!path.startsWith(`/api/attempts/${id}/`)) continue;
      try {
        await requests.write(`mock:${id}`, operation);
      } catch (error) {
        // A draft the server refused as past the deadline must not block
        // submission: it was never going to be graded either way, and failing
        // here would leave the attempt open with no way to close it.
        if (!isExpiredAttempt(error)) throw error;
      }
      if (dirtyMock.current.get(path) === operation) dirtyMock.current.delete(path);
    }
  }, [requests]);
  const finishingMock = useRef(false);
  const finishMockRef = useRef<() => void>(() => {});
  const autoSubmittedMock = useRef<string | null>(null);
  const finishMock = useCallback(() => {
    const attemptId = stateRef.current.mockAttemptId;
    if (!attemptId || stateRef.current.switching || finishingMock.current) return;
    finishingMock.current = true;
    const update = scopedState();
    persistMockDraft().then(() => apiFetch<CompleteAttemptResponse>(`/api/attempts/${attemptId}/complete`, { method: "POST" })).then((result) => {
      update((s) => {
        if (s.mockAttemptId !== attemptId) return {};
        const wrong = { ...s.wrong };
        const mastered = { ...s.mastered };
        const attempted = { ...s.attempted };
        // A question left blank is graded incorrect but is NOT a wrong answer:
        // the server files only answered questions in the Wrong Question Book
        // (routes/attempts.ts), so deriving membership from `isCorrect` alone
        // made the list — and the mastered flags feeding it — change under the
        // user on the next reload. `hasAnswer` is that same server-side rule.
        result.breakdown.forEach((row) => {
          attempted[row.questionId] = true;
          const type = s.catalogBy[row.questionId]?.type ?? "";
          if (!row.isCorrect && hasAnswer(type, row.selectedAnswer)) {
            mastered[row.questionId] = false;
            const prev = wrong[row.questionId];
            wrong[row.questionId] = { c: (prev ? prev.c : 0) + 1, at: new Date().toISOString() };
          }
        });
        return { mStage: "results", mConfirm: false, mockResult: result, activeMockAttempt: null, wrong, mastered, attempted, activityRevision: s.activityRevision + 1 };
      });
    }).catch(() => update({ actionError: "Could not submit this mock exam. Your answers are retained; please retry." })).finally(() => { finishingMock.current = false; });
  }, [persistMockDraft, scopedState]);
  finishMockRef.current = finishMock;

  const practiceWrong = useCallback(() => {
    const miss = (stateRef.current.mockResult?.breakdown ?? []).filter((r) => !r.isCorrect).map((r) => r.questionId);
    if (miss.length) begin(miss);
  }, [begin]);

  const saveQuestionDraft = useCallback(async () => {
    await requests.drain();
    const s = stateRef.current;
    if (!s.noteDraft.trim()) return;
    const qid = s.noteDraftQuestionId ?? (s.screen === "learning" ? s.lQueue[s.lIdx] : s.queue[s.idx]);
    if (!qid) throw new Error("Save or discard your question note before switching.");
    const content = s.noteDraft;
    const { note } = await requests.write("note-draft", () => apiFetch<NoteResponse>(`/api/questions/${qid}/notes`, {
      method: "POST", body: JSON.stringify({ content, visibility: s.noteVis })
    }));
    setState(current => ({ noteDraft: current.noteDraft === content ? "" : current.noteDraft, noteDraftQuestionId: current.noteDraft === content ? null : current.noteDraftQuestionId, notes: current.notes.concat(fromSharedNote(note)) }));
  }, [requests, setState]);

  saveQuestionDraftRef.current = saveQuestionDraft;

  const go = useCallback((id: ScreenId, options?: { newMock?: boolean }) => {
    if (stateRef.current.switching || !allowAuthoringNavigation()) return;
    requests.cancelLane("start");
    const update = scopedState("navigation");
    void beforeWorkspaceNavigation().then(saveQuestionDraft).then(() => {
      update((s) => ({ screen: id, more: false,
        pStage: s.pStage,
        mStage: id === "mock" && options?.newMock && s.mStage === "results" ? "setup" : s.mStage,
        lStage: id === "learning" ? "setup" : s.lStage,
        listMode: id === "bookmarks" ? "bm" : id === "wrong" ? "wrong" : s.listMode
      }));
    }).catch(() => update({ actionError: "Navigation was cancelled because your changes could not be saved. Please retry saving." }));
  }, [requests, scopedState, saveQuestionDraft]);

  const openMore = useCallback(() => setState({ more: true }), [setState]);
  const closeMore = useCallback(() => setState({ more: false }), [setState]);

  const switchExam = useCallback(async (id: string | null, questionId?: string): Promise<boolean> => {
    const original = stateRef.current;
    if (original.switching || finishingMock.current) return false;
    if (id === original.examId && !questionId) return true;
    if (id && !original.exams.some(e => e.id === id)) {
      setState({ actionError: "This exam is unavailable. Choose another exam." }); return false;
    }
    if (!allowAuthoringNavigation()) return false;
    if ((original.pStage === "live" || original.mStage === "live" || requests.has("start")) &&
      !window.confirm("Switch study context? Practice answers will be saved and the practice ended. Mock answers will be saved so you can resume; its timer keeps running.")) return false;
    setState({ switching: true, actionError: null });
    try {
      await beforeWorkspaceNavigation();
      await requests.drain();
      await saveQuestionDraft();
      for (const [annotationId, note] of dirtyAnnotations.current) {
        await apiFetch(`/api/annotations/${annotationId}`, { method: "PATCH", body: JSON.stringify({ note: note || null }) });
        if (dirtyAnnotations.current.get(annotationId) === note) dirtyAnnotations.current.delete(annotationId);
      }
      await persistMockDraft();
      const current = stateRef.current;
      if (current.pStage === "live" && current.attemptId) {
        await Promise.all(current.queue
          .filter(qid => !stateRef.current.done[qid] && current.sel[qid]?.length)
          .map(qid => savePracticeAnswer(qid, current.attemptId!, current.sel[qid]!)));
        await apiFetch(`/api/attempts/${current.attemptId}/complete`, { method: "POST" });
      }
      requests.invalidate();
      const next: Partial<AppState> = {};
      // Only exam/session fields reset; account preferences and personal
      // Knowledge Points remain available across exams.
      const keys = ["catalog", "catalogBy", "catalogRevision", "questionContent", "pStage", "source", "diff", "count", "feedback", "tags", "queue", "idx", "sel", "done", "graded", "attemptId",
        "lStage", "lTags", "lDiff", "lStartInput", "lQueue", "lIdx", "lResume", "lDetail", "pendingQuestionJump", "pendingKnowledgePointId",
        "mStage", "mQueue", "mIdx", "mSel", "mFlag", "mLeft", "mockDeadline", "mConfirm", "mockAttemptId", "mockCount", "mockMinutes", "mockResult", "activeMockAttempt",
        "bookmarks", "wrong", "attempted", "mastered", "ai", "anns", "notes", "noteDraft", "noteDraftQuestionId", "tsel", "more"] as const;
      for (const key of keys) Object.assign(next, { [key]: initialState[key] });
      setState(s => ({ ...next, examId: id, screen: questionId ? "learning" : original.screen,
        switching: false, workspaceStatus: id ? "loading" : "empty", workspaceError: null,
        workspaceGeneration: s.workspaceGeneration + 1,
        pendingQuestionJump: id && questionId ? { examId: id, questionId } : null
      }));
      if (original.me) storeExam(original.me.id, id);
      window.getSelection()?.removeAllRanges();
      return true;
    } catch (error) {
      setState({ switching: false, actionError: error instanceof Error ? `Could not switch: ${error.message}. Your work is retained; retry saving or switching.` : "Could not save your work. Please retry before switching." });
      return false;
    }
  }, [requests, setState, saveQuestionDraft, savePracticeAnswer, persistMockDraft]);
  switchExamRef.current = switchExam;
  const setExamId = useCallback((id: string) => switchExam(id), [switchExam]);
  const goToQuestionForReview = useCallback((examId: string, questionId: string) => {
    if (examId === stateRef.current.examId) {
      if (stateRef.current.switching || !allowAuthoringNavigation()) return;
      requests.cancelLane("start");
      const update = scopedState("navigation");
      void beforeWorkspaceNavigation().then(saveQuestionDraft).then(() => {
        update({ screen: "learning", pendingQuestionJump: { examId, questionId } });
      }).catch(() => update({ actionError: "Navigation was cancelled because your changes could not be saved. Please retry saving." }));
      return;
    }
    void switchExam(examId, questionId);
  }, [switchExam, requests, scopedState, saveQuestionDraft]);

  // implementation — open a specific Knowledge Point note from outside the
  // Knowledge Points screen (e.g. Learning Mode's related-notes card).
  // screens/KnowledgePoints.tsx reads and clears pendingKnowledgePointId.
  const openKnowledgePointNote = useCallback((noteId: string) => {
    if (stateRef.current.switching || !allowAuthoringNavigation()) return;
    const update = scopedState("navigation");
    void beforeWorkspaceNavigation().then(saveQuestionDraft).then(() => update({ screen: "knowledgePoints", pendingKnowledgePointId: noteId }))
      .catch(() => update({ actionError: "Could not save your current note. Please retry before leaving." }));
  }, [scopedState, saveQuestionDraft]);
  const clearPendingKnowledgePoint = useCallback(() => setState({ pendingKnowledgePointId: null }), [setState]);

  // Resolve only after the target catalog is ready, including invalid links.
  useEffect(() => {
    const pending = state.pendingQuestionJump;
    if (!pending || state.examId !== pending.examId || state.workspaceStatus !== "ready") return;
    const q = state.catalogBy[pending.questionId];
    if (!q) {
      setState({ pendingQuestionJump: null, actionError: "This linked question is no longer available." });
      return;
    }
    setState({ pendingQuestionJump: null, lTags: [], lDiff: "all" });
    beginLearning(q.sequenceNumber);
  }, [state.pendingQuestionJump, state.examId, state.catalogBy, state.workspaceStatus, setState, beginLearning]);

  const setSource = useCallback((id: PracticeSource) => setState({ source: id }), [setState]);

  // implementation — this SPA has no client-side router (screen is plain state
  // that always initializes to "dash"), so a link from the daily review
  // email (e.g. "?screen=wrong") needs this one-time bridge to land
  // somewhere other than the dashboard. Runs once on mount, then strips the
  // query string so it doesn't re-apply on a later in-app navigation/refresh.
  //
  // Also handles the daily review email's per-question deep link,
  // "/learning/exam?exam=<slug>&question_id=<id>" (served here via
  // wrangler.toml's SPA fallback — see apps/worker/src/lib/emailTemplates/
  // dailyReview.ts). The exam is only known by slug at this point, so it is
  // stashed as pendingSlugQuestionJump for the effect below to resolve once
  // state.exams has loaded.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const screenParam = params.get("screen");
    const sourceParam = params.get("source");
    const isExamDeepLink = window.location.pathname.replace(/\/$/, "") === "/learning/exam";
    const examSlugParam = params.get("exam");
    const questionIdParam = params.get("question_id");
    if (!screenParam && !sourceParam && !(isExamDeepLink && examSlugParam && questionIdParam)) return;

    const knownScreens: ScreenId[] = ["dash", "practice", "mock", "learning", "wrong", "bookmarks", "notes", "knowledgePoints", "settings", "admin"];
    if (screenParam && (knownScreens as string[]).includes(screenParam)) go(screenParam as ScreenId);

    const knownSources: PracticeSource[] = ["all", "new", "wrong", "bm", "focus"];
    if (sourceParam && (knownSources as string[]).includes(sourceParam)) setSource(sourceParam as PracticeSource);

    if (isExamDeepLink && examSlugParam && questionIdParam) {
      setState({ pendingSlugQuestionJump: { examSlug: examSlugParam, questionId: questionIdParam } });
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("screen");
    url.searchParams.delete("source");
    if (isExamDeepLink) {
      url.searchParams.delete("exam");
      url.searchParams.delete("question_id");
      url.pathname = "/";
    }
    window.history.replaceState(null, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolves pendingSlugQuestionJump (set above) once state.exams has
  // loaded: looks up the exam by slug and hands off to
  // goToQuestionForReview, which drives the same catalog-load-then-jump path
  // as the Knowledge Points deep link. An unknown slug (stale/bad link)
  // leaves the pending intent inert rather than erroring, same as
  // goToQuestionForReview's own unknown-question case above.
  useEffect(() => {
    const pending = state.pendingSlugQuestionJump;
    if (!pending || state.exams.length === 0) return;
    const exam = state.exams.find((e) => e.slug === pending.examSlug);
    setState({ pendingSlugQuestionJump: null });
    if (exam) goToQuestionForReview(exam.id, pending.questionId);
  }, [state.pendingSlugQuestionJump, state.exams, setState, goToQuestionForReview]);
  const setDiff = useCallback((id: Difficulty | "all") => setState({ diff: id }), [setState]);
  const setFeedback = useCallback((id: FeedbackMode) => setState({ feedback: id }), [setState]);
  const toggleTag = useCallback((tag: string) => {
    setState((s) => {
      const a = s.tags.slice();
      const i = a.indexOf(tag);
      if (i >= 0) a.splice(i, 1); else a.push(tag);
      return { tags: a };
    });
  }, [setState]);
  const setPracticeTags = useCallback((tags: string[]) => setState({ tags: [...new Set(tags)] }), [setState]);
  const setCount = useCallback((n: number) => setState({ count: n }), [setState]);
  const startPractice = useCallback(() => {
    const p = pool();
    if (!p.length) return;
    const shuffled = p.map((x) => x.id).sort(() => Math.random() - 0.5);
    begin(shuffled.slice(0, Math.min(stateRef.current.count, shuffled.length)));
  }, [pool, begin]);

  // Opens Practice's setup screen with a filter set stated in full. Routed
  // through the same save-drafts-then-navigate path as go(), and it always
  // returns to `pStage: "setup"`: arriving from Statistics must never drop the
  // user into the middle of a previous live session under new filters.
  const openPracticeWithFilters = useCallback((filters: PracticeFilters) => {
    if (stateRef.current.switching || !allowAuthoringNavigation()) return;
    requests.cancelLane("start");
    const update = scopedState("navigation");
    void beforeWorkspaceNavigation().then(saveQuestionDraft).then(() => {
      update({
        screen: "practice", more: false, pStage: "setup",
        source: filters.source, tags: filters.tags.slice(), diff: filters.diff,
        count: Math.max(1, Math.min(MAX_ATTEMPT_QUESTIONS, Math.round(filters.count))),
        queue: [], idx: 0, sel: {}, done: {}, graded: {}, attemptId: null,
      });
    }).catch(() => update({ actionError: "Navigation was cancelled because your changes could not be saved. Please retry saving." }));
  }, [requests, scopedState, saveQuestionDraft]);

  const setListMode = useCallback((m: ListMode) => setState({ listMode: m }), [setState]);
  const removeBookmark = useCallback((id: string) => writeBookmark(id, false), [writeBookmark]);
  const markMastered = useCallback((id: string) => {
    const s = stateRef.current;
    if (s.switching || !s.catalogBy[id] || requests.has(`mastered:${id}`)) return;
    const update = scopedState();
    const previous = !!s.mastered[id];
    setState(current => ({ mastered: { ...current.mastered, [id]: true } }));
    void requests.write(`mastered:${id}`, () => apiFetch(`/api/questions/${id}/wrong-book/mastered`, { method: "PUT" }))
      .catch(() => update(current => ({ mastered: { ...current.mastered, [id]: previous }, actionError: "Could not mark this question mastered. Please retry." })));
  }, [requests, scopedState, setState]);
  const practiceList = useCallback((ids: string[]) => { begin(ids); }, [begin]);

  const setNoteDraft = useCallback((v: string) => setState(s => ({ noteDraft: v,
    noteDraftQuestionId: v ? (s.noteDraftQuestionId ?? (s.screen === "learning" ? s.lQueue[s.lIdx] : s.queue[s.idx]) ?? null) : null
  })), [setState]);
  const setNoteVis = useCallback((v: "private" | "shared") => setState({ noteVis: v }), [setState]);

  // FR-11.1: persist the note server-side first (its id must be real for a
  // later edit/delete — same reasoning as apply() for annotations).
  const addNote = useCallback((qid: string) => {
    const s = stateRef.current;
    const content = s.noteDraft.trim();
    if (!content || s.switching || requests.has("note-draft")) return;
    const update = scopedState();
    void requests.write("note-draft", () => apiFetch<NoteResponse>(`/api/questions/${qid}/notes`, {
      method: "POST", body: JSON.stringify({ content, visibility: s.noteVis })
    })).then(({ note }) => update(current => ({
      notes: current.notes.concat(fromSharedNote(note)), noteDraft: current.noteDraft.trim() === content ? "" : current.noteDraft,
      noteDraftQuestionId: current.noteDraft.trim() === content ? null : current.noteDraftQuestionId
    }))).catch(() => update({ actionError: "Could not save your note. Your draft is retained; please retry." }));
  }, [requests, scopedState]);

  const updateNote = useCallback(async (id: string, content: string, visibility: "private" | "shared") => {
    const update = scopedState();
    await requests.write(`note:${id}`, () => apiFetch(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify({ content, visibility }) }));
    update(s => ({ notes: s.notes.map(n => n.id === id ? { ...n, text: content, vis: visibility } : n) }));
  }, [requests, scopedState]);
  const removeNote = useCallback((id: string) => {
    const update = scopedState();
    void requests.write(`note:${id}`, () => apiFetch(`/api/notes/${id}`, { method: "DELETE" }))
      .then(() => update(s => ({ notes: s.notes.filter(n => n.id !== id) })))
      .catch(() => update({ actionError: "Could not delete this note. Please retry." }));
  }, [requests, scopedState]);

  // FR-11.4: persisted server-side (so it applies from any device/session),
  // then re-fetch notes since the visible set of others' shared notes changes.
  const toggleShared = useCallback(() => {
    const setState = scopedState("toggleShared");
    const examId = stateRef.current.examId;
    const next = !stateRef.current.showShared;
    setState({ showShared: next });
    apiFetch("/api/settings", { method: "PATCH", body: JSON.stringify({ showSharedNotes: next }) })
      .then(() => apiFetch<NotesListResponse>(`/api/notes?examId=${encodeURIComponent(examId ?? "")}`))
      .then(({ notes }) => setState({ notes: notes.map(fromSharedNote) }))
      .catch(() => {});
  }, [scopedState]);

  // implementation — daily review email settings. Not optimistic (unlike
  // toggleShared above): the enabled/source/timing fields are meaningful
  // enough to wait for the server's resolved response, same as
  // updateMarkAlias below.
  const updateEmailSettings = useCallback((patch: UpdateDailyEmailSettingsRequest) => {
    apiFetch<DailyEmailSettingsResponse>("/api/daily-email-settings", { method: "PATCH", body: JSON.stringify(patch) })
      .then((r) => setState({ emailSettings: r }))
      .catch(() => {});
  }, [setState]);

  const capture = useCallback((qid: string, target: AnnotationTarget) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      if (stateRef.current.tsel) setState({ tsel: null });
      return;
    }
    const a = base(sel.anchorNode);
    const f = base(sel.focusNode);
    if (a === null || f === null) return;
    let start = a + sel.anchorOffset;
    let end = f + sel.focusOffset;
    if (start > end) { const t = start; start = end; end = t; }
    if (end - start < 2) return;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setState({ tsel: { qid, target, start, end, x: r.left + r.width / 2, y: r.top - 10 } });
  }, [setState]);

  // FR-8.1: persist the new annotation server-side first (so its id is real,
  // not a client-guessed one) before adding it to local state — mirrors how
  // begin() waits for the server-assigned attemptId.
  const apply = useCallback((style: AnnotationStyle) => {
    const setState = scopedState();
    const t = stateRef.current.tsel;
    if (!t) return;
    setState({ tsel: null });
    const g = window.getSelection();
    if (g) g.removeAllRanges();
    requests.write(`annotation-create:${t.qid}`, () => apiFetch<AnnotationResponse>(`/api/questions/${t.qid}/annotations`, {
      method: "POST",
      body: JSON.stringify(toCreateAnnotationRequest(t.target, t.start, t.end, style, ""))
    })).then(({ annotation }) => {
      setState((s) => ({ anns: s.anns.concat([fromSharedAnnotation(annotation)]) }));
    }).catch(() => {});
  }, [scopedState, requests]);

  // Updates the note text locally on every keystroke (FR-8.2); the PATCH
  // itself is fired on blur (saveMarkNote) rather than per keystroke.
  const setMarkNote = useCallback((id: string, note: string) => {
    dirtyAnnotations.current.set(id, note);
    setState((s) => ({ anns: s.anns.map((x) => (x.id === id ? { ...x, note } : x)) }));
  }, [setState]);
  const saveMarkNote = useCallback((id: string) => {
    const note = stateRef.current.anns.find(x => x.id === id)?.note ?? "";
    const update = scopedState();
    void requests.write(`annotation:${id}`, () => apiFetch(`/api/annotations/${id}`, { method: "PATCH", body: JSON.stringify({ note: note || null }) }))
      .then(() => { if (dirtyAnnotations.current.get(id) === note) dirtyAnnotations.current.delete(id); })
      .catch(() => update({ actionError: "Could not save the annotation note. Please retry before leaving." }));
  }, [requests, scopedState]);
  const removeMark = useCallback((id: string) => {
    const update = scopedState();
    void requests.write(`annotation:${id}`, () => apiFetch(`/api/annotations/${id}`, { method: "DELETE" }))
      .then(() => { dirtyAnnotations.current.delete(id); update(s => ({ anns: s.anns.filter(x => x.id !== id) })); })
      .catch(() => update({ actionError: "Could not delete the annotation. Please retry." }));
  }, [requests, scopedState]);

  // implementation: rename what a mark type means to this user. The server
  // trims/validates and falls back to the previous (or default) alias on
  // empty input, so the response is always the authoritative new state.
  const updateMarkAlias = useCallback((style: MarkStyle, alias: string) => {
    const body: UpdateAnnotationSettingsRequest = { [`${style}Alias`]: alias } as UpdateAnnotationSettingsRequest;
    apiFetch<AnnotationSettingsResponse>("/api/annotation-settings", { method: "PATCH", body: JSON.stringify(body) })
      .then((r) => setState({ markAliases: { hl1: r.hl1Alias, hl2: r.hl2Alias, hl3: r.hl3Alias } }))
      .catch(() => {});
  }, [setState]);

  // Switching provider resets to that provider's first curated model (FR-7.0(c)) —
  // a stale OpenAI model id chosen while on Anthropic would just fail upstream.
  const setProvider = useCallback((p: Provider) => setState({ provider: p, model: CURATED_MODELS[p][0]!.id }), [setState]);
  const setModel = useCallback((m: string) => setState({ model: m }), [setState]);
  // The storage-method choice itself is browser-local (FR-7.9), same
  // treatment as theme: it survives a refresh so "Encrypted in this browser"
  // stays selected without the user re-picking it every visit.
  const setKeyMode = useCallback((m: KeyMode) => {
    storeKeyMode(m);
    setState({ keyMode: m });
  }, [setState]);

  // FR-7.0: loads a key into browser runtime memory for this session (see
  // lib/keyStorage.ts) — optionally also persisted encrypted per FR-7.9,
  // which the Settings screen handles itself before calling this.
  const loadSessionApiKey = useCallback((key: string) => {
    setSessionKey(key);
    setState({ hasSessionKey: true });
  }, [setState]);
  const clearSessionApiKey = useCallback(() => {
    clearSessionKey();
    setState({ hasSessionKey: false });
  }, [setState]);

  // FR-7.9: encrypts and stores the key for next visit, and loads it into
  // this session immediately so it's usable right away.
  const saveEncryptedApiKey = useCallback(async (apiKey: string, passphrase: string) => {
    await saveEncryptedKey(apiKey, passphrase);
    setSessionKey(apiKey);
    setState({ hasStoredKey: true, hasSessionKey: true });
  }, [setState]);

  // Unlocks a previously encrypted key with its passphrase — from Settings,
  // or from an inline prompt next to "Generate explanation" once a refresh
  // (or enough idle time) has dropped the in-memory session key.
  const unlockSessionKey = useCallback(async (passphrase: string) => {
    const key = await loadEncryptedKey(passphrase);
    setSessionKey(key);
    setState({ hasSessionKey: true });
  }, [setState]);

  const forgetStoredApiKey = useCallback(async () => {
    await clearStoredEncryptedKey();
    setState({ hasStoredKey: false });
  }, [setState]);

  // Theme preference is deliberately browser-local: it can be restored before
  // the settings request completes and does not follow the account to a device
  // where the user may prefer a different display treatment.
  const setTheme = useCallback((t: ThemeId) => {
    storeTheme(t);
    setState({ theme: t });
  }, [setState]);

  // FR-12.2: edit one's own display name.
  const updateDisplayName = useCallback((displayName: string) => {
    const trimmed = displayName.trim();
    if (!trimmed) return;
    apiFetch<ProfileResponse>("/api/me", { method: "PATCH", body: JSON.stringify({ displayName: trimmed }) })
      .then(({ user }) => setState({ me: user }))
      .catch(() => {});
  }, [setState]);

  // FR-12.3/FR-12.4: upload a custom avatar. The caller (Settings) is
  // responsible for client-side resize/compression via lib/avatar.ts before
  // calling this — this just does the upload and reconciles state.me.
  const uploadAvatar = useCallback((blob: Blob) => {
    apiFetch<AvatarUploadResponse>("/api/me/avatar", { method: "POST", headers: { "Content-Type": blob.type }, body: blob })
      .then(({ avatarUrl }) => setState((s) => (s.me ? { me: { ...s.me, avatarUrl } } : {})))
      .catch(() => {});
  }, [setState]);

  // Keyboard shortcuts during live practice: number/letter keys pick, Enter checks/advances.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey ||
        (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable=true]")))) return;
      const s = stateRef.current;
      if (s.switching || s.screen !== "practice" || s.pStage !== "live") return;
      const qid = s.queue[s.idx];
      const q = qid ? s.catalogBy[qid] : undefined;
      if (!q || (q.hasContent && !q.content) || !q.options || q.type === "ordering" || q.type === "matching") return;
      const k = e.key.toUpperCase();
      const hit = q.options.find((o) => o.id === k);
      if (hit) { e.preventDefault(); pick(q, hit.id); return; }
      const n = parseInt(e.key, 10);
      const opt = n >= 1 && n <= q.options.length ? q.options[n - 1] : undefined;
      if (opt) { e.preventDefault(); pick(q, opt.id); return; }
      if (e.key === "Enter") { e.preventDefault(); if (s.done[q.id]) next(); else submit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick, next, submit]);

  // Mock exam countdown; auto-submits when time runs out (FR-4.3).
  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
      if (s.mStage !== "live" || s.switching) return;
      const left = Math.max(0, Math.ceil(((s.mockDeadline ?? Date.now()) - Date.now()) / 1000));
      setState({ mLeft: left });
      if (!left && autoSubmittedMock.current !== s.mockAttemptId) {
        autoSubmittedMock.current = s.mockAttemptId;
        finishMock();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [setState, finishMock]);

  const store: PrepDeckStore = {
    state, width, pool, curQ, mockQ, loadQuestionContent, loadLearningDetail,
    go, openMore, closeMore, setExamId, retryWorkspace, dismissActionError,
    setSource, setDiff, setFeedback, toggleTag, setPracticeTags, setCount, startPractice, openPracticeWithFilters,
    begin, pick, submit, next, prevQ, endSession, toggleBookmark, checkAiCache, genAi, useAlternateAi,
    learningPool, learningQ, setLearningStartInput, toggleLearningTag, setLearningDiff,
    beginLearning, learningNext, learningPrev, learningGotoSequence,
    goToQuestionForReview, openKnowledgePointNote, clearPendingKnowledgePoint,
    setMockCount, setMockMinutes, beginMock, mockPick, mockPrev, mockNext, mockGoto, toggleFlag,
    askSubmit, cancelSubmit, finishMock, practiceWrong,
    setListMode, removeBookmark, markMastered, practiceList,
    setNoteDraft, setNoteVis, addNote, updateNote, removeNote, toggleShared, updateEmailSettings,
    capture, apply, setMarkNote, saveMarkNote, removeMark, updateMarkAlias,
    setProvider, setModel, setKeyMode, loadSessionApiKey, clearSessionApiKey,
    saveEncryptedApiKey, unlockSessionKey, forgetStoredApiKey, setTheme,
    updateDisplayName, uploadAvatar
  };

  return <PrepDeckCtx.Provider value={store}>{children}</PrepDeckCtx.Provider>;
}

export function usePrepDeck(): PrepDeckStore {
  const ctx = useContext(PrepDeckCtx);
  if (!ctx) throw new Error("usePrepDeck must be used within a PrepDeckProvider");
  return ctx;
}
