import { beforeWorkspaceNavigation } from "../../lib/examWorkspace";
import { allowAuthoringNavigation } from "../../lib/questionAuthoring";
import { useCallback } from "react";
import type { StudyStatusFilter } from "@prepdeck/shared";
import { MAX_ATTEMPT_QUESTIONS } from "@prepdeck/shared";
import { apiFetch } from "../../lib/api";
import type { Difficulty } from "../../types";
import type { PracticeSource, PracticeFilters, FeedbackMode, ListMode } from "../appState";
import type { CatalogQueries } from "./useCatalogQueries";
import type { StoreCore } from "./useStoreCore";
import type { Navigation } from "./useNavigation";
import type { PracticeSession } from "./usePracticeSession";

// Practice setup filters, starting sessions from them or from a list, and
// the wrong-question and bookmark lists.
export type PracticeSetup = ReturnType<typeof usePracticeSetup>;

export function usePracticeSetup(core: StoreCore, deps: Pick<PracticeSession, "begin" | "writeBookmark"> & Pick<CatalogQueries, "pool"> & Pick<Navigation, "saveQuestionDraft">) {
  const { requests, scopedState, setState, stateRef } = core;
  const { begin, pool, saveQuestionDraft, writeBookmark } = deps;

  const setSource = useCallback((id: PracticeSource) => setState({ source: id }), [setState]);
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
  const setSkipReview = useCallback((skip: boolean) => setState({ skipReview: skip }), [setState]);
  const setStudyFilter = useCallback((filter: StudyStatusFilter) => setState({ studyFilter: filter }), [setState]);
  const startPractice = useCallback(() => {
    const p = pool();
    if (!p.length) return;
    const shuffled = p.map((x) => x.id).sort(() => Math.random() - 0.5);
    begin(shuffled.slice(0, Math.min(stateRef.current.count, shuffled.length)));
  }, [pool, begin, stateRef]);

  // Opens Practice's setup screen with a filter set stated in full. Routed
  // through the same save-drafts-then-navigate path as go(), and it always
  // returns to `pStage: "setup"`: arriving from Statistics must never drop the
  // user into the middle of a previous live session under new filters.
  const openPracticeWithFilters = useCallback(async (filters: PracticeFilters) => {
    if (stateRef.current.switching || !await allowAuthoringNavigation() || stateRef.current.switching) return;
    requests.cancelLane("start");
    const update = scopedState("navigation");
    void beforeWorkspaceNavigation().then(saveQuestionDraft).then(() => {
      update({
        screen: "practice", more: false, pStage: "setup",
        source: filters.source, tags: filters.tags.slice(), diff: filters.diff, studyFilter: filters.study,
        count: Math.max(1, Math.min(MAX_ATTEMPT_QUESTIONS, Math.round(filters.count))),
        queue: [], idx: 0, sel: {}, done: {}, graded: {}, attemptId: null,
      });
    }).catch(() => update({ actionError: "Navigation was cancelled because your changes could not be saved. Please retry saving." }));
  }, [stateRef, requests, scopedState, saveQuestionDraft]);

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
  }, [requests, scopedState, setState, stateRef]);
  const practiceList = useCallback((ids: string[]) => { begin(ids); }, [begin]);
  return {
    setSource, setDiff, setFeedback, toggleTag, setPracticeTags, setCount, setSkipReview, setStudyFilter,
    startPractice, openPracticeWithFilters, setListMode, removeBookmark, markMastered, practiceList,
  };
}
