import { beforeWorkspaceNavigation } from "../../lib/examWorkspace";
import { catalogQuestionIds } from "../../lib/reviewLists";
import { canCheckAnswer } from "../../lib/practiceShortcuts";
import { useCallback, useRef } from "react";
import type { StartAttemptResponse, SubmitPracticeAnswerHttpResponse } from "@prepdeck/shared";
import { hasAnswer } from "@prepdeck/shared";
import { apiFetch, ApiError } from "../../lib/api";
import type { Question } from "../../types";
import { without } from "../storeHelpers";
import type { CatalogQueries } from "./useCatalogQueries";
import type { StoreCore } from "./useStoreCore";
import { t } from "../../i18n/runtime";

// A live Practice attempt: answering, grading, moving between questions and
// bookmarks.
export type PracticeSession = ReturnType<typeof usePracticeSession>;

export function usePracticeSession(core: StoreCore, deps: Pick<CatalogQueries, "applyStudyStatus">) {
  const { requests, scopedState, setState, stateRef } = core;
  const { applyStudyStatus } = deps;

  // Shared by "start a filtered practice session," "practice this list of
  // wrong/bookmarked questions," and "review a single question" — all create
  // a real attempt server-side so submit() has something to grade against.
  const begin = useCallback((requestedIds: string[]) => {
    const ids = catalogQuestionIds(requestedIds, stateRef.current.catalogBy);
    if (!ids.length || !stateRef.current.examId || stateRef.current.workspaceStatus !== "ready" || stateRef.current.switching) return;
    if (requests.has("start") || !stateRef.current.exams.some(e => e.id === stateRef.current.examId)) return;
    const update = scopedState("start");
    const examId = stateRef.current.examId;
    requests.write("start", () => apiFetch<StartAttemptResponse>(`/api/exams/${examId}/attempts`, {
      method: "POST",
      body: JSON.stringify({ mode: "practice", questionIds: ids })
    })).then(({ attemptId }) => {
      update({ screen: "practice", pStage: "live", queue: ids, idx: 0, sel: {}, done: {}, graded: {}, attemptId });
    }).catch(() => update({ actionError: t("errors.practice.start") }));
  }, [stateRef, requests, scopedState]);

  const pick = useCallback((q: Question, oid: string | string[]) => {
    const current = stateRef.current.catalogBy[q.id];
    if (!current || (current.hasContent && !current.content) || stateRef.current.done[q.id] || stateRef.current.switching) return;
    setState((s) => {
      const cur = (s.sel[q.id] || []).slice();
      let nx: string[];
      if (Array.isArray(oid)) nx = oid;
      else if (q.type === "multiple_choice") {
        const i = cur.indexOf(oid);
        if (i >= 0) cur.splice(i, 1);
        else if (cur.length < (q.chooseCount || 1)) cur.push(oid);
        nx = cur;
      } else nx = [oid];
      return { sel: { ...s.sel, [q.id]: nx } };
    });
  }, [setState, stateRef]);

  const savePracticeAnswer = useCallback(async (qid: string, attemptId: string, chosen: string[]) => {
    const update = scopedState();
    const q = stateRef.current.catalogBy[qid];
    if (!q || !hasAnswer(q.type, chosen)) return;
    const { isCorrect, correctAnswers, explanation, answerRevision, answerRevisedAt, studyStatus } = await requests.write(`answer:${attemptId}:${qid}`, () =>
      apiFetch<SubmitPracticeAnswerHttpResponse>(`/api/attempts/${attemptId}/answers`, {
        method: "POST", body: JSON.stringify({ questionId: qid, selectedAnswer: chosen })
      }));
      // Issue #119: the server marked the answered question studied.
      if (studyStatus) applyStudyStatus(update, studyStatus);
      update((s) => {
        if (s.attemptId !== attemptId) return {};
        // Mirrors the server's wrong-book rule exactly (routes/attempts.ts), so
        // this optimistic entry survives the next catalog load unchanged. A
        // right answer keeps the same book, so what shows it does not render.
        const answeredWrong = !isCorrect && hasAnswer(q.type, chosen);
        const prev = s.wrong[q.id];
        const wrong = answeredWrong ? { ...s.wrong, [q.id]: { c: (prev ? prev.c : 0) + 1, at: new Date().toISOString() } } : s.wrong;

        return {
          // This answer joins the question's Learning history.
          lDetail: without(s.lDetail, q.id),
          done: { ...s.done, [q.id]: isCorrect ? "ok" : "no" },
          graded: { ...s.graded, [q.id]: { isCorrect, correctAnswers, explanation, answerRevision, answerRevisedAt } },
          wrong,
          mastered: answeredWrong ? { ...s.mastered, [q.id]: false } : s.mastered,
          attempted: { ...s.attempted, [q.id]: true }
        };
      });
  }, [scopedState, stateRef, requests, applyStudyStatus]);
  const submit = useCallback(() => {
    const s = stateRef.current;
    const qid = s.queue[s.idx];
    if (!qid || !s.attemptId || s.switching || s.done[qid] || requests.has(`answer:${s.attemptId}:${qid}`)) return;
    // The Check answer button's own rule, so no caller (the Enter shortcut
    // included) can lock in a partial answer as wrong.
    const question = s.catalogBy[qid];
    if (!question || !canCheckAnswer(question, s.sel[qid] ?? [])) return;
    const update = scopedState();
    void savePracticeAnswer(qid, s.attemptId, s.sel[qid] ?? [])
      .catch((error) => update({ actionError: error instanceof ApiError && error.status === 409
        // Closed as idle when a newer session started (issue #40): retrying cannot help.
        ? t("errors.practice.ended")
        : t("errors.practice.answer") }));
  }, [stateRef, requests, scopedState, savePracticeAnswer]);

  const completeAttempt = useCallback(async (attemptId: string | null) => {
    if (!attemptId) return;
    await requests.drain();
    await apiFetch(`/api/attempts/${attemptId}/complete`, { method: "POST" });
  }, [requests]);
  const saveQuestionDraftRef = useRef<() => Promise<void>>(async () => {});
  const movingQuestion = useRef(false);
  const navigateQuestion = useCallback((move: () => void | Promise<void>) => {
    if (stateRef.current.switching || movingQuestion.current) return;
    movingQuestion.current = true;
    void beforeWorkspaceNavigation().then(() => saveQuestionDraftRef.current()).then(move)
      .catch(() => setState({ actionError: t("errors.practice.note") }))
      .finally(() => { movingQuestion.current = false; });
  }, [setState, stateRef]);
  const endSession = useCallback(() => {
    if (stateRef.current.switching) return;
    const update = scopedState();
    const attemptId = stateRef.current.attemptId;
    navigateQuestion(() => completeAttempt(attemptId).then(() => update(s => s.attemptId !== attemptId ? {} : {
      pStage: "setup", attemptId: null, activityRevision: s.activityRevision + 1
    })).catch(() => update({ actionError: t("errors.practice.finish") })));
  }, [stateRef, scopedState, navigateQuestion, completeAttempt]);
  const next = useCallback(() => {
    const s = stateRef.current;
    if (s.switching) return;
    if (s.idx + 1 >= s.queue.length) endSession();
    else navigateQuestion(() => setState({ idx: s.idx + 1, tsel: null }));
  }, [stateRef, endSession, navigateQuestion, setState]);
  const prevQ = useCallback(() => {
    navigateQuestion(() => setState((s) => ({ idx: Math.max(0, s.idx - 1), tsel: null })));
  }, [setState, navigateQuestion]);

  const writeBookmark = useCallback((id: string, next: boolean) => {
    const s = stateRef.current;
    if (s.switching || !s.catalogBy[id] || requests.has(`bookmark:${s.me?.id}:${id}`)) return;
    const update = scopedState(`bookmark:${id}`);
    const previous = !!s.bookmarks[id];
    setState(current => ({ bookmarks: { ...current.bookmarks, [id]: next } }));
    void requests.write(`bookmark:${s.me?.id}:${id}`, () => apiFetch(`/api/questions/${id}/bookmark`, { method: next ? "PUT" : "DELETE" }))
      .catch(() => update(current => ({ bookmarks: { ...current.bookmarks, [id]: previous }, actionError: t("errors.practice.bookmark") })));
  }, [requests, scopedState, setState, stateRef]);

  // No id -> bookmark the question currently being answered in live practice
  // (PracticeLive's toolbar button). An explicit id lets other review
  // surfaces — mock results, wrong/bookmarks lists — bookmark any question
  // (FR-6.1: "during practice, mock review, or browsing"). The current
  // question is read through the ref, not curQ(), so the action keeps one
  // identity across renders.
  const toggleBookmark = useCallback((questionId?: string) => {
    const s = stateRef.current;
    const current = s.queue[s.idx];
    const id = questionId ?? (current ? s.catalogBy[current]?.id : undefined);
    if (id) writeBookmark(id, !s.bookmarks[id]);
  }, [stateRef, writeBookmark]);
  return {
    begin, pick, savePracticeAnswer, submit, saveQuestionDraftRef, navigateQuestion, endSession, next,
    prevQ, writeBookmark, toggleBookmark,
  };
}
