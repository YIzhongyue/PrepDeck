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

// How long a Learning detail counts as current. Answers recorded in another
// tab or on another device never reach this tab's activityRevision, so an
// older detail is still shown at once but refreshed in the background.
export const LEARNING_DETAIL_TTL_MS = 2 * 60_000;

/**
 * What a Learning detail already in hand is worth: "missing" must be fetched
 * before it is shown; "fresh" is shown as it is; "stale" is shown and
 * refreshed. Only a detail loaded for this revision of the question, with no
 * newer answers from this tab and with any component content, counts at all.
 */
export function learningDetailCache(
  detail: LearningDetail | undefined, question: Question, activityRevision: number, now: number
): "missing" | "fresh" | "stale" {
  if (detail?.status !== "ready"
    || detail.questionRevision !== question.revision
    || detail.activityRevision !== activityRevision
    || (question.hasContent && !question.content)) return "missing";
  return now - (detail.loadedAt ?? 0) < LEARNING_DETAIL_TTL_MS ? "fresh" : "stale";
}
