import type { WrongEntry } from "../types";

/** The question set advertised by Statistics: unseen or unmastered wrong. */
export function needsFocusedPractice(id: string, state: {
  attempted: Record<string, boolean>;
  wrong: Record<string, WrongEntry>;
  mastered: Record<string, boolean>;
}): boolean {
  return !state.attempted[id] || (!!state.wrong[id] && !state.mastered[id]);
}
