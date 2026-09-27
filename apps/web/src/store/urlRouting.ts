// issue #41 — keeps the address bar, the browser history and the tab title in
// step with the store, and turns Back/Forward into store navigation.
//
// The store stays the source of truth while the app runs; the URL is read on
// load (PrepDeckContext's stateForInitialRoute) and on popstate. A move to
// another screen or exam pushes a history entry. A move within Learning,
// question to question, replaces it, so Back leaves Learning rather than
// stepping through every question; Practice and Mock keep their questions out
// of the URL altogether.
//
// Back/Forward pass through the same save gate as the navigation buttons. When
// that gate refuses (an editor's unsaved changes, a failed save, a cancelled
// exam switch), the browser has already moved, so the address is put back:
// every entry this app writes carries its position, and history.go() returns
// by the same distance.

import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { parseRoute, routePath, routeTitle, type Route } from "../lib/routes";
import type { ScreenId } from "../types";
import { usePrepDeck, type AppState } from "./PrepDeckContext";

interface EntryState {
  prepdeckIndex: number;
}

function indexOf(historyState: unknown): number | null {
  const index = (historyState as Partial<EntryState> | null)?.prepdeckIndex;
  return typeof index === "number" && Number.isInteger(index) ? index : null;
}

function examSlugOf(state: AppState): string | null {
  return state.exams.find((e) => e.id === state.examId)?.slug ?? null;
}

/** Where the store is, as a route. */
export function currentRoute(state: AppState): Route {
  const learningQuestion = state.screen === "learning" && state.lStage === "live" ? state.catalogBy[state.lQueue[state.lIdx] ?? ""] : undefined;
  return {
    screen: state.screen,
    examSlug: examSlugOf(state),
    learningSequence: learningQuestion?.sequenceNumber ?? null,
    knowledgePointId: state.screen === "knowledgePoints" ? state.kpNoteId : null,
  };
}

/** Question to question inside a Learning session: not worth a Back step each. */
function isMoveWithinScreen(from: Route, to: Route): boolean {
  return from.screen === "learning" && to.screen === "learning" && from.examSlug === to.examSlug
    && from.learningSequence != null && to.learningSequence != null;
}

/** The URL can only be written once the store knows where it is. */
function isSettled(state: AppState): boolean {
  if (state.switching) return false;
  if (state.pendingLearningSequence != null || state.pendingQuestionJump || state.pendingSlugQuestionJump) return false;
  return state.examId != null || state.workspaceStatus === "empty";
}

export function useUrlRouting(): void {
  const { state, navigateTo } = usePrepDeck();
  const index = useRef(indexOf(window.history.state) ?? 0);
  const written = useRef<Route | null>(null);
  const ignoredPops = useRef(0);

  const route = currentRoute(state);
  const path = routePath(route);
  const examName = state.exams.find((e) => e.id === state.examId)?.name ?? null;
  const title = routeTitle(route, examName);
  const settled = isSettled(state);
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    if (!settled) return;
    document.title = title;
    const current = routeRef.current;
    const here = `${window.location.pathname}${window.location.search}`;
    const previous = written.current;
    written.current = current;
    if (here === path) {
      if (indexOf(window.history.state) == null) window.history.replaceState({ prepdeckIndex: index.current } satisfies EntryState, "", path);
      return;
    }
    // The first write only puts the address into its canonical form ("/" or
    // an old email link becomes the screen's own path): nothing to go back to.
    if (!previous || isMoveWithinScreen(previous, current)) {
      window.history.replaceState({ prepdeckIndex: index.current } satisfies EntryState, "", path);
    } else {
      index.current += 1;
      window.history.pushState({ prepdeckIndex: index.current } satisfies EntryState, "", path);
    }
  }, [settled, path, title]);

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const target = indexOf(event.state);
      if (ignoredPops.current > 0) {
        ignoredPops.current -= 1;
        if (target != null) index.current = target;
        return;
      }
      const asked = parseRoute(window.location.pathname, window.location.search);
      const fallback: Route = { screen: "dash", examSlug: null, learningSequence: null, knowledgePointId: null };
      const from = index.current;
      void navigateTo(asked ?? fallback).then((moved) => {
        if (moved) {
          if (target != null) index.current = target;
          written.current = null;
          return;
        }
        // Refused: return to the entry the app is still showing.
        const distance = target == null ? null : target - from;
        if (distance) {
          ignoredPops.current += 1;
          window.history.go(-distance);
        } else {
          window.history.pushState({ prepdeckIndex: from } satisfies EntryState, "", routePath(routeRef.current));
        }
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [navigateTo]);
}

/**
 * The href of a navigation entry, so it can be opened in a new tab. A plain
 * click still goes through go() and its save gate.
 */
export function useScreenHref(): (screen: ScreenId) => string {
  const { state } = usePrepDeck();
  const examSlug = examSlugOf(state);
  return useCallback((screen: ScreenId) => routePath({ screen, examSlug, learningSequence: null, knowledgePointId: null }), [examSlug]);
}

/** True for a click the browser should handle itself: a new tab or window. */
export function isModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}
