import { storedExam, storeExam } from "../lib/examWorkspace";
import { isActive } from "../lib/reviewLists";
import { practiceKeyAction } from "../lib/practiceShortcuts";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActiveAttemptResponse,
  AnnotationSettingsResponse,
  AnnotationsListResponse,
  DailyEmailSettingsResponse,
  LearningProgressResponse,
  NotesListResponse,
  PracticeCatalogResponse,
  ProfileResponse,
  StudyStatusListResponse,
  UserSettingsResponse,
} from "@prepdeck/shared";
import { mergeStudyStatuses } from "../lib/studyStatus";
import { defaultMockFormat, officialFormatOf } from "../lib/mockFormat";
import { apiFetch } from "../lib/api";
import { fromSharedAnnotation } from "../lib/annotations";
import { fromSharedNote } from "../lib/notes";
import { hasStoredEncryptedKey } from "../lib/keyStorage";
import { getStoredKeyMode } from "../lib/keyModeStorage";
import { DEFAULT_THEME } from "../lib/themeStorage";
import type { ExamSummary, KeyMode, Question } from "../types";
import { defaultMockCount, defaultMockMinutes } from "./appState";
import { ACTIVATABLE_CONTROLS, browserTimeZone, saveTimeZone, timeZoneSaved } from "./storeHelpers";
import { useStoreCore } from "./actions/useStoreCore";
import { useCatalogQueries } from "./actions/useCatalogQueries";
import { usePracticeSession } from "./actions/usePracticeSession";
import { useAiExplanations } from "./actions/useAiExplanations";
import { useLearningSession } from "./actions/useLearningSession";
import { useMockExam } from "./actions/useMockExam";
import { useNavigation } from "./actions/useNavigation";
import { usePracticeSetup } from "./actions/usePracticeSetup";
import { useQuestionNotes } from "./actions/useQuestionNotes";
import { useAccountSettings } from "./actions/useAccountSettings";
import { useAnnotations } from "./actions/useAnnotations";
import { StoreProviders, useStore, type PrepDeckStore } from "./storeSlices";

export type { AppState, FeedbackMode, ListMode, MockStage, PracticeFilters, PracticeSource, PracticeStage, Provider } from "./appState";
export type { KeyMode };
export type * from "./storeSlices";
export {
  useAccountActions, useAccountState, useAiActions, useAiState, useCatalogActions, useCatalogState,
  useLearningActions, useLearningState, useMockClock, useMockExamActions, useMockExamState, useNoteDraftState,
  useNotesActions, useNotesState, usePracticeActions, usePracticeState, useReviewListsActions, useReviewListsState,
  useSessionStages, useStudyProgressState, useTextSelection, useViewport, useWorkspaceActions, useWorkspaceState,
} from "./storeSlices";


// The provider composes the action hooks in store/actions/ and keeps every
// effect here, in one place and in a fixed order.
export function PrepDeckProvider({ children }: { children: React.ReactNode }) {
  const core = useStoreCore();
  const {
    initialRoute, state, width, height, setViewport, stateRef, requests, pendingStudy, setState, scopedState,
    dismissActionError,
  } = core;
  useEffect(() => () => requests.invalidate(), [requests]);
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setViewport]);

  const [bankRevision, setBankRevision] = useState(0);
  useEffect(() => {
    const changed = () => { setBankRevision(n => n + 1); setState({ lDetail: {}, ai: {} }); };
    window.addEventListener("prepdeck:question-bank-changed", changed);
    return () => window.removeEventListener("prepdeck:question-bank-changed", changed);
  }, [setState]);
  const [examListRevision, setExamListRevision] = useState(0);
  useEffect(() => {
    const changed = () => setExamListRevision(n => n + 1);
    window.addEventListener("prepdeck:exam-list-changed", changed);
    return () => window.removeEventListener("prepdeck:exam-list-changed", changed);
  }, []);

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
        // A link names its exam by slug; it wins over the last exam used.
        const linkedSlug = previous ? null : initialRoute.current?.examSlug ?? null;
        const linked = linkedSlug ? exams.find(e => e.slug === linkedSlug)?.id ?? null : null;
        const saved = previous ?? linked ?? (user ? storedExam(user.id) : null);
        const selected = exams.some(e => e.id === saved) ? saved : exams[0]?.id ?? null;
        setState(s => ({ me: user ?? s.me, exams }));
        if (previous && selected !== previous) {
          setState({ workspaceNotice: "The selected exam is no longer available. Select an available exam to continue." });
          if (!await switchExamRef.current(selected)) setState({ actionError: "This exam is unavailable. Your work is retained; retry saving and switching to an available exam." });
        } else if (!previous) {
          requests.invalidate();
          setState(s => ({ examId: selected, workspaceStatus: selected ? "loading" : "empty",
            workspaceGeneration: s.workspaceGeneration + 1,
            workspaceNotice: linkedSlug && !linked ? "The linked exam is not available to you. Another exam has been opened instead."
              : saved && saved !== selected ? "Your previous exam is unavailable. An available exam has been selected." : null }));
          if (user) storeExam(user.id, selected);
        }
      });
    return () => { cancelled = true; };
  }, [setState, requests, bankRevision, examListRevision, stateRef, initialRoute]);

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
  //
  // Keyed by account (issue #46): another account signed in on the same
  // browser sees neither this account's key nor its storage choice.
  const meId = state.me?.id ?? null;
  useEffect(() => {
    if (!meId) return;
    setState({ keyMode: getStoredKeyMode(meId) ?? "memory" });
    hasStoredEncryptedKey(meId).then((v) => setState({ hasStoredKey: v })).catch(() => {});
  }, [meId, setState]);

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
      .then(({ showSharedNotes, timezone }) => {
        setState({ showShared: showSharedNotes, timeZone: timezone });
        // issue #47: an account that has not chosen a time zone takes this
        // browser's, so its statistics count days where the user is.
        const browserZone = browserTimeZone();
        if (!timezone && browserZone) return saveTimeZone(browserZone).then((saved) => setState(timeZoneSaved(saved)));
      })
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
      apiFetch<NotesListResponse>(`/api/notes?examId=${encodeURIComponent(examId)}`),
      // Not required to open the exam: only the study-status filter needs it.
      apiFetch<StudyStatusListResponse>(`/api/exams/${encodeURIComponent(examId)}/study-status`)
        .then(r => Array.isArray(r?.statuses) ? r.statuses : null, () => null)
    ]).then(([data, { attempt }, { progress }, { annotations }, { notes }, study]) => {
      if (cancelled) return;
      const toQuestion = (q: PracticeCatalogResponse["questions"][number]): Question => ({
        id: q.id, externalId: q.externalId, sequenceNumber: q.sequenceNumber, type: q.type,
        chooseCount: q.chooseCount, tags: q.tags, diff: q.difficulty, stem: q.stem, options: q.options,
        hasContent: q.hasContent, revision: q.revision, content: q.content, needsReview: !!q.needsReview
      });
      // `catalog` is what every new session, count and filter draws from.
      // Archived questions (issues #92/#93) only join `catalogBy`, so an
      // unfinished mock that still holds one can be resumed and answered.
      const catalog: Question[] = data.questions.map(toQuestion);
      const archived: Question[] = (data.archivedQuestions ?? []).map(q => ({ ...toQuestion(q), archived: true }));
      const catalogBy = Object.fromEntries([...archived, ...catalog].map(q => [q.id, q]));
      const count = defaultMockCount(catalog.length);
      update(s => ({ catalog, catalogBy, catalogRevision: s.catalogRevision + 1, questionContent: {}, lDetail: {}, workspaceStatus: "ready", workspaceError: null,
        bookmarks: Object.fromEntries(data.bookmarkedIds.filter(id => isActive(catalogBy, id)).map(id => [id, true])),
        wrong: Object.fromEntries(data.wrongEntries.filter(e => isActive(catalogBy, e.questionId)).map(e => [e.questionId, { c: e.wrongCount, at: e.lastWrongAt }])),
        mastered: {}, attempted: Object.fromEntries(data.attemptedIds.map(id => [id, true])),
        // A refresh started before a status change must not revert it.
        studyStatus: study ? mergeStudyStatuses(s.studyStatus, study, pendingStudy.current) : s.studyStatus,
        studyStatusError: !study,
        mockFormat: defaultMockFormat(officialFormatOf(s.exams, s.examId)), mockCount: count, mockMinutes: defaultMockMinutes(count), activeMockAttempt: attempt,
        lResume: progress.lastSequenceNumber, anns: annotations.map(fromSharedAnnotation), notes: notes.map(fromSharedNote)
      }));
    }).catch(() => {
      if (!cancelled) update(s => s.workspaceStatus === "ready"
        ? { actionError: "Could not refresh this exam. Your current work is retained; please retry." }
        : { workspaceStatus: "error", workspaceError: "Could not load this exam. Please retry." });
    });
    return () => { cancelled = true; };
  }, [state.examId, state.workspaceGeneration, scopedState, setState, bankRevision, pendingStudy]);
  const retryWorkspace = useCallback(() => setBankRevision(n => n + 1), []);

  const { applyStudyStatus, refreshStudyStatuses, pool, curQ, mockQ, loadQuestionContent } = useCatalogQueries(core);

  const {
    begin, pick, savePracticeAnswer, submit, saveQuestionDraftRef, navigateQuestion, endSession, next,
    prevQ, writeBookmark, toggleBookmark,
  } = usePracticeSession(core, { applyStudyStatus });

  const { checkAiCache, genAi, showAlternateAi } = useAiExplanations(core);

  const {
    learningPool, learningQ, setLearningStartInput, setLearningDiff, setLearningSkipReview,
    setLearningStudyFilter, toggleLearningTag, clearLearningTags, loadLearningDetail, prefetchQuestions,
    beginLearning, learningNext, learningPrev, learningGotoSequence, markLearningViewed,
    setQuestionStudied,
  } = useLearningSession(core, { applyStudyStatus, checkAiCache, loadQuestionContent, navigateQuestion });

  const {
    setMockFormat, setMockCount, setMockMinutes, setMockSkipReview, beginMock, mockPick, mockPrev,
    mockNext, mockGoto, toggleFlag, askSubmit, cancelSubmit, persistMockDraft, finishingMock,
    autoSubmittedMock, finishMock,
  } = useMockExam(core, { applyStudyStatus, refreshStudyStatuses });

  const {
    practiceWrong, saveQuestionDraft, go, openMore, closeMore, switchExam, setExamId,
    goToQuestionForReview, openKnowledgePointNote, showKnowledgePoint, navigateTo,
  } = useNavigation(core, { begin, finishingMock, persistMockDraft, savePracticeAnswer, saveQuestionDraftRef });
  switchExamRef.current = switchExam;

  // Resolve only after the target catalog is ready, including invalid links.
  useEffect(() => {
    const pending = state.pendingQuestionJump;
    if (!pending || state.examId !== pending.examId || state.workspaceStatus !== "ready") return;
    const q = state.catalogBy[pending.questionId];
    if (!q || q.archived) {
      setState({ pendingQuestionJump: null, actionError: "This linked question is no longer available." });
      return;
    }
    setState({ pendingQuestionJump: null, lTags: [], lDiff: "all", lSkipReview: false, lStudyFilter: "all" });
    beginLearning(q.sequenceNumber);
  }, [state.pendingQuestionJump, state.examId, state.catalogBy, state.workspaceStatus, setState, beginLearning]);

  // issue #41: a Learning position from the URL. Inside the running session it
  // is a move within its queue; otherwise Learning starts there unfiltered,
  // as a linked question does. A number the exam does not have opens setup.
  useEffect(() => {
    const seq = state.pendingLearningSequence;
    if (seq == null || state.screen !== "learning" || state.workspaceStatus !== "ready" || state.switching) return;
    const s = stateRef.current;
    setState({ pendingLearningSequence: null });
    if (s.lStage === "live" && s.lQueue.some(id => s.catalogBy[id]?.sequenceNumber === seq)) {
      learningGotoSequence(seq);
    } else if (s.catalog.some(q => q.sequenceNumber === seq)) {
      setState({ lTags: [], lDiff: "all", lSkipReview: false, lStudyFilter: "all" });
      beginLearning(seq);
    } else {
      setState({ lStage: "setup", actionError: `This exam has no question ${seq}.` });
    }
  }, [state.pendingLearningSequence, state.screen, state.workspaceStatus, state.switching, setState, beginLearning, learningGotoSequence, stateRef]);

  const {
    setSource, setDiff, setFeedback, toggleTag, setPracticeTags, setCount, setSkipReview, setStudyFilter,
    startPractice, openPracticeWithFilters, setListMode, removeBookmark, markMastered, practiceList,
  } = usePracticeSetup(core, { begin, pool, saveQuestionDraft, writeBookmark });

  // The daily review email's links predate routing: "?screen=wrong" and
  // "/learning/exam?exam=<slug>&question_id=<id>" (apps/worker/src/lib/
  // emailTemplates/dailyReview.ts). stateForInitialRoute reads them like any
  // other URL; the question, known only by exam slug and id, is resolved below
  // and the address then becomes the question's own (store/urlRouting.ts).
  //
  // Resolves pendingSlugQuestionJump (set on load) once state.exams has
  // loaded: looks up the exam by slug and hands off to
  // goToQuestionForReview, which drives the same catalog-load-then-jump path
  // as the Knowledge Points deep link. An unknown slug (stale/bad link)
  // leaves the pending intent inert rather than erroring, same as
  // goToQuestionForReview's own unknown-question case above.
  useEffect(() => {
    const pending = state.pendingSlugQuestionJump;
    if (!pending || state.exams.length === 0) return;
    const exam = state.exams.find((e) => e.slug === pending.examSlug);
    // Already in that exam (the link chose it on load): nothing to save, so the
    // jump is set at once, and the address goes straight to the question.
    if (exam && exam.id === stateRef.current.examId) {
      setState({ pendingSlugQuestionJump: null, screen: "learning", pendingQuestionJump: { examId: exam.id, questionId: pending.questionId } });
      return;
    }
    setState({ pendingSlugQuestionJump: null });
    if (exam) goToQuestionForReview(exam.id, pending.questionId);
  }, [state.pendingSlugQuestionJump, state.exams, setState, goToQuestionForReview, stateRef]);

  const { setNoteDraft, setNoteVis, addNote, updateNote, removeNote, toggleShared } = useQuestionNotes(core);

  const {
    updateTimeZone, updateEmailSettings, setProvider, setModel, setKeyMode, loadSessionApiKey,
    clearSessionApiKey, saveEncryptedApiKey, unlockSessionKey, forgetStoredApiKey, signOut, setTheme,
    updateDisplayName, uploadAvatar, preserveForReauth,
  } = useAccountSettings(core);

  const { capture, apply, setMarkNote, saveMarkNote, removeMark, updateMarkAlias } = useAnnotations(core);

  // Keyboard shortcuts during live practice. What each key does is decided by
  // lib/practiceShortcuts, which the shortcut panel lists from as well.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A control that already handled the key (an option row toggling itself)
      // has the last word, and held keys must not check and then skip past the
      // feedback they just produced.
      if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable=true]"))) return;
      // Enter on a focused button or link belongs to that control. Taking it
      // here would also cancel the control's own click.
      if (e.key === "Enter" && target?.closest(ACTIVATABLE_CONTROLS)) return;
      const s = stateRef.current;
      if (s.switching || s.screen !== "practice" || s.pStage !== "live") return;
      const qid = s.queue[s.idx];
      const q = qid ? s.catalogBy[qid] : undefined;
      if (!q) return;
      const action = practiceKeyAction(e, q, { graded: !!s.done[q.id], chosen: s.sel[q.id] ?? [] });
      if (!action) return;
      e.preventDefault();
      if (action.kind === "pick") pick(q, action.optionId);
      else if (action.kind === "check") submit();
      else if (action.kind === "next") next();
      else writeBookmark(q.id, !s.bookmarks[q.id]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick, next, submit, writeBookmark, stateRef]);

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
  }, [setState, finishMock, stateRef, autoSubmittedMock]);

  const store: PrepDeckStore = {
    state, width, height, pool, curQ, mockQ, loadQuestionContent, loadLearningDetail, prefetchQuestions,
    go, openMore, closeMore, setExamId, retryWorkspace, dismissActionError,
    setSource, setDiff, setFeedback, toggleTag, setPracticeTags, setCount, setSkipReview, setStudyFilter, startPractice, openPracticeWithFilters,
    begin, pick, submit, next, prevQ, endSession, toggleBookmark, checkAiCache, genAi, showAlternateAi,
    learningPool, learningQ, setLearningStartInput, toggleLearningTag, clearLearningTags, setLearningDiff, setLearningSkipReview, setLearningStudyFilter,
    beginLearning, learningNext, learningPrev, learningGotoSequence, markLearningViewed, setQuestionStudied,
    goToQuestionForReview, openKnowledgePointNote, showKnowledgePoint, navigateTo,
    setMockFormat, setMockCount, setMockMinutes, setMockSkipReview, beginMock, mockPick, mockPrev, mockNext, mockGoto, toggleFlag,
    askSubmit, cancelSubmit, finishMock, practiceWrong,
    setListMode, removeBookmark, markMastered, practiceList,
    setNoteDraft, setNoteVis, addNote, updateNote, removeNote, toggleShared, updateTimeZone, updateEmailSettings,
    capture, apply, setMarkNote, saveMarkNote, removeMark, updateMarkAlias,
    setProvider, setModel, setKeyMode, loadSessionApiKey, clearSessionApiKey,
    saveEncryptedApiKey, unlockSessionKey, forgetStoredApiKey, signOut, setTheme,
    updateDisplayName, uploadAvatar, preserveForReauth
  };

  return <StoreProviders store={store}>{children}</StoreProviders>;
}

/**
 * The whole store, which renders on every state change. Screens and
 * components read the slice hooks below instead; this stays for the browser
 * fixtures, which drive the store through it.
 */
export function usePrepDeck(): PrepDeckStore {
  return useStore();
}
