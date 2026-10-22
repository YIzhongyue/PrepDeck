import { useCallback } from "react";
import { ApiError } from "../../lib/api";
import { fetchCachedExplanations, generateExplanation } from "../../lib/ai";
import { getSessionKey } from "../../lib/keyStorage";
import type { AiExplanationEntry, Question } from "../../types";
import type { StoreCore } from "./useStoreCore";
import { t } from "../../i18n/runtime";

// AI explanations: the shared cache, generation with the user's own key, and
// switching between cached alternatives.
export type AiExplanations = ReturnType<typeof useAiExplanations>;

export function useAiExplanations(core: StoreCore) {
  const { scopedState, setState, stateRef } = core;

  // FR-7.2/FR-7.3: check the shared cache (any provider/model) before ever
  // asking for a key. Called once per question as its review panel opens.
  const checkAiCache = useCallback((q: Question) => {
    const setState = scopedState("checkAiCache" + q.id);
    setState((s) => ({ ai: { ...s.ai, [q.id]: { status: "checking" } } }));
    fetchCachedExplanations(q.id).then((explanations) => {
      const { provider, model } = stateRef.current;
      const exact = explanations.find((e) => e.provider === provider && e.model === model);
      const alternates = explanations.filter((e) => e !== exact);
      if (exact) {
        setState((s) => ({
          ai: {
            ...s.ai,
            [q.id]: {
              status: "ready", cached: true, content: exact.content, provider: exact.provider,
              model: exact.model, canManage: exact.canManage, alternates
            }
          }
        }));
      } else {
        setState((s) => ({ ai: { ...s.ai, [q.id]: { status: "idle", alternates } } }));
      }
    }).catch(() => {
      setState((s) => ({ ai: { ...s.ai, [q.id]: { status: "idle" } } }));
    });
  }, [scopedState, stateRef]);

  // FR-7.4: on a cache miss, relay to the user's own provider/model via the
  // Worker's fixed AI-proxy endpoint, sending the key for this one request
  // only (never persisted — see lib/keyStorage.ts). FR-7.7: `force` bypasses
  // the cache to regenerate (Admin or the original requester only; the
  // Worker re-checks this server-side regardless of what the client sends).
  const genAi = useCallback((q: Question, force?: boolean) => {
    const setState = scopedState("genAi" + q.id);
    const { provider, model } = stateRef.current;
    const apiKey = getSessionKey();
    if (!apiKey) {
      setState((s) => ({
        ai: { ...s.ai, [q.id]: { ...(s.ai[q.id] ?? { status: "idle" }), status: "error", error: t("errors.ai.noKey") } }
      }));
      return;
    }
    setState((s) => ({ ai: { ...s.ai, [q.id]: { ...(s.ai[q.id] ?? { status: "idle" }), status: "generating", error: undefined } } }));
    generateExplanation(q.id, provider, model, apiKey, force).then(({ explanation, cached }) => {
      setState((s) => ({
        ai: {
          ...s.ai,
          [q.id]: {
            status: "ready", cached, content: explanation.content, provider: explanation.provider,
            model: explanation.model, canManage: explanation.canManage, alternates: s.ai[q.id]?.alternates
          }
        }
      }));
    }).catch((err) => {
      setState((s) => ({
        ai: { ...s.ai, [q.id]: { ...(s.ai[q.id] ?? { status: "idle" }), status: "error", error: err instanceof ApiError ? err.message : t("errors.ai.generateFailed") } }
      }));
    });
  }, [scopedState, stateRef]);

  // FR-7.3: show an already-cached explanation from a different provider/
  // model, clearly labeled, instead of generating a fresh one.
  const showAlternateAi = useCallback((q: Question, alt: AiExplanationEntry) => {
    setState((s) => ({
      ai: {
        ...s.ai,
        [q.id]: { ...(s.ai[q.id] ?? { status: "idle" }), status: "ready", cached: true, content: alt.content, provider: alt.provider, model: alt.model, canManage: alt.canManage }
      }
    }));
  }, [setState]);

  return { checkAiCache, genAi, showAlternateAi };
}
