import { useLayoutEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = "button, input, textarea, select, a[href], [tabindex], [contenteditable=true]";
// A box whose focusable content this document cannot list, such as the
// Turnstile widget's iframe in a closed shadow root (issue #82). Native Tab
// moves into and out of it; the trap only has to count it as a stop, and
// wrap onto it by focusing the box (tabindex=-1), from where Tab goes in.
const FOCUS_REGION = "[data-focus-region]";

// The shared layer for dialogs that have to cover the whole application rather
// than the column they happen to be rendered in.
//
// `.dialog-backdrop` is `position: fixed`, which sounds viewport-wide but is
// only ever as wide as its containing block — and a transform, filter or
// `contain` anywhere above it becomes that containing block. The screen
// entrance animations are exactly such an ancestor, so a backdrop rendered
// inside one dims the content column and leaves the sidebar undimmed.
// `showModal()` promotes the element to the browser's top layer, which sits
// outside every ancestor's containing block, so the wash covers the viewport
// whatever the page behind it is doing. The top layer also makes the rest of
// the document inert and routes Escape here, while the element still inherits
// the theme tokens from where it sits in the tree.
//
// QuestionEditorDialog drives its own `<dialog>` for the same reason; this is
// that pattern lifted out for the dialogs that do not need a drawer's
// animation or unsaved-changes guard.
export default function ModalLayer({ label, labelledBy, describedBy, onClose, children }: {
  label?: string;
  labelledBy?: string;
  // The element whose text is announced after the name when the dialog opens,
  // e.g. a confirmation's consequences.
  describedBy?: string;
  // Omit to make the dialog dismissible only through its own controls — the
  // backdrop and Escape then do nothing.
  onClose?: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    element?.showModal();
    // The top layer makes the page inert but not unscrollable.
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="modal-layer"
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      // Native modal dialogs keep the page inert, but Tab can still leave the
      // document for browser controls. Keep both keyboard boundaries inside.
      onKeyDown={(e) => {
        if (e.key !== "Tab" || e.defaultPrevented) return;
        const active = document.activeElement;
        const isRegion = (el: Element) => el.matches(FOCUS_REGION);
        // From a region's own box, Tab goes into the region: let it.
        if (!e.shiftKey && active && isRegion(active)) return;
        const stops = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(`${FOCUSABLE}, ${FOCUS_REGION}`))
          .filter(el => !el.closest("[inert]") && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"
            && (isRegion(el) || (!el.parentElement?.closest(FOCUS_REGION)
              && (el.tabIndex >= 0 || (el.isContentEditable && !el.hasAttribute("tabindex"))) && !el.matches(":disabled"))));
        const current = stops.find(stop => stop === active || (isRegion(stop) && !!active && stop.contains(active)));
        const first = stops[0], last = stops.at(-1);
        if (!first) { e.preventDefault(); e.currentTarget.focus(); return; }
        const target = e.shiftKey
          ? (current === first || active === e.currentTarget ? last : undefined)
          : (current === last ? first : undefined);
        if (target) { e.preventDefault(); target.focus(); }
      }}
      // Escape closes through the caller instead of behind its back: the
      // browser's own close would leave the state that renders this saying
      // the dialog is still open.
      onCancel={(e) => { e.preventDefault(); onClose?.(); }}
      // A click on the wash lands on the dialog box itself, which is stretched
      // over the viewport; anything from inside the panel has the panel as its
      // target, so no `stopPropagation` is needed down there.
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      {children}
    </dialog>
  );
}
