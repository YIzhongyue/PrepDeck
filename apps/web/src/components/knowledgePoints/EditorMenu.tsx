import { Check } from "@untitledui/icons";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

const ITEMS = '[role^="menuitem"]:not(:disabled)';

// A small menu button for the editor chrome. Opening it with the mouse keeps
// focus (and so the ProseMirror selection) in the document; opening it from
// the keyboard moves focus into the list so arrow keys, Escape and Tab work.
export function Dropdown({ label, menuLabel, triggerClassName, trigger, disabled, title, align = "start", width = 300, children }: {
  label?: string;
  menuLabel: string;
  triggerClassName: string;
  trigger: ReactNode;
  disabled?: boolean;
  title?: string;
  align?: "start" | "end";
  width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const viaKeyboard = useRef(false);
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);

  useEffect(() => {
    if (!open) return;
    if (viaKeyboard.current) items()[0]?.focus();
    const onPointer = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    // Escape also has to work when a mouse-opened menu left focus in the editor.
    const onEscape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onEscape);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onEscape); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const onKeyDown = (event: KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") { event.preventDefault(); list[(index + 1) % list.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); list[(index - 1 + list.length) % list.length]?.focus(); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); button.current?.focus(); }
    else if (event.key === "Tab") setOpen(false);
  };
  const placement: CSSProperties = align === "end" ? { right: 0, width } : { left: 0, width };

  return (
    <div ref={root} className="kp-dropdown" onKeyDown={open ? onKeyDown : undefined}>
      <button ref={button} type="button" className={triggerClassName} aria-label={label} aria-haspopup="menu" aria-expanded={open}
        disabled={disabled} title={title}
        onMouseDown={event => { event.preventDefault(); viaKeyboard.current = false; }}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") viaKeyboard.current = true; }}
        onClick={() => setOpen(value => !value)}>
        {trigger}
      </button>
      {open && <div ref={menu} className="kp-menu kp-menu-pop" role="menu" aria-label={menuLabel} style={placement}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function MenuItem({ icon, title, hint, kbd, checked, danger, disabled, onSelect }: {
  icon?: ReactNode; title: ReactNode; hint?: string; kbd?: string; checked?: boolean; danger?: boolean; disabled?: boolean; onSelect: () => void;
}) {
  return (
    <button type="button" role={checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={checked} disabled={disabled}
      className={`kp-menu-item${danger ? " kp-menu-danger" : ""}`} onMouseDown={event => event.preventDefault()} onClick={onSelect}>
      {icon}
      <span className="kp-mi-text"><span className="kp-mi-title">{title}</span>{hint && <span className="kp-mi-hint">{hint}</span>}</span>
      {checked ? <Check size={16} aria-hidden="true" /> : kbd && <span className="kp-kbd">{kbd}</span>}
    </button>
  );
}
