import type { LearningDetail, Question } from "../types";

// Issue #106: how many questions past the open one Learning, Practice and Mock
// fetch in the background, so Next usually lands on a hydrated question. A
// small sliding window, never the whole session.
export const QUESTION_PREFETCH_AHEAD = 3;

export type PrefetchMode = "learning" | "practice" | "mock";

/** The ids after `index` in `queue` worth fetching ahead of the user. */
export function prefetchWindow(queue: readonly string[], index: number, ahead = QUESTION_PREFETCH_AHEAD): string[] {
  if (index < 0 || ahead <= 0) return [];
  return queue.slice(index + 1, index + 1 + ahead);
}

/**
 * Whether a Learning detail already in hand can be shown again instead of
 * fetched: it was loaded for this revision of the question, before no newer
 * answers changed the user's history, and it carried any component content.
 */
export function learningDetailReusable(detail: LearningDetail | undefined, question: Question, activityRevision: number): boolean {
  return detail?.status === "ready"
    && detail.questionRevision === question.revision
    && detail.activityRevision === activityRevision
    && (!question.hasContent || !!question.content);
}
