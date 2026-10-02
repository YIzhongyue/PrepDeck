import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { prefetchWindow, type PrefetchMode } from "../lib/questionPrefetch";
import { usePrepDeck } from "../store/PrepDeckContext";

// Issue #106: keeps the next few questions of a live session loading in the
// background while the user reads the open one. It follows the queue position
// rather than each next/prev/goto/resume action, so no way of moving is
// missed, and it waits while the open question is itself still loading so
// that request is never queued behind speculative ones. The store checks
// that when called, after the open question's own request has started; the
// status read here only runs the effect again once that request settles.
export function useQuestionPrefetch(mode: PrefetchMode, queue: readonly string[], index: number) {
  const { state, prefetchQuestions } = usePrepDeck();
  const current = queue[index];
  const status = current ? (mode === "learning" ? state.lDetail[current] : state.questionContent[current])?.status : undefined;
  const currentLoading = status === "loading";
  // A refreshed catalogue drops loaded content, so the window is fetched again.
  const { catalogRevision } = state;
  useEffect(() => {
    if (!currentLoading) prefetchQuestions(mode, prefetchWindow(queue, index), { after: current });
  }, [mode, queue, index, current, currentLoading, catalogRevision, prefetchQuestions]);
}

// A pointer resting on a question that can be jumped to (Mock's palette)
// starts loading it early. Only a hover that lingers counts, so sweeping
// across the palette does not download the exam; a press starts it at once.
const HOVER_INTENT_MS = 150;

export function usePrefetchIntent(mode: PrefetchMode) {
  const { prefetchQuestions } = usePrepDeck();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback((questionId: string) => ({
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => prefetchQuestions(mode, [questionId]), HOVER_INTENT_MS);
    },
    onPointerLeave: () => window.clearTimeout(timer.current),
    onPointerDown: () => {
      window.clearTimeout(timer.current);
      prefetchQuestions(mode, [questionId]);
    },
  }), [mode, prefetchQuestions]);
}
