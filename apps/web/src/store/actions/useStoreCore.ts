import { WorkspaceRequests } from "../../lib/examWorkspace";
import { useCallback, useRef, useState } from "react";
import { isSessionLost } from "../../lib/api";
import { type RouteIntent } from "../../lib/routes";
import { type AppState, type Patch, initialRouteIntent, stateForInitialRoute } from "../appState";

// The store's state, its ref and setter, the request tracker and the refs
// shared across actions. Every other action hook takes this as `core`.
export type StoreCore = ReturnType<typeof useStoreCore>;

export function useStoreCore() {
  const initialRoute = useRef<RouteIntent | null | undefined>(undefined);
  if (initialRoute.current === undefined) initialRoute.current = initialRouteIntent();
  const [state, setStateRaw] = useState<AppState>(() => stateForInitialRoute(initialRoute.current ?? null));
  const [{ width, height }, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800
  }));
  const stateRef = useRef(state);
  const requests = useRef(new WorkspaceRequests()).current;
  const dirtyAnnotations = useRef(new Map<string, string>());
  const dirtyMock = useRef(new Map<string, () => Promise<unknown>>());
  // Issue #119: the Learning visit whose question has been marked (or
  // deliberately left alone), and whether the user chose a status during it.
  const learningVisit = useRef<{ visit: number; qid: string; manual: boolean } | null>(null);
  // Manual status writes still in flight, per question. Until the last one
  // settles its optimistic value stands: an older automatic mark or a refresh
  // arriving meanwhile would otherwise flash the status it is replacing.
  const pendingStudy = useRef(new Map<string, number>());

  const setState = useCallback((patch: Patch) => {
    const changes = typeof patch === "function" ? patch(stateRef.current) : patch;
    // While the session is gone every write fails, and each action's own
    // "please retry" message would be wrong: only signing in again helps, which
    // the session-expired dialog says (issue #52).
    if (changes.actionError && isSessionLost()) delete changes.actionError;
    const next = { ...stateRef.current, ...changes };
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  // Capture before starting work, and check again when React state is applied.
  const scopedState = useCallback((lane?: string) => {
    const current = requests.capture(lane);
    return (patch: Patch) => { if (current()) setState(patch); };
  }, [requests, setState]);
  const dismissActionError = useCallback(() => setState({ actionError: null }), [setState]);
  return {
    initialRoute, state, width, height, setViewport, stateRef, requests, dirtyAnnotations, dirtyMock,
    learningVisit, pendingStudy, setState, scopedState, dismissActionError,
  };
}
