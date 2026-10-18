import { useCallback } from "react";
import type {
  LearningQuestionDetailResponse,
  QuestionStudyStatusEntry,
  StudyStatusFilter,
  StudyStatusMutationResponse,
} from "@prepdeck/shared";
import { isQuestionStudied, matchesStudyStatus } from "../../lib/studyStatus";
import { apiFetch } from "../../lib/api";
import { learningDetailCache, type PrefetchMode } from "../../lib/questionPrefetch";
import type { Difficulty, Question } from "../../types";
import { type LoadOptions, without } from "../storeHelpers";
import type { AiExplanations } from "./useAiExplanations";
import type { CatalogQueries } from "./useCatalogQueries";
import type { StoreCore } from "./useStoreCore";
import type { PracticeSession } from "./usePracticeSession";

// Learning Mode: setup filters, the sequential read-through, its saved
// position, and per-question studied status.
export type LearningSession = ReturnType<typeof useLearningSession>;

export function useLearningSession(core: StoreCore, deps: Pick<CatalogQueries, "applyStudyStatus" | "loadQuestionContent"> & Pick<AiExplanations, "checkAiCache"> & Pick<PracticeSession, "navigateQuestion">) {
  const { learningVisit, pendingStudy, requests, scopedState, setState, state, stateRef } = core;
  const { applyStudyStatus, checkAiCache, loadQuestionContent, navigateQuestion } = deps;

  // docs/requirements/practice-and-learning-modes.md — Learning Mode. FR-14.2: same tag/difficulty filters as
  // Practice, kept in their own lTags/lDiff (not shared with state.tags/diff)
  // so switching between Practice and Learning doesn't cross-contaminate
  // filter choices. Sorted by sequenceNumber (FR-14.1) — when a filter is
  // active, this sorted-and-filtered array's own order *is* the "sequence
  // order" per FR-14.2, while each question's real sequenceNumber (stable
  // across filter changes) is still what "start from #N" and resume (FR-14.9)
  // are keyed on.
  const learningPool = useCallback((options?: { study?: StudyStatusFilter }): Question[] => {
    const s = stateRef.current;
    const study = options?.study ?? s.lStudyFilter;
    return s.catalog
      .filter((q) => {
        if (s.lDiff !== "all" && q.diff !== s.lDiff) return false;
        if (s.lTags.length && !q.tags.some((t) => s.lTags.indexOf(t) >= 0)) return false;
        if (s.lSkipReview && q.needsReview) return false;
        if (!matchesStudyStatus(study, s.studyStatus, q.id)) return false;
        return true;
      })
      .slice()
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }, [stateRef]);

  const learningQ = useCallback((): Question | undefined => {
    const id = state.lQueue[state.lIdx];
    return id ? state.catalogBy[id] : undefined;
  }, [state.lQueue, state.lIdx, state.catalogBy]);

  const setLearningStartInput = useCallback((n: number) => setState({ lStartInput: n }), [setState]);
  const setLearningDiff = useCallback((id: Difficulty | "all") => setState({ lDiff: id }), [setState]);
  const setLearningSkipReview = useCallback((skip: boolean) => setState({ lSkipReview: skip }), [setState]);
  const setLearningStudyFilter = useCallback((filter: StudyStatusFilter) => setState({ lStudyFilter: filter }), [setState]);
  const toggleLearningTag = useCallback((tag: string) => {
    setState((s) => {
      const a = s.lTags.slice();
      const i = a.indexOf(tag);
      if (i >= 0) a.splice(i, 1); else a.push(tag);
      return { lTags: a };
    });
  }, [setState]);
  const clearLearningTags = useCallback(() => setState({ lTags: [] }), [setState]);

  // FR-14.3/FR-14.4: fetches the answer-key'd question plus this user's own
  // answer history — unlike Practice's graded state, this is loaded as soon
  // as a question is viewed, with no reveal step. A detail already loaded for
  // this question revision and answer history is shown again as it is, so a
  // prefetched one is not requested a second time (issue #106); once it is
  // older than LEARNING_DETAIL_TTL_MS it is still shown, and refreshed behind it.
  const loadLearningDetail = useCallback((qid: string, { prefetch = false }: LoadOptions = {}) => {
    const { catalogBy, catalogRevision, activityRevision, lDetail } = stateRef.current;
    const requested = catalogBy[qid];
    if (!requested) return;
    const existing = lDetail[qid];
    const cache = learningDetailCache(existing, requested, activityRevision, Date.now());
    if (existing?.status === "loading" || (prefetch && existing?.status === "error") || cache === "fresh"
      || (cache === "stale" && existing?.refreshing)) return;
    const refresh = cache === "stale";
    const setState = scopedState("loadLearningDetail" + qid);
    setState((s) => ({ lDetail: { ...s.lDetail, [qid]: refresh ? { ...s.lDetail[qid]!, refreshing: true } : { status: "loading" } } }));
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
            [qid]: { status: "ready", correctAnswers: question.correctAnswers, explanation: question.explanation, history, answerRevision: question.answerRevision, answerRevisedAt: question.answerRevisedAt,
              questionRevision: requested.revision, activityRevision, loadedAt: Date.now() }
          }
        };
      });
    }).catch((err) => {
      setState((s) => {
        if (s.catalogRevision !== catalogRevision || !s.catalogBy[qid]) return {};
        // A failed refresh keeps showing the detail it was refreshing.
        if (refresh) {
          const current = s.lDetail[qid];
          return current?.status === "ready" ? { lDetail: { ...s.lDetail, [qid]: { ...current, refreshing: false } } } : {};
        }
        return prefetch ? { lDetail: without(s.lDetail, qid) } : {
          lDetail: { ...s.lDetail, [qid]: { status: "error", error: err instanceof Error ? err.message : "Could not load this question." } }
        };
      });
    });
  }, [scopedState, stateRef]);

  // Issue #106: Practice and Mock prefetch only the answer-key-free component
  // snapshot (loadQuestionContent); only Learning, which shows the answer
  // anyway, prefetches learning-detail.
  const prefetchQuestions = useCallback((mode: PrefetchMode, questionIds: readonly string[], { after }: { after?: string } = {}) => {
    const s = stateRef.current;
    if (after && (mode === "learning" ? s.lDetail[after] : s.questionContent[after])?.status === "loading") return;
    for (const qid of questionIds) {
      if (mode === "learning") loadLearningDetail(qid, { prefetch: true });
      else loadQuestionContent(qid, { prefetch: true });
    }
  }, [loadLearningDetail, loadQuestionContent, stateRef]);

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
  }, [stateRef, setState, scopedState, requests]);

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
      // Moving to the question already shown is not a new visit (issue #119).
      setState(cur => ({ lIdx: clamped, lVisit: cur.lQueue[cur.lIdx] === qid ? cur.lVisit : cur.lVisit + 1 }));
      if (q) { loadLearningDetail(q.id); checkAiCache(q); saveLearningProgress(q.sequenceNumber); }
    });
  }, [stateRef, navigateQuestion, setState, loadLearningDetail, checkAiCache, saveLearningProgress]);

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
    // The session's queue is fixed here: marking questions studied as they are
    // shown never removes one from an "Unstudied only" session.
    setState(cur => ({ screen: "learning", lStage: "live", lQueue: ids, lIdx: idx, lVisit: cur.lVisit + 1 }));
    const q = list[idx]!;
    loadLearningDetail(q.id);
    checkAiCache(q);
    saveLearningProgress(q.sequenceNumber);
  }, [stateRef, learningPool, setState, loadLearningDetail, checkAiCache, saveLearningProgress]);

  const learningNext = useCallback(() => advanceLearningTo(stateRef.current.lIdx + 1), [advanceLearningTo, stateRef]);

  const learningPrev = useCallback(() => advanceLearningTo(stateRef.current.lIdx - 1), [advanceLearningTo, stateRef]);

  // FR-14.8: jump directly to a different sequence number, within the
  // current (possibly filtered) queue.
  const learningGotoSequence = useCallback((seq: number) => {
    const s = stateRef.current;
    let idx = s.lQueue.findIndex((id) => (s.catalogBy[id]?.sequenceNumber ?? 0) >= seq);
    if (idx < 0) idx = s.lQueue.length - 1;
    advanceLearningTo(idx);
  }, [advanceLearningTo, stateRef]);

  // Issue #119: the automatic mark, once per visit. The server applies it only
  // against the revision this client last saw, so a mark delayed past a reset
  // cannot undo it; writes per question are serialized, so a reset made here
  // always reaches the server after this visit's mark.
  const markLearningViewed = useCallback((qid: string) => {
    const s = stateRef.current;
    const examId = s.examId;
    if (!examId || s.switching || s.lStage !== "live" || s.lQueue[s.lIdx] !== qid) return;
    const seen = learningVisit.current;
    if (seen && seen.visit === s.lVisit && seen.qid === qid) return;
    const visit = { visit: s.lVisit, qid, manual: false };
    learningVisit.current = visit;
    if (isQuestionStudied(s.studyStatus, qid) || pendingStudy.current.has(qid)) return;
    const update = scopedState();
    const send = (expectedRevision: number, retry: boolean): Promise<void> => requests.write(`study:${qid}`, () =>
      apiFetch<StudyStatusMutationResponse>(`/api/exams/${encodeURIComponent(examId)}/study-status/${encodeURIComponent(qid)}/learning-view`, {
        method: "POST", body: JSON.stringify({ expectedRevision })
      })).then(({ applied, status }) => {
        applyStudyStatus(update, status);
        // Refused because the status changed elsewhere since this exam loaded.
        // If the question is still on screen in this visit and was not reset
        // here, this is a later visit than that change: mark it once more.
        if (!applied && retry && status.status === "unstudied" && learningVisit.current === visit && !visit.manual) return send(status.revision, false);
      });
    // A failed mark leaves the question unstudied; the next visit tries again.
    send(s.studyStatus[qid]?.revision ?? 0, true).catch(() => {});
  }, [stateRef, learningVisit, pendingStudy, scopedState, requests, applyStudyStatus]);

  const setQuestionStudied = useCallback((qid: string, studied: boolean) => {
    const s = stateRef.current;
    const examId = s.examId;
    if (!examId || s.switching || !s.catalogBy[qid]) return;
    // A choice made while the question is shown is final for this visit.
    if (learningVisit.current?.qid === qid) learningVisit.current.manual = true;
    const status = studied ? "studied" : "unstudied";
    const previous = s.studyStatus[qid];
    const optimistic: QuestionStudyStatusEntry = { questionId: qid, status, revision: previous?.revision ?? 0, updatedAt: previous?.updatedAt ?? null };
    pendingStudy.current.set(qid, (pendingStudy.current.get(qid) ?? 0) + 1);
    setState(cur => ({ studyStatus: { ...cur.studyStatus, [qid]: optimistic } }));
    const update = scopedState();
    const settle = () => {
      const left = (pendingStudy.current.get(qid) ?? 1) - 1;
      if (left > 0) pendingStudy.current.set(qid, left); else pendingStudy.current.delete(qid);
      return left === 0;
    };
    requests.write(`study:${qid}`, () => apiFetch<StudyStatusMutationResponse>(`/api/exams/${encodeURIComponent(examId)}/study-status/${encodeURIComponent(qid)}`, {
      method: "PUT", body: JSON.stringify({ status })
    })).then(({ status: entry }) => {
      // Only the last of several quick toggles decides what is shown.
      if (settle()) applyStudyStatus(update, entry, true);
    }, () => {
      const last = settle();
      update(cur => ({
        actionError: "Could not save this question's study status. Please retry.",
        ...(last && cur.studyStatus[qid] === optimistic
          ? { studyStatus: previous ? { ...cur.studyStatus, [qid]: previous } : without(cur.studyStatus, qid) }
          : {})
      }));
    });
  }, [stateRef, learningVisit, pendingStudy, setState, scopedState, requests, applyStudyStatus]);
  return {
    learningPool, learningQ, setLearningStartInput, setLearningDiff, setLearningSkipReview,
    setLearningStudyFilter, toggleLearningTag, clearLearningTags, loadLearningDetail, prefetchQuestions,
    beginLearning, learningNext, learningPrev, learningGotoSequence, markLearningViewed,
    setQuestionStudied,
  };
}
