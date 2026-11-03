import { useCallback, useRef } from "react";
import type { NoteResponse, NotesListResponse } from "@prepdeck/shared";
import { apiFetch } from "../../lib/api";
import { fromSharedNote, sortNotes } from "../../lib/notes";
import type { StoreCore } from "./useStoreCore";
import { t } from "../../i18n/runtime";

// Personal and shared question notes.
export type QuestionNotes = ReturnType<typeof useQuestionNotes>;

export function useQuestionNotes(core: StoreCore) {
  const { requests, scopedState, setState, stateRef } = core;
  const visibilityGeneration = useRef(0);
  const changingVisibility = useRef(false);

  const loadNotesPage = useCallback((questionId?: string) => {
    const s = stateRef.current;
    if (!s.examId || s.switching || changingVisibility.current) return;
    const key = questionId ? `question:${questionId}` : "exam";
    const page = s.notesPages[key];
    if (page?.status === "loading" || (page?.status === "ready" && !page.cursor)) return;
    const update = scopedState();
    const generation = visibilityGeneration.current;
    const cursor = page?.cursor ?? null;
    setState(current => ({ notesPages: { ...current.notesPages, [key]: { cursor, status: "loading" } } }));
    const query = new URLSearchParams(questionId ? {} : { examId: s.examId });
    if (cursor) query.set("cursor", cursor);
    const path = questionId ? `/api/questions/${encodeURIComponent(questionId)}/notes` : "/api/notes";
    void apiFetch<NotesListResponse>(`${path}?${query}`).then(result => {
      if (generation !== visibilityGeneration.current) return;
      update(current => {
        const byId = new Map(current.notes.map(note => [note.id, note]));
        for (const note of result.notes) byId.set(note.id, fromSharedNote(note));
        return { notes: sortNotes([...byId.values()]), notesPages: { ...current.notesPages,
          [key]: { cursor: result.nextCursor ?? null, status: "ready" } } };
      });
    }).catch(() => {
      if (generation !== visibilityGeneration.current) return;
      update(current => ({ notesPages: { ...current.notesPages, [key]: { cursor, status: "error" } } }));
    });
  }, [scopedState, setState, stateRef]);

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
      notes: sortNotes(current.notes.concat(fromSharedNote(note))), noteDraft: current.noteDraft.trim() === content ? "" : current.noteDraft,
      noteDraftQuestionId: current.noteDraft.trim() === content ? null : current.noteDraftQuestionId
    }))).catch(() => update({ actionError: t("errors.notes.save") }));
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
      .catch(() => update({ actionError: t("errors.notes.delete") }));
  }, [requests, scopedState]);

  // FR-11.4: persisted server-side (so it applies from any device/session),
  // then re-fetch notes since the visible set of others' shared notes changes.
  const toggleShared = useCallback(() => {
    if (changingVisibility.current) return;
    const setState = scopedState("toggleShared");
    const next = !stateRef.current.showShared;
    const generation = ++visibilityGeneration.current;
    changingVisibility.current = true;
    setState({ showShared: next });
    void requests.write("shared-notes-setting", () => apiFetch("/api/settings", { method: "PATCH", body: JSON.stringify({ showSharedNotes: next }) }))
      .then(() => {
        if (generation !== visibilityGeneration.current) return;
        changingVisibility.current = false;
        setState({ notes: [], notesPages: {} });
      }).catch(() => {
        if (generation !== visibilityGeneration.current) return;
        changingVisibility.current = false;
        setState({ showShared: !next, notes: [], notesPages: {} });
      });
  }, [requests, scopedState, stateRef]);

  return { setNoteDraft, setNoteVis, addNote, updateNote, removeNote, toggleShared, loadNotesPage };
}
