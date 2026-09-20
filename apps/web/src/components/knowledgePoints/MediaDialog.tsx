import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "./useDialogFocus";

export default function MediaDialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);

  // `aria-modal` tells a screen reader this is modal but does not actually
  // remove anything from its reading order, so without `inert` the whole page
  // behind the dialog stays reachable by virtual cursor and by Tab. The focus
  // trap only covers Tab. Siblings are marked rather than the container, since
  // the dialog is portalled INTO that container.
  useEffect(() => {
    const dialog = ref.current;
    const parent = dialog?.parentElement;
    if (!dialog || !parent) return;
    const inerted = Array.from(parent.children).filter((el): el is HTMLElement => el !== dialog && el instanceof HTMLElement && !el.inert);
    for (const el of inerted) el.inert = true;
    return () => { for (const el of inerted) el.inert = false; };
  }, []);

  return createPortal(<div ref={ref} role="dialog" aria-modal="true" aria-label={`Enlarged ${label}`} tabIndex={-1} className="kp-image-dialog"
    style={{ position: "fixed", inset: "3vh 3vw", width: "94vw", height: "94vh", zIndex: 120, background: "var(--color-bg)", color: "var(--color-text)", overflow: "auto" }}>
    <button type="button" className="btn btn-secondary" onClick={onClose}>Close enlarged {label}</button>
    {children}
  </div>, document.querySelector("[data-pd-theme]") ?? document.body);
}
