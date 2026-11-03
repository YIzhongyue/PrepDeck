import type { NoteWithAuthor } from "@prepdeck/shared";
import type { Note } from "../types";

export function fromSharedNote(n: NoteWithAuthor): Note {
  return {
    id: n.id,
    createdAt: n.createdAt,
    qid: n.questionId,
    authorId: n.author.id,
    author: n.author.displayName || "Unknown",
    avatarUrl: n.author.avatarUrl,
    me: n.isMine,
    vis: n.visibility,
    text: n.content
  };
}

/** Match the server's SQLite binary order across interleaved scope pages. */
export function sortNotes(notes: Note[]): Note[] {
  return notes.sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
