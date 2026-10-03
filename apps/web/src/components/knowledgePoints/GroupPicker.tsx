import { useEffect, useRef, useState } from "react";
import type { KnowledgePointGroup } from "@prepdeck/shared";
import { Check, ChevronDown, Folder } from "@untitledui/icons";

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

  const name = groupId ? (groupName ?? "Group") : "Ungrouped";
  const option = (id: string | null, label: string) => (
    <button key={id ?? ""} type="button" role="menuitemradio" aria-checked={groupId === id} className="kp-menu-item"
      onClick={() => { onSelect(id); setOpen(false); }}>
      <span className="kp-mi-text"><span className="kp-mi-title">{label}</span></span>
      {groupId === id && <Check size={16} aria-hidden="true" />}
    </button>
  );

  return (
    <div ref={ref} className="kp-dropdown" onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" className="kp-chip" aria-label={`Group: ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Folder size={16} aria-hidden="true" />
        {name}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="kp-menu kp-menu-pop" role="menu" aria-label="Move to group" style={{ left: 0, width: 240, maxHeight: 280, overflowY: "auto" }}>
          {option(null, "Ungrouped")}
          {groups.map((g) => option(g.id, g.name))}
        </div>
      )}
    </div>
  );
}
