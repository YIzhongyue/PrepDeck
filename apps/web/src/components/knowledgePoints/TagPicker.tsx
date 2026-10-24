import { useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgePointTag } from "@prepdeck/shared";
import { useClampToViewport } from "./EditorMenu";
import { useI18n } from "../../i18n";

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
  const { t } = useI18n();

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
      .filter((tag) => !currentTagIds.includes(tag.id))
      .filter((tag) => !q || tag.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [existingTags, currentTagIds, value]);

  const submit = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
    setOpen(false);
  };

  const exactMatch = existingTags.some((tag) => tag.name.toLowerCase() === value.trim().toLowerCase());
  const menuShown = open && (!!value.trim() || suggestions.length > 0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useClampToViewport(menuRef, menuShown);

  return (
    <div ref={ref} className="kp-dropdown">
      <input
        type="text"
        className="kp-chip kp-chip-add"
        aria-label={t("kp.tagPicker.add")}
        value={value}
        placeholder={t("kp.tagPicker.placeholder")}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setValue(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(value); }
          else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
        }}
      />
      {menuShown && (
        <div ref={menuRef} className="kp-menu kp-menu-pop" style={{ left: 0, width: 240 }}>
          {suggestions.length > 0 && (
            <>
              <span className="kp-menu-label">{t("kp.tagPicker.yours")}</span>
              {suggestions.map((tag) => (
                <button key={tag.id} type="button" className="kp-menu-item" onClick={() => submit(tag.name)}>
                  <span className="kp-mi-text"><span className="kp-mi-title">{tag.name}</span></span>
                </button>
              ))}
            </>
          )}
          {value.trim() && !exactMatch && (
            <>
              {suggestions.length > 0 && <div className="kp-menu-sep" />}
              <button type="button" className="kp-menu-item" style={{ color: "var(--color-accent)" }} onClick={() => submit(value)}>
                <span className="kp-mi-text"><span className="kp-mi-title">{t("kp.tagPicker.create", { name: value.trim() })}</span></span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
