import { hasAnswer } from "@prepdeck/shared";
import type { Question } from "../types";

// The mock screen asks "is this answered?" in three places — the header count,
// the question palette and the submit confirmation — and they used to disagree:
// two counted KEYS in the selection map while the palette counted non-empty
// selections. Deselecting every option on a multiple choice leaves an empty
// array behind (and clearing a fill-in leaves [""]), so the two counters gave
// different answers about the same question in the same render.
//
// Both questions route through `hasAnswer`, the same predicate the Worker
// grades and files wrong answers with, so the count the user is shown before
// submitting is the count the server will act on.

export interface MockAnswerState {
  mQueue: string[];
  mSel: Record<string, string[]>;
  catalogBy: Record<string, Question>;
}

export function isMockAnswered(state: MockAnswerState, questionId: string): boolean {
  // A question missing from the catalog falls back to the choice-based rule.
  // It can only happen mid-exam-switch, when the queue is about to be replaced.
  return hasAnswer(state.catalogBy[questionId]?.type ?? "", state.mSel[questionId] ?? []);
}

export function mockAnsweredCount(state: MockAnswerState): number {
  return state.mQueue.filter((id) => isMockAnswered(state, id)).length;
}
