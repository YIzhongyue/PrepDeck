import { storeExam, beforeWorkspaceNavigation } from "../../lib/examWorkspace";
import { allowAuthoringNavigation } from "../../lib/questionAuthoring";
import { useCallback } from "react";
import type { NoteResponse } from "@prepdeck/shared";
import { apiFetch } from "../../lib/api";
import { type Route } from "../../lib/routes";
import { fromSharedNote } from "../../lib/notes";
import type { ScreenId } from "../../types";
import { type AppState, initialState } from "../appState";
import { errorLeftBehind } from "../storeHelpers";
import type { StoreCore } from "./useStoreCore";
import type { MockExam } from "./useMockExam";
import type { PracticeSession } from "./usePracticeSession";

// Screen and exam navigation behind one save gate: go(), switching exams,
// URL routes and jumps to a question or Knowledge Point.
export type Navigation = ReturnType<typeof useNavigation>;

export function useNavigation(core: StoreCore, deps: Pick<PracticeSession, "begin" | "savePracticeAnswer" | "saveQuestionDraftRef"> & Pick<MockExam, "finishingMock" | "persistMockDraft">) {
  const { dirtyAnnotations, requests, scopedState, setState, stateRef } = core;
  const { begin, finishingMock, persistMockDraft, savePracticeAnswer, saveQuestionDraftRef } = deps;

  const practiceWrong = useCallback(() => {
    const miss = (stateRef.current.mockResult?.breakdown ?? []).filter((r) => !r.isCorrect).map((r) => r.questionId);
    if (miss.length) begin(miss);
  }, [begin, stateRef]);

  const saveQuestionDraft = useCallback(async () => {
    await requests.drain();
    const s = stateRef.current;
    if (!s.noteDraft.trim()) return;
    const qid = s.noteDraftQuestionId ?? (s.screen === "learning" ? s.lQueue[s.lIdx] : s.queue[s.idx]);
    if (!qid) throw new Error("Save or discard your question note before switching.");
    const content = s.noteDraft;
    const { note } = await requests.write("note-draft", () => apiFetch<NoteResponse>(`/api/questions/${qid}/notes`, {
      method: "POST", body: JSON.stringify({ content, visibility: s.noteVis })
    }));
    setState(current => ({ noteDraft: current.noteDraft === content ? "" : current.noteDraft, noteDraftQuestionId: current.noteDraft === content ? null : current.noteDraftQuestionId, notes: current.notes.concat(fromSharedNote(note)) }));
  }, [requests, setState, stateRef]);

  saveQuestionDraftRef.current = saveQuestionDraft;

  const go = useCallback(async (id: ScreenId, options?: { newMock?: boolean }) => {
    if (stateRef.current.switching || !await allowAuthoringNavigation() || stateRef.current.switching) return;
    requests.cancelLane("start");
    const update = scopedState("navigation");
    const clearError = errorLeftBehind(stateRef.current.actionError);
    void beforeWorkspaceNavigation().then(saveQuestionDraft).then(() => {
      // An error belongs to the screen that raised it; it used to follow the
      // learner everywhere until dismissed (issue #52).
      update((s) => ({ screen: id, more: false, actionError: clearError(s),
        pStage: s.pStage,
        mStage: id === "mock" && options?.newMock && s.mStage === "results" ? "setup" : s.mStage,
        lStage: id === "learning" ? "setup" : s.lStage,
        pendingLearningSequence: null,
        kpNoteId: id === "knowledgePoints" ? null : s.kpNoteId,
        listMode: id === "bookmarks" ? "bm" : id === "wrong" ? "wrong" : s.listMode
      }));
    }).catch(() => update({ actionError: "Navigation was cancelled because your changes could not be saved. Please retry saving." }));
  }, [stateRef, requests, scopedState, saveQuestionDraft]);

  const openMore = useCallback(() => setState({ more: true }), [setState]);
  const closeMore = useCallback(() => setState({ more: false }), [setState]);

  const switchExam = useCallback(async (id: string | null, questionId?: string): Promise<boolean> => {
    const before = stateRef.current;
    if (before.switching || finishingMock.current) return false;
    if (id === before.examId && !questionId) return true;
    if (id && !before.exams.some(e => e.id === id)) {
      setState({ actionError: "This exam is unavailable. Choose another exam." }); return false;
    }
    if (!await allowAuthoringNavigation() || stateRef.current.switching || finishingMock.current) return false;
    const original = stateRef.current;
    if (id === original.examId && !questionId) return true;
    if (id && !original.exams.some(e => e.id === id)) return false;
    if ((original.pStage === "live" || original.mStage === "live" || requests.has("start")) &&
      !window.confirm("Switch study context? Practice answers will be saved and the practice ended. Mock answers will be saved so you can resume; its timer keeps running.")) return false;
    setState({ switching: true, actionError: null });
    try {
      await beforeWorkspaceNavigation();
      await requests.drain();
      await saveQuestionDraft();
      for (const [annotationId, note] of dirtyAnnotations.current) {
        await apiFetch(`/api/annotations/${annotationId}`, { method: "PATCH", body: JSON.stringify({ note: note || null }) });
        if (dirtyAnnotations.current.get(annotationId) === note) dirtyAnnotations.current.delete(annotationId);
      }
      await persistMockDraft();
      const current = stateRef.current;
      if (current.pStage === "live" && current.attemptId) {
        await Promise.all(current.queue
          .filter(qid => !stateRef.current.done[qid] && current.sel[qid]?.length)
          .map(qid => savePracticeAnswer(qid, current.attemptId!, current.sel[qid]!)));
        await apiFetch(`/api/attempts/${current.attemptId}/complete`, { method: "POST" });
      }
      requests.invalidate();
      const next: Partial<AppState> = {};
      // Only exam/session fields reset; account preferences and personal
      // Knowledge Points remain available across exams.
      const keys = ["catalog", "catalogBy", "catalogRevision", "questionContent", "pStage", "source", "diff", "count", "feedback", "tags", "queue", "idx", "sel", "done", "graded", "attemptId",
        "lStage", "lTags", "lDiff", "lStartInput", "lQueue", "lIdx", "lResume", "lDetail", "pendingQuestionJump", "pendingLearningSequence",
        "mStage", "mQueue", "mIdx", "mSel", "mFlag", "mLeft", "mockDeadline", "mConfirm", "mockAttemptId", "mockFormat", "mockCount", "mockMinutes", "mockResult", "activeMockAttempt",
        "bookmarks", "wrong", "attempted", "mastered", "studyStatus", "studyStatusError", "ai", "anns", "notes", "noteDraft", "noteDraftQuestionId", "tsel", "more"] as const;
      for (const key of keys) Object.assign(next, { [key]: initialState[key] });
      setState(s => ({ ...next, examId: id, screen: questionId ? "learning" : original.screen,
        switching: false, workspaceStatus: id ? "loading" : "empty", workspaceError: null,
        workspaceGeneration: s.workspaceGeneration + 1,
        pendingQuestionJump: id && questionId ? { examId: id, questionId } : null
      }));
      if (original.me) storeExam(original.me.id, id);
      window.getSelection()?.removeAllRanges();
      return true;
    } catch (error) {
      setState({ switching: false, actionError: error instanceof Error ? `Could not switch: ${error.message}. Your work is retained; retry saving or switching.` : "Could not save your work. Please retry before switching." });
      return false;
    }
  }, [stateRef, finishingMock, requests, setState, saveQuestionDraft, persistMockDraft, dirtyAnnotations, savePracticeAnswer]);
  const setExamId = useCallback((id: string) => switchExam(id), [switchExam]);
  const goToQuestionForReview = useCallback(async (examId: string, questionId: string) => {
    if (examId === stateRef.current.examId) {
      if (stateRef.current.switching || !await allowAuthoringNavigation() || stateRef.current.switching) return;
      requests.cancelLane("start");
      const update = scopedState("navigation");
      void beforeWorkspaceNavigation().then(saveQuestionDraft).then(() => {
        update({ screen: "learning", pendingQuestionJump: { examId, questionId } });
      }).catch(() => update({ actionError: "Navigation was cancelled because your changes could not be saved. Please retry saving." }));
      return;
    }
    void switchExam(examId, questionId);
  }, [stateRef, switchExam, requests, scopedState, saveQuestionDraft]);

  // implementation — open a specific Knowledge Point note from outside the
  // Knowledge Points screen (e.g. Learning Mode's related-notes card).
  const openKnowledgePointNote = useCallback(async (noteId: string) => {
    if (stateRef.current.switching || !await allowAuthoringNavigation() || stateRef.current.switching) return;
    const update = scopedState("navigation");
    const clearError = errorLeftBehind(stateRef.current.actionError);
    void beforeWorkspaceNavigation().then(saveQuestionDraft).then(() => update(s => ({ screen: "knowledgePoints", more: false, actionError: clearError(s), kpNoteId: noteId })))
      .catch(() => update({ actionError: "Could not save your current note. Please retry before leaving." }));
  }, [stateRef, scopedState, saveQuestionDraft]);
  // The Knowledge Points screen's own list/editor moves, which save their
  // drafts themselves as before.
  const showKnowledgePoint = useCallback((noteId: string | null) => setState({ kpNoteId: noteId }), [setState]);

  // issue #41: Back/Forward and a pasted URL. The same save gate as go(): an
  // editor with unsaved changes can still refuse, and drafts are flushed
  // before the screen changes. A different exam goes through switchExam, with
  // its own confirmation and saves.
  const navigateTo = useCallback(async (route: Route): Promise<boolean> => {
    const s = stateRef.current;
    const clearError = errorLeftBehind(s.actionError);
    const exam = route.examSlug ? s.exams.find(e => e.slug === route.examSlug) : undefined;
    if (route.examSlug && !exam) {
      setState({ actionError: "That exam is not available to you." });
      return false;
    }
    if (exam && exam.id !== s.examId) {
      if (!await switchExam(exam.id)) return false;
    } else {
      if (s.switching || !await allowAuthoringNavigation() || stateRef.current.switching) return false;
      requests.cancelLane("start");
      try {
        await beforeWorkspaceNavigation();
        await saveQuestionDraft();
      } catch {
        setState({ actionError: "Navigation was cancelled because your changes could not be saved. Please retry saving." });
        return false;
      }
    }
    setState(cur => ({
      screen: route.screen, more: false, actionError: clearError(cur),
      lStage: route.screen === "learning" && route.learningSequence == null ? "setup" : cur.lStage,
      pendingLearningSequence: route.screen === "learning" ? route.learningSequence : null,
      kpNoteId: route.screen === "knowledgePoints" ? route.knowledgePointId : cur.kpNoteId,
      listMode: route.screen === "bookmarks" ? "bm" : route.screen === "wrong" ? "wrong" : cur.listMode,
    }));
    return true;
  }, [stateRef, setState, switchExam, requests, saveQuestionDraft]);
  return {
    practiceWrong, saveQuestionDraft, go, openMore, closeMore, switchExam, setExamId,
    goToQuestionForReview, openKnowledgePointNote, showKnowledgePoint, navigateTo,
  };
}
