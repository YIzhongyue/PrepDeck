import type { Question, WrongEntry } from "../types";

type ReviewState = {
  catalogBy: Record<string, Question>;
  bookmarks: Record<string, boolean>;
  wrong: Record<string, WrongEntry>;
  mastered: Record<string, boolean>;
};

// Counts, rendered cards and practice inputs must use the same active catalog.
export function reviewIds(state: ReviewState, source: "bm" | "wrong"): string[] {
  return Object.keys(source === "bm" ? state.bookmarks : state.wrong).filter(id =>
    isActive(state.catalogBy, id) && (source === "bm" ? state.bookmarks[id] : !state.mastered[id])
  );
}

// catalogBy also resolves archived questions an unfinished attempt still
// holds; only active ones may start a session (the API refuses the rest).
export function isActive(catalogBy: Record<string, Question>, id: string): boolean {
  return !!catalogBy[id] && !catalogBy[id].archived;
}

export function catalogQuestionIds(ids: string[], catalogBy: Record<string, Question>): string[] {
  return [...new Set(ids)].filter(id => isActive(catalogBy, id));
}
