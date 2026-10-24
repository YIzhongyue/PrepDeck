import { sessionEligible } from "../../lib/underReview";
import { useCallback, useRef } from "react";
import type { CompleteAttemptResponse, SaveDraftAnswerResponse, StartAttemptResponse } from "@prepdeck/shared";
import { hasAnswer, type MockFormatId } from "@prepdeck/shared";
import { mockPlan } from "../../lib/mockFormat";
import { apiFetch } from "../../lib/api";
import { takeMockSelections } from "../../lib/reauth";
import type { Question } from "../../types";
import { isExpiredAttempt, isCompletedElsewhere, isClosedAttempt, isRejectedDraft, remainingSeconds } from "../storeHelpers";
import type { CatalogQueries } from "./useCatalogQueries";
import type { StoreCore } from "./useStoreCore";
import { t } from "../../i18n/runtime";

// Timed mock exams: setup, answering and flags with draft saves, and
// submission (including the deadline's automatic one).
export type MockExam = ReturnType<typeof useMockExam>;

export function useMockExam(core: StoreCore, deps: Pick<CatalogQueries, "applyStudyStatus" | "refreshStudyStatuses">) {
  const { dirtyMock, requests, scopedState, setState, stateRef } = core;
  const { applyStudyStatus, refreshStudyStatuses } = deps;

  const setMockFormat = useCallback((format: MockFormatId) => setState({ mockFormat: format }), [setState]);
  const setMockCount = useCallback((n: number) => setState({ mockCount: n }), [setState]);
  const setMockMinutes = useCallback((n: number) => setState({ mockMinutes: n }), [setState]);
  const setMockSkipReview = useCallback((skip: boolean) => setState({ mockSkipReview: skip }), [setState]);

  const resaveMockDraftRef = useRef<(attemptId: string, qid: string, sel: string[]) => void>(() => {});
  const beginMock = useCallback(() => {
    const s = stateRef.current;
    if (s.switching || s.workspaceStatus !== "ready" || requests.has("start") || !s.exams.some(e => e.id === s.examId)) return;
    const update = scopedState("start");
    if (s.activeMockAttempt) {
      const active = s.activeMockAttempt;
      // Answers this tab could not save before signing in again (issue #52)
      // are put back and saved now; the rest come from the server's draft.
      const stashed = takeMockSelections(active.attemptId) ?? {};
      const restored = Object.entries(stashed).filter(([qid, sel]) =>
        active.questionIds.includes(qid) && JSON.stringify(sel) !== JSON.stringify(active.selectedAnswers[qid] ?? []));
      setState({
        mStage: "live", mQueue: active.questionIds, mIdx: 0,
        mSel: { ...active.selectedAnswers, ...Object.fromEntries(restored) }, mFlag: active.flagged,
        mockAttemptId: active.attemptId, mLeft: remainingSeconds(active),
        mockDeadline: new Date(active.startedAt).getTime() + (active.timeLimitSeconds ?? 0) * 1000, mConfirm: false
      });
      for (const [qid, sel] of restored) resaveMockDraftRef.current(active.attemptId, qid, sel);
      return;
    }
    const eligible = sessionEligible(s.catalog, s.mockSkipReview);
    if (!s.examId || eligible.length === 0) return;
    const shuffled = eligible.map((q) => q.id).sort(() => Math.random() - 0.5);
    // mockPlan caps the format's length to the same eligible bank and to
    // MAX_ATTEMPT_QUESTIONS, which the API rejects outright.
    const plan = mockPlan(s);
    const ids = shuffled.slice(0, plan.questionCount);
    const timeLimitSeconds = plan.timeLimitMinutes * 60;
    requests.write("start", () => apiFetch<StartAttemptResponse>(`/api/exams/${s.examId}/attempts`, {
      method: "POST",
      body: JSON.stringify({ mode: "mock", questionIds: ids, timeLimitSeconds })
    })).then(({ attemptId, startedAt, timeLimitSeconds: serverLimit }) => {
      update({
        mStage: "live", mQueue: ids, mIdx: 0, mSel: {}, mFlag: {},
        mockAttemptId: attemptId, mLeft: serverLimit ?? timeLimitSeconds,
        mockDeadline: new Date(startedAt).getTime() + (serverLimit ?? timeLimitSeconds) * 1000, mConfirm: false
      });
    }).catch(() => update({ actionError: t("errors.mock.start") }));
  }, [stateRef, requests, scopedState, setState]);

  const saveMockChange = useCallback((attemptId: string, path: string, body: unknown) => {
    const operation = () => apiFetch(path, { method: "PUT", body: JSON.stringify(body) });
    dirtyMock.current.set(path, operation);
    const update = scopedState();
    return requests.write(`mock:${attemptId}`, operation).then((result) => {
      if (dirtyMock.current.get(path) === operation) dirtyMock.current.delete(path);
      // Issue #119: a saved non-empty draft answer marks its question studied.
      const studyStatus = (result as Partial<SaveDraftAnswerResponse> | null)?.studyStatus;
      if (studyStatus) applyStudyStatus(update, studyStatus);
    }, (error) => {
      // An expired attempt will never accept this write, so it must not stay
      // dirty — persistMockDraft would replay it on every submission attempt.
      if ((isClosedAttempt(error) || isRejectedDraft(error)) && dirtyMock.current.get(path) === operation) dirtyMock.current.delete(path);
      throw error;
    });
  }, [dirtyMock, scopedState, requests, applyStudyStatus]);

  resaveMockDraftRef.current = (attemptId, qid, sel) => {
    saveMockChange(attemptId, `/api/attempts/${attemptId}/answers/${qid}`, { selectedAnswer: sel })
      .catch(() => setState({ actionError: t("errors.mock.answerPending") }));
  };

  const mockPick = useCallback((q: Question, oid: string | string[]) => {
    // Serialize draft writes for this attempt, retaining the latest local selection.
    const current = stateRef.current.catalogBy[q.id];
    if (!current || (current.hasContent && !current.content) || stateRef.current.switching) return;
    const update = scopedState();
    const cur = (stateRef.current.mSel[q.id] || []).slice();
    let nextSel: string[];
    if (Array.isArray(oid)) nextSel = oid;
    else if (q.type === "multiple_choice") {
      const i = cur.indexOf(oid);
      if (i >= 0) cur.splice(i, 1);
      else if (cur.length < (q.chooseCount || 1)) cur.push(oid);
      nextSel = cur;
    } else nextSel = [oid];
    setState((s) => ({ mSel: { ...s.mSel, [q.id]: nextSel } }));
    const attemptId = stateRef.current.mockAttemptId;
    if (attemptId) {
      saveMockChange(attemptId, `/api/attempts/${attemptId}/answers/${q.id}`, { selectedAnswer: nextSel }).catch((error) => {
        // The server's clock ran out while this client's did not — a slept tab,
        // a skewed clock, or a request that took too long to arrive. Submit now
        // rather than leave the user answering a paper that is no longer open.
        if (isExpiredAttempt(error)) {
          update({ actionError: t("errors.mock.timeUp") });
          finishMockRef.current();
          return;
        }
        if (isCompletedElsewhere(error)) {
          update({ actionError: t("errors.mock.alreadySubmitted") });
          finishMockRef.current();
          return;
        }
        if (isRejectedDraft(error)) {
          update({ actionError: t("errors.mock.answerRejected") });
          return;
        }
        update({ actionError: t("errors.mock.answerPending") });
      });
    }
  }, [stateRef, scopedState, setState, saveMockChange]);

  const mockPrev = useCallback(() => setState((s) => ({ mIdx: Math.max(0, s.mIdx - 1) })), [setState]);
  const mockNext = useCallback(() => setState((s) => ({ mIdx: Math.min(s.mQueue.length - 1, s.mIdx + 1) })), [setState]);
  const mockGoto = useCallback((i: number) => setState({ mIdx: i }), [setState]);

  // The question on screen, read through the ref so the action keeps one
  // identity across renders.
  const toggleFlag = useCallback(() => {
    const { mQueue, mIdx, catalogBy } = stateRef.current;
    const q = mQueue[mIdx] ? catalogBy[mQueue[mIdx]] : undefined;
    const attemptId = stateRef.current.mockAttemptId;
    if (!q || !attemptId) return;
    if (stateRef.current.switching) return;
    const update = scopedState();
    const flagged = !stateRef.current.mFlag[q.id];
    setState((s) => ({ mFlag: { ...s.mFlag, [q.id]: flagged } }));
    saveMockChange(attemptId, `/api/attempts/${attemptId}/flags/${q.id}`, { flagged }).catch((error) => {
      if (isCompletedElsewhere(error)) {
        update({ actionError: t("errors.mock.alreadySubmitted") });
        finishMockRef.current();
        return;
      }
      update({ actionError: t("errors.mock.flagPending") });
    });
  }, [stateRef, scopedState, setState, saveMockChange]);

  const askSubmit = useCallback(() => setState({ mConfirm: true }), [setState]);
  const cancelSubmit = useCallback(() => setState({ mConfirm: false }), [setState]);

  const persistMockDraft = useCallback(async () => {
    await requests.drain();
    const s = stateRef.current;
    const id = s.mockAttemptId;
    if (!id || s.mStage !== "live") return;
    for (const [path, operation] of dirtyMock.current) {
      if (!path.startsWith(`/api/attempts/${id}/`)) continue;
      try {
        await requests.write(`mock:${id}`, operation);
      } catch (error) {
        // A draft the server refused as past the deadline, or for an attempt
        // already submitted elsewhere, must not block submission: it was never
        // going to be graded either way, and failing here would leave this tab
        // with no way to reach the result.
        if (!isClosedAttempt(error) && !isRejectedDraft(error)) throw error;
      }
      if (dirtyMock.current.get(path) === operation) dirtyMock.current.delete(path);
    }
  }, [dirtyMock, requests, stateRef]);
  const finishingMock = useRef(false);
  const finishMockRef = useRef<() => void>(() => {});
  const autoSubmittedMock = useRef<string | null>(null);
  const finishMock = useCallback(() => {
    const attemptId = stateRef.current.mockAttemptId;
    if (!attemptId || stateRef.current.switching || finishingMock.current) return;
    finishingMock.current = true;
    const update = scopedState();
    persistMockDraft().then(() => apiFetch<CompleteAttemptResponse>(`/api/attempts/${attemptId}/complete`, { method: "POST" })).then((result) => {
      update((s) => {
        if (s.mockAttemptId !== attemptId) return {};
        const wrong = { ...s.wrong };
        const mastered = { ...s.mastered };
        const attempted = { ...s.attempted };
        // A question left blank is graded incorrect but is NOT a wrong answer:
        // the server files only answered questions in the Wrong Question Book
        // (routes/attempts.ts), so deriving membership from `isCorrect` alone
        // made the list — and the mastered flags feeding it — change under the
        // user on the next reload. `hasAnswer` is that same server-side rule.
        result.breakdown.forEach((row) => {
          attempted[row.questionId] = true;
          const type = s.catalogBy[row.questionId]?.type ?? "";
          if (!row.isCorrect && hasAnswer(type, row.selectedAnswer)) {
            mastered[row.questionId] = false;
            const prev = wrong[row.questionId];
            wrong[row.questionId] = { c: (prev ? prev.c : 0) + 1, at: new Date().toISOString() };
          }
        });
        return { mStage: "results", mConfirm: false, mockResult: result, activeMockAttempt: null, wrong, mastered, attempted, activityRevision: s.activityRevision + 1 };
      });
      // Submission reconciles studied statuses on the server (issue #119).
      refreshStudyStatuses();
    }).catch(() => update({ actionError: t("errors.mock.submit") })).finally(() => { finishingMock.current = false; });
  }, [stateRef, scopedState, persistMockDraft, refreshStudyStatuses]);
  finishMockRef.current = finishMock;
  return {
    setMockFormat, setMockCount, setMockMinutes, setMockSkipReview, beginMock, mockPick, mockPrev,
    mockNext, mockGoto, toggleFlag, askSubmit, cancelSubmit, persistMockDraft, finishingMock,
    autoSubmittedMock, finishMock,
  };
}
