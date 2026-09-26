// DTOs for the Question Notes API (docs/requirements/review-notes-and-annotations.md), shared between the
// Worker's responses and the web client's fetch calls.

import type { NoteVisibility } from "./types";

export interface NoteAuthor {
  id: string;
  displayName: string | null; // FR-11.7: a shared note always shows its author
  avatarUrl: string | null;
}

// A note as returned by the API: the raw `notes` row plus enough author
// identity to satisfy FR-11.7, and `isMine` so the client doesn't need to
// compare userId against its own session to decide whether to show
// edit/delete controls (FR-11.3).
export interface NoteWithAuthor {
  id: string;
  userId: string;
  questionId: string;
  content: string;
  visibility: NoteVisibility;
  createdAt: string;
  updatedAt: string;
  author: NoteAuthor;
  isMine: boolean;
}

export interface CreateNoteRequest {
  content: string;
  visibility: NoteVisibility;
}

export interface UpdateNoteRequest {
  content?: string;
  visibility?: NoteVisibility;
}

export interface NoteResponse {
  note: NoteWithAuthor;
}

export interface NotesListResponse {
  notes: NoteWithAuthor[];
}

// Length limits (issue #45), in UTF-16 code units, the unit of a textarea's
// maxLength and of String.length. A shared note is sent to every member who
// shows shared notes, so an unbounded one was paid for by everyone.
export const MAX_NOTE_LENGTH = 10_000;
