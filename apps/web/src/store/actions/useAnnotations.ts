import { useCallback } from "react";
import type { AnnotationResponse, AnnotationSettingsResponse, MarkStyle, UpdateAnnotationSettingsRequest } from "@prepdeck/shared";
import { apiFetch } from "../../lib/api";
import { fromSharedAnnotation, toCreateAnnotationRequest } from "../../lib/annotations";
import type { AnnotationStyle, AnnotationTarget } from "../../types";
import { base } from "../storeHelpers";
import type { StoreCore } from "./useStoreCore";

// Highlights, underlines and their notes on question text, and the user's
// mark aliases.
export type Annotations = ReturnType<typeof useAnnotations>;

export function useAnnotations(core: StoreCore) {
  const { dirtyAnnotations, requests, scopedState, setState, stateRef } = core;

  const capture = useCallback((qid: string, target: AnnotationTarget) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      if (stateRef.current.tsel) setState({ tsel: null });
      return;
    }
    const a = base(sel.anchorNode);
    const f = base(sel.focusNode);
    if (a === null || f === null) return;
    let start = a + sel.anchorOffset;
    let end = f + sel.focusOffset;
    if (start > end) { const t = start; start = end; end = t; }
    if (end - start < 2) return;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setState({ tsel: { qid, target, start, end, x: r.left + r.width / 2, y: r.top - 10 } });
  }, [setState, stateRef]);

  // FR-8.1: persist the new annotation server-side first (so its id is real,
  // not a client-guessed one) before adding it to local state — mirrors how
  // begin() waits for the server-assigned attemptId.
  const apply = useCallback((style: AnnotationStyle) => {
    const setState = scopedState();
    const t = stateRef.current.tsel;
    if (!t) return;
    setState({ tsel: null });
    const g = window.getSelection();
    if (g) g.removeAllRanges();
    requests.write(`annotation-create:${t.qid}`, () => apiFetch<AnnotationResponse>(`/api/questions/${t.qid}/annotations`, {
      method: "POST",
      body: JSON.stringify(toCreateAnnotationRequest(t.target, t.start, t.end, style, ""))
    })).then(({ annotation }) => {
      setState((s) => ({ anns: s.anns.concat([fromSharedAnnotation(annotation)]) }));
    }).catch(() => {});
  }, [scopedState, stateRef, requests]);

  // Updates the note text locally on every keystroke (FR-8.2); the PATCH
  // itself is fired on blur (saveMarkNote) rather than per keystroke.
  const setMarkNote = useCallback((id: string, note: string) => {
    dirtyAnnotations.current.set(id, note);
    setState((s) => ({ anns: s.anns.map((x) => (x.id === id ? { ...x, note } : x)) }));
  }, [dirtyAnnotations, setState]);
  const saveMarkNote = useCallback((id: string) => {
    const note = stateRef.current.anns.find(x => x.id === id)?.note ?? "";
    const update = scopedState();
    void requests.write(`annotation:${id}`, () => apiFetch(`/api/annotations/${id}`, { method: "PATCH", body: JSON.stringify({ note: note || null }) }))
      .then(() => { if (dirtyAnnotations.current.get(id) === note) dirtyAnnotations.current.delete(id); })
      .catch(() => update({ actionError: "Could not save the annotation note. Please retry before leaving." }));
  }, [dirtyAnnotations, requests, scopedState, stateRef]);
  const removeMark = useCallback((id: string) => {
    const update = scopedState();
    void requests.write(`annotation:${id}`, () => apiFetch(`/api/annotations/${id}`, { method: "DELETE" }))
      .then(() => { dirtyAnnotations.current.delete(id); update(s => ({ anns: s.anns.filter(x => x.id !== id) })); })
      .catch(() => update({ actionError: "Could not delete the annotation. Please retry." }));
  }, [dirtyAnnotations, requests, scopedState]);

  // implementation: rename what a mark type means to this user. The server
  // trims/validates and falls back to the previous (or default) alias on
  // empty input, so the response is always the authoritative new state.
  const updateMarkAlias = useCallback((style: MarkStyle, alias: string) => {
    const body: UpdateAnnotationSettingsRequest = { [`${style}Alias`]: alias } as UpdateAnnotationSettingsRequest;
    apiFetch<AnnotationSettingsResponse>("/api/annotation-settings", { method: "PATCH", body: JSON.stringify(body) })
      .then((r) => setState({ markAliases: { hl1: r.hl1Alias, hl2: r.hl2Alias, hl3: r.hl3Alias } }))
      .catch(() => {});
  }, [setState]);

  return { capture, apply, setMarkNote, saveMarkNote, removeMark, updateMarkAlias };
}
