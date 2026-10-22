import { needsFocusedPractice } from "../../lib/practiceEligibility";
import { useCallback } from "react";
import type {
  PracticeQuestionContentResponse,
  QuestionStudyStatusEntry,
  StudyStatusFilter,
  StudyStatusListResponse,
} from "@prepdeck/shared";
import { newerStudyStatus } from "@prepdeck/shared";
import { matchesStudyStatus, mergeStudyStatuses } from "../../lib/studyStatus";
import { apiFetch } from "../../lib/api";
import type { Question } from "../../types";
import type { Patch } from "../appState";
import { type LoadOptions, without } from "../storeHelpers";
import type { StoreCore } from "./useStoreCore";
import { t } from "../../i18n/runtime";

// Reads over the loaded catalog (practice pool, current question) and the
// question content and study-status loaders they rely on.
export type CatalogQueries = ReturnType<typeof useCatalogQueries>;

export function useCatalogQueries(core: StoreCore) {
  const { pendingStudy, scopedState, state, stateRef } = core;

  // Issue #119: keeps the newer of the local and the server's entry. `update`
  // is the caller's scoped setter, so a reply for a previous exam is dropped.
  const applyStudyStatus = useCallback((update: (patch: Patch) => void, entry: QuestionStudyStatusEntry, manual = false) => update(s => {
    if (!manual && pendingStudy.current.has(entry.questionId)) return {};
    const current = s.studyStatus[entry.questionId];
    const next = newerStudyStatus(current, entry);
    return next === current ? {} : { studyStatus: { ...s.studyStatus, [entry.questionId]: next } };
  }), [pendingStudy]);
  const refreshStudyStatuses = useCallback(() => {
    const examId = stateRef.current.examId;
    if (!examId) return;
    const update = scopedState();
    apiFetch<StudyStatusListResponse>(`/api/exams/${encodeURIComponent(examId)}/study-status`)
      .then(({ statuses }) => { if (Array.isArray(statuses)) update(s => ({ studyStatus: mergeStudyStatuses(s.studyStatus, statuses, pendingStudy.current), studyStatusError: false })); })
      // Only the setup screens' counts lag; the next exam load corrects them.
      .catch(() => {});
  }, [pendingStudy, scopedState, stateRef]);

  const pool = useCallback((options?: { study?: StudyStatusFilter }): Question[] => {
    const s = stateRef.current;
    const study = options?.study ?? s.studyFilter;
    return s.catalog.filter((q) => {
      if (s.source === "wrong" && (!s.wrong[q.id] || s.mastered[q.id])) return false;
      if (s.source === "bm" && !s.bookmarks[q.id]) return false;
      if (s.source === "new" && s.attempted[q.id]) return false;
      if (s.source === "focus" && !needsFocusedPractice(q.id, s)) return false;
      if (s.diff !== "all" && q.diff !== s.diff) return false;
      if (s.tags.length && !q.tags.some((t) => s.tags.indexOf(t) >= 0)) return false;
      if (s.skipReview && q.needsReview) return false;
      if (!matchesStudyStatus(study, s.studyStatus, q.id)) return false;
      return true;
    });
  }, [stateRef]);

  const curQ = useCallback((): Question | undefined => {
    const id = state.queue[state.idx];
    return id ? state.catalogBy[id] : undefined;
  }, [state.queue, state.idx, state.catalogBy]);
  const mockQ = useCallback((): Question | undefined => {
    const id = state.mQueue[state.mIdx];
    return id ? state.catalogBy[id] : undefined;
  }, [state.mQueue, state.mIdx, state.catalogBy]);

  const loadQuestionContent = useCallback((qid: string, { prefetch = false }: LoadOptions = {}) => {
    const { examId, catalogBy, catalogRevision, questionContent } = stateRef.current;
    const requested = catalogBy[qid];
    const existing = questionContent[qid]?.status;
    if (!examId || !requested?.hasContent || requested.content || existing === "loading" || (prefetch && existing === "error")) return;
    const update = scopedState(`questionContent:${qid}`);
    update(s => ({ questionContent: { ...s.questionContent, [qid]: { status: "loading" } } }));
    apiFetch<PracticeQuestionContentResponse>(`/api/exams/${encodeURIComponent(examId)}/practice-catalog/${encodeURIComponent(qid)}`, { cache: "no-store" })
      .then(({ content, revision }) => {
        if (!content || (requested.revision !== undefined && requested.revision !== revision)) {
          throw new Error(t("errors.question.changed"));
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
      }).catch(error => update(s => s.catalogRevision !== catalogRevision || !s.catalogBy[qid] ? {} : prefetch
        ? { questionContent: without(s.questionContent, qid) }
        : { questionContent: { ...s.questionContent, [qid]: { status: "error", error: error instanceof Error ? error.message : t("study.gate.loadFailed") } } }));
  }, [scopedState, stateRef]);

  return { applyStudyStatus, refreshStudyStatuses, pool, curQ, mockQ, loadQuestionContent };
}
