import { useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgePointTag } from "@prepdeck/shared";

export default function TagPicker({
  existingTags,
  currentTagIds,
  onAdd,
}: {
  existingTags: KnowledgePointTag[];
  currentTagIds: string[];
  onAdd: (name: string) => void;
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    return existingTags
      .filter((t) => !currentTagIds.includes(t.id))
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [existingTags, currentTagIds, value]);

  const submit = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
    setOpen(false);
  };

  const exactMatch = existingTags.some((t) => t.name.toLowerCase() === value.trim().toLowerCase());

  return (
    <div ref={ref} className="kp-dropdown">
      <input
        type="text"
        className="kp-chip kp-chip-add"
        aria-label="Add tag"
        value={value}
        placeholder="Add tag…"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setValue(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(value); }
          else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
        }}
      />
      {open && (value.trim() || suggestions.length > 0) && (
        <div className="kp-menu kp-menu-pop" style={{ left: 0, width: 240 }}>
          {suggestions.length > 0 && (
            <>
              <span className="kp-menu-label">Your tags</span>
              {suggestions.map((t) => (
                <button key={t.id} type="button" className="kp-menu-item" onClick={() => submit(t.name)}>
                  <span className="kp-mi-text"><span className="kp-mi-title">{t.name}</span></span>
                </button>
              ))}
            </>
          )}
          {value.trim() && !exactMatch && (
            <>
              {suggestions.length > 0 && <div className="kp-menu-sep" />}
              <button type="button" className="kp-menu-item" style={{ color: "var(--color-accent)" }} onClick={() => submit(value)}>
                <span className="kp-mi-text"><span className="kp-mi-title">Create &ldquo;{value.trim()}&rdquo;</span></span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
