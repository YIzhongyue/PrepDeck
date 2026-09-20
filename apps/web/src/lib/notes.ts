import type { NoteWithAuthor } from "@prepdeck/shared";
import type { Note } from "../types";

export function fromSharedNote(n: NoteWithAuthor): Note {
  return {
    id: n.id,
    qid: n.questionId,
    authorId: n.author.id,
    author: n.author.displayName || "Unknown",
    avatarUrl: n.author.avatarUrl,
    me: n.isMine,
    vis: n.visibility,
    text: n.content
  };
}
