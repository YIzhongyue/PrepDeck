// Issue #119 — per-question studied status on the client. "Studied" is
// exposure, not mastery: it is independent of `attempted`, the wrong book and
// bookmarks, and combines with them as one more filter.
import { isStudied, matchesStudyFilter, newerStudyStatus, type QuestionStudyStatusEntry, type StudyStatusFilter } from "@prepdeck/shared";
import { t } from "../i18n/runtime";

type Statuses = Record<string, QuestionStudyStatusEntry>;

// Not "All questions": Practice's source row already has a card of that name.
// The label and description are read in the interface language when shown.
const studyFilter = (id: StudyStatusFilter) => ({
  id,
  get label() { return t(`study.filters.${id}.label`); },
  get desc() { return t(`study.filters.${id}.desc`); },
});

export const STUDY_FILTERS: readonly { id: StudyStatusFilter; readonly label: string; readonly desc: string }[] = [
  studyFilter("all"),
  studyFilter("unstudied"),
  studyFilter("studied"),
];

export function isQuestionStudied(statuses: Statuses, id: string): boolean {
  return isStudied(statuses[id]);
}

export function matchesStudyStatus(filter: StudyStatusFilter, statuses: Statuses, id: string): boolean {
  return matchesStudyFilter(filter, isQuestionStudied(statuses, id));
}

export function studyFilterCounts(questions: readonly { id: string }[], statuses: Statuses): Record<StudyStatusFilter, number> {
  const studied = questions.reduce((n, q) => n + (isQuestionStudied(statuses, q.id) ? 1 : 0), 0);
  return { all: questions.length, studied, unstudied: questions.length - studied };
}

/**
 * The statuses after a fetch: each question keeps whichever entry is newer by
 * revision, so a response that left the server before a local change cannot
 * revert it. Questions in `pending` keep their local (optimistic) entry.
 */
export function mergeStudyStatuses(local: Statuses, fetched: readonly QuestionStudyStatusEntry[], pending: { has(id: string): boolean } = new Set()): Statuses {
  const merged: Statuses = { ...local };
  for (const entry of fetched) {
    if (pending.has(entry.questionId)) continue;
    merged[entry.questionId] = newerStudyStatus(local[entry.questionId], entry);
  }
  return merged;
}
