import { useCallback } from "react";
import type { NoteResponse, NotesListResponse } from "@prepdeck/shared";
import { apiFetch } from "../../lib/api";
import { fromSharedNote } from "../../lib/notes";
import type { StoreCore } from "./useStoreCore";

// Personal and shared question notes.
export type QuestionNotes = ReturnType<typeof useQuestionNotes>;

export function useQuestionNotes(core: StoreCore) {
  const { requests, scopedState, setState, stateRef } = core;

  const setNoteDraft = useCallback((v: string) => setState(s => ({ noteDraft: v,
    noteDraftQuestionId: v ? (s.noteDraftQuestionId ?? (s.screen === "learning" ? s.lQueue[s.lIdx] : s.queue[s.idx]) ?? null) : null
  })), [setState]);
  const setNoteVis = useCallback((v: "private" | "shared") => setState({ noteVis: v }), [setState]);

  // FR-11.1: persist the note server-side first (its id must be real for a
  // later edit/delete — same reasoning as apply() for annotations).
  const addNote = useCallback((qid: string) => {
    const s = stateRef.current;
    const content = s.noteDraft.trim();
    if (!content || s.switching || requests.has("note-draft")) return;
    const update = scopedState();
    void requests.write("note-draft", () => apiFetch<NoteResponse>(`/api/questions/${qid}/notes`, {
      method: "POST", body: JSON.stringify({ content, visibility: s.noteVis })
    })).then(({ note }) => update(current => ({
      notes: current.notes.concat(fromSharedNote(note)), noteDraft: current.noteDraft.trim() === content ? "" : current.noteDraft,
      noteDraftQuestionId: current.noteDraft.trim() === content ? null : current.noteDraftQuestionId
    }))).catch(() => update({ actionError: "Could not save your note. Your draft is retained; please retry." }));
  }, [requests, scopedState, stateRef]);

  const updateNote = useCallback(async (id: string, content: string, visibility: "private" | "shared") => {
    const update = scopedState();
    await requests.write(`note:${id}`, () => apiFetch(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify({ content, visibility }) }));
    update(s => ({ notes: s.notes.map(n => n.id === id ? { ...n, text: content, vis: visibility } : n) }));
  }, [requests, scopedState]);
  const removeNote = useCallback((id: string) => {
    const update = scopedState();
    void requests.write(`note:${id}`, () => apiFetch(`/api/notes/${id}`, { method: "DELETE" }))
      .then(() => update(s => ({ notes: s.notes.filter(n => n.id !== id) })))
      .catch(() => update({ actionError: "Could not delete this note. Please retry." }));
  }, [requests, scopedState]);

  // FR-11.4: persisted server-side (so it applies from any device/session),
  // then re-fetch notes since the visible set of others' shared notes changes.
  const toggleShared = useCallback(() => {
    const setState = scopedState("toggleShared");
    const examId = stateRef.current.examId;
    const next = !stateRef.current.showShared;
    setState({ showShared: next });
    apiFetch("/api/settings", { method: "PATCH", body: JSON.stringify({ showSharedNotes: next }) })
      .then(() => apiFetch<NotesListResponse>(`/api/notes?examId=${encodeURIComponent(examId ?? "")}`))
      .then(({ notes }) => setState({ notes: notes.map(fromSharedNote) }))
      .catch(() => {});
  }, [scopedState, stateRef]);

  return { setNoteDraft, setNoteVis, addNote, updateNote, removeNote, toggleShared };
}
