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
    !!state.catalogBy[id] && (source === "bm" ? state.bookmarks[id] : !state.mastered[id])
  );
}

export function catalogQuestionIds(ids: string[], catalogBy: Record<string, Question>): string[] {
  return [...new Set(ids)].filter(id => !!catalogBy[id]);
}
