import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AuthoringNavigationEvent } from "../lib/questionAuthoring";
import ModalLayer from "./ModalLayer";

type DiscardPrompt = { title: string; description: string; action: string };
const dismissal: DiscardPrompt = {
  title: "Discard unsaved changes?", description: "Your question changes have not been saved. Discard them to continue.", action: "Discard changes"
};

function editingLocation() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return () => {};
  const selection = (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && active.selectionStart !== null
    ? { start: active.selectionStart, end: active.selectionEnd!, direction: active.selectionDirection ?? "none" } : null;
  const scroll: { element: HTMLElement; top: number; left: number }[] = [];
  for (let element: HTMLElement | null = active; element; element = element.parentElement) {
    scroll.push({ element, top: element.scrollTop, left: element.scrollLeft });
  }
  return () => {
    if (!active.isConnected) return;
    active.focus({ preventScroll: true });
    if (selection && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) {
      active.setSelectionRange(selection.start, selection.end, selection.direction);
    }
    for (const { element, top, left } of scroll) { element.scrollTop = top; element.scrollLeft = left; }
  };
}

// Both editors contribute to the same asynchronous navigation boundary. A
// second request cannot queue another destination behind an open confirmation.
export function useQuestionDraftGuard(dirty: boolean, saving: { current: boolean }, save: () => void) {
  const [prompt, setPrompt] = useState<DiscardPrompt | null>(null);
  const pending = useRef<((allowed: boolean) => void) | null>(null);
  const restore = useRef<(() => void) | null>(null), restoreAfter = useRef(false);
  const requestDiscard = useCallback((message = dismissal): Promise<boolean> => {
    if (saving.current || pending.current) return Promise.resolve(false);
    if (!dirty) return Promise.resolve(true);
    restore.current = editingLocation();
    return new Promise(resolve => { pending.current = resolve; setPrompt(message); });
  }, [dirty, saving]);
  const decide = (allowed: boolean) => {
    restoreAfter.current = !allowed;
    const resolve = pending.current; pending.current = null; setPrompt(null);
    resolve?.(allowed);
  };
  useLayoutEffect(() => {
    if (!prompt && restoreAfter.current) { restoreAfter.current = false; restore.current?.(); }
  }, [prompt]);
  useEffect(() => () => {
    // An obsolete editor must never approve navigation after it unmounts.
    pending.current?.(false); pending.current = null;
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || saving.current) { event.preventDefault(); event.returnValue = ""; }
    };
    const navigate = (event: Event) => {
      const gate = (event as AuthoringNavigationEvent).detail;
      if (gate?.waitUntil) gate.waitUntil(requestDiscard());
      // Old synchronous callers cannot wait for a decision; keep the draft.
      else if (dirty || saving.current) event.preventDefault();
    };
    const pendingShortcut = (event: globalThis.KeyboardEvent) => {
      // Disabling the focused field may move focus to body. Keep a pending
      // save's shortcut guarded even when it no longer bubbles via the drawer.
      if (saving.current && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("prepdeck:before-navigate", navigate);
    window.addEventListener("keydown", pendingShortcut, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("prepdeck:before-navigate", navigate);
      window.removeEventListener("keydown", pendingShortcut, true);
    };
  }, [dirty, requestDiscard, saving]);
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!event.repeat && !event.nativeEvent.isComposing && !saving.current && !pending.current) save();
    }
  };
  return { requestDiscard, onKeyDown, confirmation: prompt && <DiscardConfirmation prompt={prompt} onDecision={decide} /> };
}

function DiscardConfirmation({ prompt, onDecision }: { prompt: DiscardPrompt; onDecision: (allowed: boolean) => void }) {
  const id = useId(), keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus({ preventScroll: true });
    // This sibling modal is above the editor, so its shortcut cannot bubble
    // through the editor's handler. Do not open the browser's Save Page dialog.
    const preventSave = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("keydown", preventSave, true);
    return () => window.removeEventListener("keydown", preventSave, true);
  }, []);
  return <ModalLayer labelledBy={`${id}-title`} describedBy={`${id}-body`} lockScroll={false} onClose={() => onDecision(false)}>
    <div className="dialog authoring-discard-dialog">
      <h3 className="dialog-title" id={`${id}-title`}>{prompt.title}</h3>
      <p id={`${id}-body`}>{prompt.description}</p>
      <div className="dialog-actions">
        <button ref={keep} type="button" className="btn btn-secondary" onClick={() => onDecision(false)}>Keep editing</button>
        <button type="button" className="btn btn-primary" onClick={() => onDecision(true)}>{prompt.action}</button>
      </div>
    </div>
  </ModalLayer>;
}
