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
    <div ref={ref} style={{ position: "relative" }}>
      <input
        type="text"
        value={value}
        placeholder="Add tag…"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setValue(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(value); } }}
        style={{ width: 110, padding: "4px 11px", border: "1px dashed var(--color-divider)", borderRadius: 999, background: "transparent", outline: 0, font: "inherit", fontSize: 11.5, color: "var(--color-text)" }}
      />
      {open && (value.trim() || suggestions.length > 0) && (
        <div style={{ position: "absolute", zIndex: 40, top: "calc(100% + 6px)", left: 0, width: 210, padding: 6, border: "1px solid var(--color-divider)", borderRadius: 14, background: "var(--color-bg)", boxShadow: "var(--pd-shadow-lg)" }}>
          {suggestions.length > 0 && (
            <>
              <span style={{ display: "block", padding: "6px 10px 5px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                Your tags
              </span>
              {suggestions.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => submit(t.name)}
                  style={{ width: "100%", display: "block", padding: "7px 10px", border: 0, borderRadius: 9, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, textAlign: "left" }}
                >
                  {t.name}
                </button>
              ))}
            </>
          )}
          {value.trim() && !exactMatch && (
            <>
              {suggestions.length > 0 && <div style={{ height: 1, margin: "5px 8px", background: "var(--color-divider)" }} />}
              <button
                type="button"
                onClick={() => submit(value)}
                style={{ width: "100%", display: "block", padding: "7px 10px", border: 0, borderRadius: 9, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--color-accent-700)", textAlign: "left" }}
              >
                + Create &ldquo;{value.trim()}&rdquo;
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
