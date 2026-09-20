import { useEffect, useRef, useState } from "react";
import type { KnowledgePointGroup } from "@prepdeck/shared";

export default function GroupPicker({
  groups,
  groupId,
  groupName,
  onSelect,
}: {
  groups: KnowledgePointGroup[];
  groupId: string | null;
  groupName: string | null;
  onSelect: (groupId: string | null) => void;
}) {
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

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", border: "1px solid var(--color-divider)", borderRadius: 999, background: "var(--color-accent-2-100)", cursor: "pointer", font: "inherit", fontSize: 11.5, color: "var(--color-accent-2-800)" }}
      >
        {groupId ? (groupName ?? "Group") : "Ungrouped"}
        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 40, top: "calc(100% + 6px)", left: 0, width: 220, maxHeight: 260, overflowY: "auto", padding: 6, border: "1px solid var(--color-divider)", borderRadius: 14, background: "var(--color-bg)", boxShadow: "var(--pd-shadow-lg)" }}>
          <button
            type="button"
            onClick={() => { onSelect(null); setOpen(false); }}
            style={{ width: "100%", display: "block", padding: "7px 10px", border: 0, borderRadius: 9, background: groupId === null ? "var(--color-neutral-100)" : "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, textAlign: "left" }}
          >
            Ungrouped
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => { onSelect(g.id); setOpen(false); }}
              style={{ width: "100%", display: "block", padding: "7px 10px", border: 0, borderRadius: 9, background: groupId === g.id ? "var(--color-neutral-100)" : "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, textAlign: "left" }}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
